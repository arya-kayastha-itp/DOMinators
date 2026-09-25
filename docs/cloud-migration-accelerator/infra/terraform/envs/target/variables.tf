variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "profile" {
  type    = string
  default = "mig-target"
}

variable "azs" {
  type    = list(string)
  default = ["ap-south-1a", "ap-south-1b"]
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "public_subnet_cidrs" {
  type    = list(string)
  default = ["10.20.0.0/24", "10.20.1.0/24"]
}

variable "private_subnet_cidrs" {
  type    = list(string)
  default = ["10.20.10.0/24", "10.20.11.0/24"]
}

variable "app_port" {
  type    = number
  default = 8080
}

variable "enable_peering" {
  description = "Turn on once Nancy's legacy VPC exists and you have her account/VPC ID"
  type        = bool
  default     = false
}

variable "legacy_account_id" {
  type    = string
  default = ""
}

variable "legacy_vpc_id" {
  type    = string
  default = ""
}

variable "legacy_vpc_cidr" {
  type    = string
  default = "10.10.0.0/16"
}
