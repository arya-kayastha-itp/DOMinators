output "vpc_id" {
  value = module.network.vpc_id
}

output "private_subnet_ids" {
  value = module.network.private_subnet_ids
}

output "public_subnet_ids" {
  value = module.network.public_subnet_ids
}

output "alb_dns_name" {
  value = module.edge_alb.alb_dns_name
}

output "alb_security_group_id" {
  value = module.edge_alb.alb_security_group_id
}

output "listener_arn" {
  value = module.edge_alb.listener_arn
}

output "listener_rule_arns" {
  value = module.edge_alb.listener_rule_arns
}

output "target_group_arns" {
  value = module.edge_alb.target_group_arns
}

output "legacy_target_group_arns" {
  value = module.edge_alb.legacy_target_group_arns
}

output "golden_security_group_id" {
  value = aws_security_group.golden_app.id
}

output "golden_instance_profile_name" {
  value = aws_iam_instance_profile.app_instance.name
}

output "kms_key_alias" {
  value = aws_kms_alias.ebs.name
}

output "agent_runner_role_arn" {
  value = module.iam_cross_account.agent_runner_role_arn
}

output "tf_apply_role_arn" {
  value = module.iam_cross_account.tf_apply_role_arn
}

output "app_routes" {
  description = "Per-app routing + hosting facts Blueprint/Cutover need: path_prefix and priority on :80, or a dedicated listener_port; health_path; golden_app runtime."
  value = {
    for a in local.apps : a.name => {
      path_prefix   = a.path_prefix
      priority      = a.priority
      port          = a.port
      listener_port = try(a.listener_port, null)
      health_path   = try(a.health_path, "${a.path_prefix}/health")
      runtime       = lookup(local.app_runtimes, a.name, "demo-server")
    }
  }
}

output "app_hello_private_ip" {
  value = module.app_hello.private_ip
}
