output "agent_runner_role_arn" {
  value = var.role_type == "agent_runner" ? aws_iam_role.agent_runner[0].arn : null
}

output "tf_apply_role_arn" {
  value = var.role_type == "agent_runner" ? aws_iam_role.tf_apply[0].arn : null
}

output "discovery_readonly_role_arn" {
  value = var.role_type == "discovery_readonly" ? aws_iam_role.discovery_readonly[0].arn : null
}
