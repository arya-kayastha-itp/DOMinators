output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "alb_security_group_id" {
  value = aws_security_group.alb.id
}

output "listener_arn" {
  value = aws_lb_listener.http.arn
}

output "listener_rule_arns" {
  value = { for k, v in aws_lb_listener_rule.this : k => v.arn }
}

output "target_group_arns" {
  value = { for k, v in aws_lb_target_group.target : k => v.arn }
}

output "legacy_target_group_arns" {
  value = { for k, v in aws_lb_target_group.legacy : k => v.arn }
}
