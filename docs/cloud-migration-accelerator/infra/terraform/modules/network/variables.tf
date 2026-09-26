variable "name_prefix" {
  description = "Prefix for resource names, e.g. \"mig-target\" or \"mig-legacy\""
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
}

variable "azs" {
  description = "Availability zones to spread subnets across"
  type        = list(string)
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for the public subnets, one per AZ"
  type        = list(string)
}

variable "create_private_tier" {
  description = "Whether this VPC gets a private-subnet tier + NAT gateway. false means the VPC has NO private subnet at all (NO_VPC_SEGMENTATION, deliberately, for the legacy account)."
  type        = bool
  default     = false
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for the private subnets, one per AZ. Ignored when create_private_tier is false."
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Tags applied to every resource this module creates"
  type        = map(string)
  default     = {}
}
