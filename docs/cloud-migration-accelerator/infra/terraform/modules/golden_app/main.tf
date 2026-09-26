# Everything in this file is hardcoded on purpose — see agents/blueprint/README.md
# "Finding -> fix map". Blueprint's LLM only ever fills the variables in
# variables.tf marked "Fields Blueprint's LLM is allowed to fill"; it never
# touches AMI selection, encryption, IMDS, or networking directly.

data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

data "aws_kms_alias" "ebs" {
  name = var.kms_key_alias
}

data "aws_iam_instance_profile" "app" {
  name = var.instance_profile_name
}

data "aws_security_group" "golden" {
  filter {
    name   = "tag:Name"
    values = [var.security_group_name]
  }
  filter {
    name   = "vpc-id"
    values = [var.vpc_id]
  }
}

locals {
  subnet_id  = var.private_subnet_ids[0]
  final_tags = merge(
    var.tags,
    {
      "managed-by" = "migration-accelerator"
      "app"        = var.name
    },
  )
}

resource "aws_instance" "this" {
  ami                    = data.aws_ssm_parameter.al2023.value
  instance_type          = var.instance_type
  subnet_id              = local.subnet_id
  vpc_security_group_ids = [data.aws_security_group.golden.id]
  iam_instance_profile   = data.aws_iam_instance_profile.app.name

  # Hardcoded hardening — never an LLM input.
  metadata_options {
    http_tokens   = "required"
    http_endpoint = "enabled"
  }

  root_block_device {
    encrypted   = true
    kms_key_id  = data.aws_kms_alias.ebs.target_key_arn
    volume_type = "gp3"
    volume_size = 8
  }

  user_data = templatefile("${path.module}/templates/user_data.sh.tpl", {
    server_py   = file("${path.module}/../../../../app/server.py")
    app_id      = var.name
    served_by   = "target"
    port        = var.port
    path_prefix = var.path_prefix
    env_vars    = var.env
  })

  tags = local.final_tags
}

resource "aws_lb_target_group_attachment" "this" {
  target_group_arn = var.target_group_arn
  target_id        = aws_instance.this.id
  port             = var.port
}
