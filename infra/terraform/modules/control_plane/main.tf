# The deployed DOMinators control plane: one EC2 box (nginx serving the static
# console + the orchestrator at /api) in a private subnet, reached only
# through CloudFront (HTTPS) -> the edge ALB on a dedicated port that checks a
# secret origin header. Viewers get a read-only console; actions need the
# operator key, which the orchestrator enforces.

terraform {
  required_providers {
    aws    = { source = "hashicorp/aws" }
    random = { source = "hashicorp/random" }
  }
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

locals {
  account = data.aws_caller_identity.current.account_id
  region  = data.aws_region.current.name
}

resource "random_password" "origin_verify" {
  length  = 40
  special = false
}

# --- Release bundles (code + built console), uploaded by the deploy script ---

resource "aws_s3_bucket" "releases" {
  bucket        = "${var.name_prefix}-releases-${local.account}"
  force_destroy = true
  tags          = var.tags
}

resource "aws_s3_bucket_public_access_block" "releases" {
  bucket                  = aws_s3_bucket.releases.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "releases" {
  bucket = aws_s3_bucket.releases.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "releases" {
  bucket = aws_s3_bucket.releases.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# --- Instance role: assume the two agent roles, read its secrets + releases ---

data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "this" {
  name               = var.name_prefix
  assume_role_policy = data.aws_iam_policy_document.trust.json
  tags               = var.tags
}

data "aws_iam_policy_document" "this" {
  statement {
    sid       = "AssumeAgentRoles"
    actions   = ["sts:AssumeRole"]
    resources = var.assumable_role_arns
  }

  statement {
    sid       = "ReadOwnSecrets"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = ["arn:aws:ssm:${local.region}:${local.account}:parameter${var.ssm_prefix}/*"]
  }

  statement {
    sid       = "DecryptSecretsViaSsm"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${local.region}.amazonaws.com"]
    }
  }

  statement {
    sid       = "ReadReleases"
    actions   = ["s3:GetObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.releases.arn, "${aws_s3_bucket.releases.arn}/*"]
  }
}

resource "aws_iam_role_policy" "this" {
  name   = "${var.name_prefix}-permissions"
  role   = aws_iam_role.this.id
  policy = data.aws_iam_policy_document.this.json
}

# Session Manager (shell + the deploy script's send-command); no SSH, no key pair.
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.this.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "this" {
  name = var.name_prefix
  role = aws_iam_role.this.name
}

# --- The box ---

resource "aws_security_group" "this" {
  name        = var.name_prefix
  description = "Control plane - HTTP from the edge ALB only"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    security_groups = [var.alb_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = var.name_prefix })
}

resource "aws_instance" "this" {
  ami                    = data.aws_ssm_parameter.al2023.value
  instance_type          = var.instance_type
  subnet_id              = var.private_subnet_ids[0]
  vpc_security_group_ids = [aws_security_group.this.id]
  iam_instance_profile   = aws_iam_instance_profile.this.name

  metadata_options {
    http_tokens   = "required"
    http_endpoint = "enabled"
  }

  root_block_device {
    encrypted   = true
    volume_type = "gp3"
    volume_size = 20
  }

  user_data = templatefile("${path.module}/templates/bootstrap.sh.tpl", {
    bucket            = aws_s3_bucket.releases.bucket
    ssm_prefix        = var.ssm_prefix
    region            = local.region
    terraform_version = var.terraform_version
  })

  # A newer AL2023 AMI shouldn't replace the box (and wipe its SQLite store).
  lifecycle {
    ignore_changes = [ami]
  }

  tags = merge(var.tags, { Name = var.name_prefix })
}

# --- ALB: dedicated port, forwards only requests from our CloudFront ---

resource "aws_lb_target_group" "this" {
  name        = var.name_prefix
  port        = 80
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "instance"

  health_check {
    path                = "/api/healthz"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = var.tags
}

resource "aws_lb_target_group_attachment" "this" {
  target_group_arn = aws_lb_target_group.this.arn
  target_id        = aws_instance.this.id
  port             = 80
}

resource "aws_lb_listener" "this" {
  load_balancer_arn = var.alb_arn
  port              = var.listener_port
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Not found"
      status_code  = "403"
    }
  }

  tags = var.tags
}

resource "aws_lb_listener_rule" "from_cloudfront" {
  listener_arn = aws_lb_listener.this.arn
  priority     = 1

  condition {
    http_header {
      http_header_name = "X-Origin-Verify"
      values           = [random_password.origin_verify.result]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this.arn
  }

  tags = var.tags
}

# --- CloudFront: the public HTTPS URL ---

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

resource "aws_cloudfront_distribution" "this" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "DOMinators migration accelerator console"
  price_class     = "PriceClass_All"

  origin {
    origin_id   = "control-plane-alb"
    domain_name = var.alb_dns_name

    custom_origin_config {
      http_port                = var.listener_port
      https_port               = 443
      origin_protocol_policy   = "http-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 60
    }

    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin_verify.result
    }
  }

  # Nothing is cached: the console is live (SSE at /api/events) and small.
  default_cache_behavior {
    target_origin_id         = "control-plane-alb"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    compress                 = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = var.tags
}
