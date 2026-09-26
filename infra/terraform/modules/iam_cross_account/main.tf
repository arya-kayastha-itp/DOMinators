data "aws_caller_identity" "current" {}

# --- Account B: mig-agent-runner + mig-tf-apply ---

data "aws_iam_policy_document" "agent_runner_trust" {
  count = var.role_type == "agent_runner" ? 1 : 0

  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }
}

resource "aws_iam_role" "agent_runner" {
  count              = var.role_type == "agent_runner" ? 1 : 0
  name               = "mig-agent-runner"
  assume_role_policy = data.aws_iam_policy_document.agent_runner_trust[0].json
  tags               = var.tags
}

data "aws_iam_policy_document" "agent_runner_permissions" {
  count = var.role_type == "agent_runner" ? 1 : 0

  statement {
    sid       = "AssumeDiscoveryReadonly"
    actions   = ["sts:AssumeRole"]
    resources = ["arn:aws:iam::*:role/mig-discovery-readonly"]
  }

  statement {
    sid       = "Bedrock"
    actions   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = ["*"]
  }

  # Mutations stay limited to resources tagged managed-by=migration-accelerator.
  statement {
    sid       = "ElbModifyTagged"
    actions   = ["elasticloadbalancing:ModifyRule", "elasticloadbalancing:ModifyListener"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/managed-by"
      values   = ["migration-accelerator"]
    }
  }

  statement {
    sid       = "Ec2Tagged"
    actions   = ["ec2:RunInstances", "ec2:TerminateInstances", "ec2:CreateTags"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/managed-by"
      values   = ["migration-accelerator"]
    }
  }

  # Describe calls don't support resource-level tag conditions, so a tag
  # condition on them silently denies every call. Read-only, so unconditioned.
  statement {
    sid       = "ReadOnlyDescribe"
    actions   = ["elasticloadbalancing:Describe*", "ec2:Describe*"]
    resources = ["*"]
  }

  statement {
    sid       = "TfState"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:ListBucket", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "agent_runner" {
  count  = var.role_type == "agent_runner" ? 1 : 0
  name   = "mig-agent-runner-permissions"
  role   = aws_iam_role.agent_runner[0].id
  policy = data.aws_iam_policy_document.agent_runner_permissions[0].json
}

resource "aws_iam_role" "tf_apply" {
  count              = var.role_type == "agent_runner" ? 1 : 0
  name               = "mig-tf-apply"
  assume_role_policy = data.aws_iam_policy_document.agent_runner_trust[0].json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "tf_apply_admin" {
  count      = var.role_type == "agent_runner" ? 1 : 0
  role       = aws_iam_role.tf_apply[0].name
  policy_arn = "arn:aws:iam::aws:policy/PowerUserAccess"
}

# --- Account A: mig-discovery-readonly, trusts mig-agent-runner in B ---

data "aws_iam_policy_document" "discovery_readonly_trust" {
  count = var.role_type == "discovery_readonly" ? 1 : 0

  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "AWS"
      identifiers = [var.trusted_principal_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "sts:ExternalId"
      values   = [var.external_id]
    }
  }
}

resource "aws_iam_role" "discovery_readonly" {
  count              = var.role_type == "discovery_readonly" ? 1 : 0
  name               = "mig-discovery-readonly"
  assume_role_policy = data.aws_iam_policy_document.discovery_readonly_trust[0].json
  tags               = var.tags
}

data "aws_iam_policy_document" "discovery_readonly_permissions" {
  count = var.role_type == "discovery_readonly" ? 1 : 0

  statement {
    actions   = ["ec2:Describe*", "elasticloadbalancing:Describe*", "tag:GetResources"]
    resources = ["*"]
  }

  statement {
    actions   = ["ssm:GetParametersByPath", "ssm:GetParameters", "ssm:GetParameter"]
    resources = ["arn:aws:ssm:*:*:parameter${var.legacy_ssm_path}*"]
  }
}

resource "aws_iam_role_policy" "discovery_readonly" {
  count  = var.role_type == "discovery_readonly" ? 1 : 0
  name   = "mig-discovery-readonly-permissions"
  role   = aws_iam_role.discovery_readonly[0].id
  policy = data.aws_iam_policy_document.discovery_readonly_permissions[0].json
}
