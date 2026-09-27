variable "name_prefix" {
  type    = string
  default = "mig-control-plane"
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "alb_arn" {
  type = string
}

variable "alb_dns_name" {
  type = string
}

variable "alb_security_group_id" {
  type = string
}

# ALB port CloudFront talks to. The listener only forwards requests carrying
# the secret origin header CloudFront adds; anything else gets a 403.
variable "listener_port" {
  type    = number
  default = 8088
}

# Roles the orchestrator assumes (mig-agent-runner for ALB weights/discovery,
# mig-tf-apply for golden_app terraform). The box itself gets nothing else.
variable "assumable_role_arns" {
  type = list(string)
}

# SSM Parameter Store prefix for the box's secrets (the .env it runs with).
variable "ssm_prefix" {
  type    = string
  default = "/mig/control-plane"
}

variable "instance_type" {
  type    = string
  default = "t3.small"
}

variable "terraform_version" {
  type    = string
  default = "1.9.8"
}

variable "tags" {
  type = map(string)
}
