# --- Fields Blueprint's LLM is allowed to fill (see agents/blueprint/README.md) ---

variable "name" {
  description = "app_id, e.g. app-catalog"
  type        = string
}

variable "port" {
  type = number
}

variable "instance_type" {
  type = string
  validation {
    condition     = contains(["t3.micro", "t3.small"], var.instance_type)
    error_message = "instance_type must be on the allowlist: t3.micro, t3.small."
  }
}

variable "env" {
  description = "App environment variables, e.g. { UPSTREAM_URL = \"http://.../pricing\" }. Rewritten to target-side endpoints by Blueprint, never legacy IPs."
  type        = map(string)
  default     = {}
}

variable "tags" {
  description = "Must include owner, cost-center, data-class. managed-by is added by this module, not by Blueprint."
  type        = map(string)
}

variable "target_group_arn" {
  description = "tg-<app>-target ARN from the edge_alb module, for registering this instance"
  type        = string
}

variable "runtime" {
  description = "Which vetted install template runs the app. Blueprint picks one (from app_routes in target_outputs.json); it never writes install steps itself."
  type        = string
  default     = "demo-server"
  validation {
    condition     = contains(["demo-server", "juice-shop"], var.runtime)
    error_message = "runtime must be one of: demo-server, juice-shop."
  }
}

# --- Wiring vars: filled from target_outputs.json by the Blueprint template, never by the LLM ---

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "security_group_name" {
  description = "The pre-created, shared mig-golden-app SG (ingress from the edge ALB only) — created once in envs/target, never per app"
  type        = string
  default     = "mig-golden-app"
}

variable "kms_key_alias" {
  type    = string
  default = "alias/mig-ebs"
}

variable "instance_profile_name" {
  type    = string
  default = "mig-app-instance"
}

variable "path_prefix" {
  description = "e.g. /catalog — the ALB doesn't strip prefixes, so the app must answer on both / and this prefix"
  type        = string
  default     = ""
}
