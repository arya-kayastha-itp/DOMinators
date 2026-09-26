// Static labels for backend codes (no numbers here — every count comes from the orchestrator).
import type { AppRecord, EdgeSignal, FindingCode, Tier, Tiering } from '@/lib/contracts'

// View model the UI renders: AppRecord joined with its Tiering (GET /fleet).
export type FleetApp = AppRecord & { tier: Tier; score: number; tiering: Tiering }

export const EDGE_SIGNAL_LABEL: Record<EdgeSignal, string> = {
  tag: 'depends-on tag',
  ssm: 'SSM parameter holds provider IP',
  env: 'env value references provider',
  sg_ref: 'security-group reference',
  flow_log: 'VPC flow logs',
  synthetic: 'synthetic',
}

// Fix text mirrors agents/blueprint/diff.py and modules/golden_app.
export const FINDING_META: Record<FindingCode, { label: string; fix: string; severity: 'critical' | 'high' | 'medium' }> = {
  NO_VPC_SEGMENTATION: { label: 'No VPC segmentation', fix: "Placed in the target VPC's private-subnet tier (no IGW route)", severity: 'critical' },
  PUBLIC_IP: { label: 'Public IP', fix: 'Private subnet, no public IP', severity: 'high' },
  SG_OPEN_SSH: { label: 'SSH open to world', fix: 'Port 22 removed; SSM Session Manager', severity: 'critical' },
  SG_OPEN_APP: { label: 'App port open to world', fix: 'Ingress from the edge ALB security group only', severity: 'high' },
  EBS_UNENCRYPTED: { label: 'Unencrypted EBS', fix: 'KMS-encrypted gp3', severity: 'high' },
  IMDSV1: { label: 'IMDSv1 allowed', fix: 'http_tokens = "required" (IMDSv2)', severity: 'medium' },
  OLD_AMI: { label: 'Outdated AMI', fix: 'Latest AL2023 via SSM parameter', severity: 'medium' },
  MISSING_TAGS: { label: 'Missing tags', fix: 'owner / cost-center / data-class enforced, gaps flagged', severity: 'medium' },
  HARDCODED_IP: { label: 'Hardcoded IP', fix: 'UPSTREAM_URL rewritten to the ALB path', severity: 'medium' },
  STATEFUL: { label: 'Stateful', fix: 'Needs a data-migration plan — parked', severity: 'critical' },
}

export const TARGET_DATE = '2027-12-31'
