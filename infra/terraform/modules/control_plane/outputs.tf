output "url" {
  value = "https://${aws_cloudfront_distribution.this.domain_name}"
}

output "instance_id" {
  value = aws_instance.this.id
}

output "releases_bucket" {
  value = aws_s3_bucket.releases.bucket
}

output "ssm_prefix" {
  value = var.ssm_prefix
}

output "role_arn" {
  value = aws_iam_role.this.arn
}
