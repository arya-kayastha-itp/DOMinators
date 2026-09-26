locals {
  apps = { for app in var.apps : app.name => app }

  # Apps that get their own listener port instead of a path rule on :80.
  dedicated = { for k, app in local.apps : k => app if app.listener_port != null }
}

resource "aws_security_group" "alb" {
  name        = "${var.name_prefix}-alb"
  description = "Edge ALB - HTTP from the internet, demo only"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  dynamic "ingress" {
    for_each = local.dedicated
    content {
      from_port   = ingress.value.listener_port
      to_port     = ingress.value.listener_port
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-alb" })
}

resource "aws_lb" "this" {
  name               = var.name_prefix
  internal           = false
  load_balancer_type = "application"
  subnets            = var.public_subnet_ids
  security_groups    = [aws_security_group.alb.id]

  tags = var.tags
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "application/json"
      status_code  = "404"
      message_body = "{\"error\":\"no matching app\"}"
    }
  }
}

resource "aws_lb_listener" "dedicated" {
  for_each          = local.dedicated
  load_balancer_arn = aws_lb.this.arn
  port              = each.value.listener_port
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "application/json"
      status_code  = "404"
      message_body = "{\"error\":\"no matching app\"}"
    }
  }
}

resource "aws_lb_target_group" "legacy" {
  for_each    = local.apps
  name        = "tg-${each.value.name}-legacy"
  port        = each.value.port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = coalesce(each.value.health_path, "${each.value.path_prefix}/health")
    interval            = 5
    timeout             = 4
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = var.tags
}

resource "aws_lb_target_group" "target" {
  for_each    = local.apps
  name        = "tg-${each.value.name}-target"
  port        = each.value.port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "instance"

  health_check {
    path                = coalesce(each.value.health_path, "${each.value.path_prefix}/health")
    interval            = 5
    timeout             = 4
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = var.tags
}

# One rule per app either way, so Cutover always shifts weights with
# ModifyRule on listener_rule_arns[app], whichever listener the app is on.
resource "aws_lb_listener_rule" "this" {
  for_each     = local.apps
  listener_arn = each.value.listener_port != null ? aws_lb_listener.dedicated[each.key].arn : aws_lb_listener.http.arn
  priority     = each.value.priority

  condition {
    path_pattern {
      values = each.value.listener_port != null ? ["/*"] : ["${each.value.path_prefix}/*", each.value.path_prefix]
    }
  }

  # Weights start 100/0 (all legacy). Cutover flips these with elbv2:ModifyRule.
  action {
    type = "forward"
    forward {
      target_group {
        arn    = aws_lb_target_group.legacy[each.key].arn
        weight = 100
      }
      target_group {
        arn    = aws_lb_target_group.target[each.key].arn
        weight = 0
      }
    }
  }
}
