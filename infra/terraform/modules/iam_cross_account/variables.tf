variable "role_type" {
  description = "Which cross-account role to create: \"agent_runner\" (Account B) or \"discovery_readonly\" (Account A)"
  type        = string
  validation {
    condition     = contains(["agent_runner", "discovery_readonly"], var.role_type)
    error_message = "role_type must be \"agent_runner\" or \"discovery_readonly\"."
  }
}

variable "trusted_principal_arn" {
  description = "For discovery_readonly: the mig-agent-runner role ARN in Account B allowed to assume this role. For agent_runner: leave null, trust is the account's own IAM users/SSO."
  type        = string
  default     = null
}

variable "external_id" {
  description = "ExternalId required on the cross-account AssumeRole call. Required for discovery_readonly."
  type        = string
  default     = null
}

variable "legacy_ssm_path" {
  description = "SSM parameter path prefix the discovery_readonly role may read"
  type        = string
  default     = "/legacy/"
}

variable "tags" {
  type    = map(string)
  default = {}
}
