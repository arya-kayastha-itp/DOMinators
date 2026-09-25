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

resource "aws_lb_target_group" "legacy" {
  for_each    = { for app in var.apps : app.name => app }
  name        = "tg-${each.value.name}-legacy"
  port        = each.value.port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "${each.value.path_prefix}/health"
    interval            = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = var.tags
}

resource "aws_lb_target_group" "target" {
  for_each    = { for app in var.apps : app.name => app }
  name        = "tg-${each.value.name}-target"
  port        = each.value.port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "instance"

  health_check {
    path                = "${each.value.path_prefix}/health"
    interval            = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = var.tags
}

resource "aws_lb_listener_rule" "this" {
  for_each     = { for app in var.apps : app.name => app }
  listener_arn = aws_lb_listener.http.arn
  priority     = each.value.priority

  condition {
    path_pattern {
      values = ["${each.value.path_prefix}/*", each.value.path_prefix]
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
