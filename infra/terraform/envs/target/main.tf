terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region  = var.region
  profile = var.profile
}

locals {
  tags = {
    "managed-by"  = "migration-accelerator"
    "owner"       = "priyansh"
    "cost-center" = "hackathon"
    "data-class"  = "internal"
  }

  # Real apps migrate here later, via Blueprint's own terraform apply into
  # generated/<app>/main.tf — this env only pre-creates their ALB rules
  # and target groups, per infra/README.md's build order step 8.
  apps = [
    { name = "app-catalog", port = var.app_port, path_prefix = "/catalog", priority = 10 },
    { name = "app-pricing", port = var.app_port, path_prefix = "/pricing", priority = 20 },
    { name = "app-orders", port = var.app_port, path_prefix = "/orders", priority = 30 },
    # OWASP Juice Shop is a single-page app with absolute asset paths, so it
    # gets its own ALB port rather than a path prefix. Its container maps
    # host 8080 -> 3000 on both sides, so instance port and SGs stay 8080.
    # app-gitea is deliberately absent: it's stateful, tiers Red and is
    # parked by Planning, so it never migrates here.
    { name = "app-juice-shop", port = var.app_port, path_prefix = "", priority = 10, listener_port = 3000, health_path = "/" },
  ]

  # golden_app runtime per app; anything not listed runs app/server.py.
  app_runtimes = {
    "app-juice-shop" = "juice-shop"
  }

  control_plane_port = 8088
}

# --- Network: full public/private tiering, unlike legacy ---

module "network" {
  source = "../../modules/network"

  name_prefix          = "mig-target"
  vpc_cidr             = var.vpc_cidr
  azs                  = var.azs
  public_subnet_cidrs  = var.public_subnet_cidrs
  create_private_tier  = true
  private_subnet_cidrs = var.private_subnet_cidrs
  tags                 = local.tags
}

# --- Edge ALB + per-app weighted target groups (weights start 100/0) ---

module "edge_alb" {
  source = "../../modules/edge_alb"

  name_prefix       = "mig-edge-alb"
  vpc_id            = module.network.vpc_id
  public_subnet_ids = module.network.public_subnet_ids
  apps              = local.apps
  tags              = local.tags

  # The control plane's CloudFront-only listener (modules/control_plane).
  extra_ingress_ports = [local.control_plane_port]
}

# --- Pre-created golden resources: shared across every golden_app instance ---

resource "aws_kms_key" "ebs" {
  description = "EBS encryption for golden_app instances"
  tags        = local.tags
}

resource "aws_kms_alias" "ebs" {
  name          = "alias/mig-ebs"
  target_key_id = aws_kms_key.ebs.key_id
}

resource "aws_security_group" "golden_app" {
  name        = "mig-golden-app"
  description = "golden_app instances - ingress from the edge ALB only"
  vpc_id      = module.network.vpc_id

  ingress {
    from_port       = var.app_port
    to_port         = var.app_port
    protocol        = "tcp"
    security_groups = [module.edge_alb.alb_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, { Name = "mig-golden-app" })
}

data "aws_iam_policy_document" "app_instance_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app_instance" {
  name               = "mig-app-instance"
  assume_role_policy = data.aws_iam_policy_document.app_instance_trust.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "app_instance_ssm" {
  role       = aws_iam_role.app_instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "app_instance" {
  name = "mig-app-instance"
  role = aws_iam_role.app_instance.name
}

# --- Cross-account agent roles ---

module "iam_cross_account" {
  source = "../../modules/iam_cross_account"

  role_type = "agent_runner"
  tags      = local.tags
}

# --- Reference app: app-hello, proves the golden module works live ---
# Not part of the legacy/target weighted migration pattern (no legacy
# counterpart), so it gets its own simple, always-forward rule.

resource "aws_lb_target_group" "hello" {
  name        = "tg-app-hello"
  port        = var.app_port
  protocol    = "HTTP"
  vpc_id      = module.network.vpc_id
  target_type = "instance"

  health_check {
    path                = "/hello/health"
    interval            = 5
    timeout             = 4
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = local.tags
}

resource "aws_lb_listener_rule" "hello" {
  listener_arn = module.edge_alb.listener_arn
  priority     = 5

  condition {
    path_pattern {
      values = ["/hello/*", "/hello"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.hello.arn
  }
}

module "app_hello" {
  source = "../../modules/golden_app"

  name          = "app-hello"
  port          = var.app_port
  instance_type = "t3.micro"
  env           = {}
  tags          = local.tags

  target_group_arn   = aws_lb_target_group.hello.arn
  vpc_id             = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids
  path_prefix        = "/hello"

  # Value references, not a module-level depends_on: depends_on defers every
  # data source in the module (AMI, KMS key) whenever anything upstream has
  # pending changes, which turns an unrelated ALB change into a forced
  # replacement of this instance.
  security_group_name   = aws_security_group.golden_app.tags["Name"]
  instance_profile_name = aws_iam_instance_profile.app_instance.name
  kms_key_alias         = aws_kms_alias.ebs.name
}

# --- VPC peering to the legacy account (requester side) ---
# Off by default: turn on once Nancy's legacy VPC exists.

resource "aws_vpc_peering_connection" "to_legacy" {
  count         = var.enable_peering ? 1 : 0
  vpc_id        = module.network.vpc_id
  peer_vpc_id   = var.legacy_vpc_id
  peer_owner_id = var.legacy_account_id
  auto_accept   = false

  tags = merge(local.tags, { Name = "mig-target-to-legacy", Side = "requester" })
}

resource "aws_route" "public_to_legacy" {
  count                     = var.enable_peering ? 1 : 0
  route_table_id            = module.network.public_route_table_id
  destination_cidr_block    = var.legacy_vpc_cidr
  vpc_peering_connection_id = aws_vpc_peering_connection.to_legacy[0].id
}

# --- Control plane: the deployed DOMinators console + orchestrator ---
# Public HTTPS via CloudFront; viewers are read-only, actions need the
# operator key (orchestrator/main.py). Deploy code with
# scripts/deploy_control_plane.py.

module "control_plane" {
  source = "../../modules/control_plane"

  vpc_id                = module.network.vpc_id
  private_subnet_ids    = module.network.private_subnet_ids
  alb_arn               = module.edge_alb.alb_arn
  alb_dns_name          = module.edge_alb.alb_dns_name
  alb_security_group_id = module.edge_alb.alb_security_group_id
  listener_port         = local.control_plane_port
  assumable_role_arns   = [module.iam_cross_account.agent_runner_role_arn, module.iam_cross_account.tf_apply_role_arn]
  tags                  = local.tags
}
