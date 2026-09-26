variable "name_prefix" {
  type    = string
  default = "mig-edge"
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "apps" {
  description = "One entry per app: name, port, path_prefix (e.g. /catalog), priority (unique per app)"
  type = list(object({
    name        = string
    port        = number
    path_prefix = string
    priority    = number
  }))
}

variable "tags" {
  type    = map(string)
  default = {}
}
