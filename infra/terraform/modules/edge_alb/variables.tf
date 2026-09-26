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
  description = <<-EOT
    One entry per app: name, port (instance port), path_prefix (e.g. /catalog),
    priority (unique per listener). Set listener_port to give an app its own ALB
    listener instead of a path rule on :80 — needed for real web apps that break
    under a path prefix the ALB doesn't strip. health_path defaults to
    "<path_prefix>/health".
  EOT
  type = list(object({
    name          = string
    port          = number
    path_prefix   = string
    priority      = number
    listener_port = optional(number)
    health_path   = optional(string)
  }))
}

variable "tags" {
  type    = map(string)
  default = {}
}
