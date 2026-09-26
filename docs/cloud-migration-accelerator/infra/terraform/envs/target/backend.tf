# Partial backend config on purpose — bucket/table names depend on the
# account ID, which only exists after `bootstrap` has been applied.
# Run: terraform init -backend-config=backend-config.hcl
# (copy backend-config.hcl.example, fill in the bucket name bootstrap
# printed as its `state_bucket` output)

terraform {
  backend "s3" {
    key     = "target/terraform.tfstate"
    region  = "ap-south-1"
    profile = "mig-target"
  }
}
