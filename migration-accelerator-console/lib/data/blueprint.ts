import type { BlueprintResult, DiffAnnotation, FindingCode } from '@/lib/contracts'
import { FINDING_META, fleetById } from './fleet'

// Values from data/target_outputs.json (Account B, live). Blueprint reads these —
// the LLM never does. Mirrors docs/TRACK_3 T3-B-4.
export const TARGET = {
  account: '408336117553',
  region: 'ap-south-1',
  alb_dns: 'mig-edge-alb-1536629619.ap-south-1.elb.amazonaws.com',
  state_bucket: 'mig-tfstate-408336117553',
  vpc_id: 'vpc-06b381c1e65577891',
  private_subnets: ['subnet-09486f771159b9ee2', 'subnet-0e294b7c30225765f'],
  tg_target: {
    'app-catalog': 'arn:aws:elasticloadbalancing:ap-south-1:408336117553:targetgroup/tg-app-catalog-target/23ffea897f6d8bad',
    'app-pricing': 'arn:aws:elasticloadbalancing:ap-south-1:408336117553:targetgroup/tg-app-pricing-target/ea86754954546453',
    'app-orders': 'arn:aws:elasticloadbalancing:ap-south-1:408336117553:targetgroup/tg-app-orders-target/319cef1246934b13',
  } as Record<string, string>,
  tg_legacy: {
    'app-catalog': 'arn:aws:elasticloadbalancing:ap-south-1:408336117553:targetgroup/tg-app-catalog-legacy/2945dbdb34c8a6b6',
    'app-pricing': 'arn:aws:elasticloadbalancing:ap-south-1:408336117553:targetgroup/tg-app-pricing-legacy/6a5c21307a8dc2bb',
    'app-orders': 'arn:aws:elasticloadbalancing:ap-south-1:408336117553:targetgroup/tg-app-orders-legacy/31f3b687d7be7763',
  } as Record<string, string>,
  listener_rule: {
    'app-catalog': 'arn:aws:elasticloadbalancing:ap-south-1:408336117553:listener-rule/app/mig-edge-alb/176961faee0bc9a2/9e5e781bf6d52473/e01bf831a0a8dcfd',
    'app-pricing': 'arn:aws:elasticloadbalancing:ap-south-1:408336117553:listener-rule/app/mig-edge-alb/176961faee0bc9a2/9e5e781bf6d52473/81717f836727c7a3',
    'app-orders': 'arn:aws:elasticloadbalancing:ap-south-1:408336117553:listener-rule/app/mig-edge-alb/176961faee0bc9a2/9e5e781bf6d52473/ee5f9bc1fc550223',
  } as Record<string, string>,
}

const prefix = (appId: string) => `/${appId.replace(/^app-/, '')}`

export function buildBlueprint(appId: string, opts: { badWave?: boolean } = {}): BlueprintResult {
  const app = fleetById.get(appId)
  if (!app) throw new Error(`unknown app ${appId}`)

  // --- inputs (what set_golden_inputs / the rules mapper produce) ---
  const provider = app.depends_on[0]
  const env: Record<string, string> = {}
  if (provider) {
    env.UPSTREAM_URL = `http://${TARGET.alb_dns}${prefix(provider)}/`
    env.REQUIRE_UPSTREAM = '1'
  }
  if (opts.badWave && provider) delete env.UPSTREAM_URL // T3-B-8: dropped *after* validation
  const gaps: BlueprintResult['gaps'] = []
  const tags: Record<string, string> = {}
  for (const k of ['owner', 'cost-center', 'data-class'] as const) {
    if (app.tags[k]) tags[k] = app.tags[k]
    else {
      tags[k] = k === 'data-class' ? 'internal' : 'unknown'
      gaps.push({ field: k, note: 'not found in legacy tags; safe default applied, flagged for owner review' })
    }
  }

  // --- before: readable legacy summary ---
  const legacyEnv = Object.entries(app.config.env)
  const before: string[] = [
    `# ${app.app_id} — legacy (Account A · mig-legacy)`,
    `instance_type          = "${app.runtime.instance_type}"`,
    `ami                    = "${app.runtime.ami_id}"   # ${app.runtime.ami_age_days} days old, deprecated`,
    `subnet                 = public (route 0.0.0.0/0 -> igw)`,
    `vpc_private_tier       = none`,
    `associate_public_ip    = true`,
    `key_name               = "mig-legacy-key"`,
    `ingress 22   from 0.0.0.0/0`,
    `ingress 8080 from 0.0.0.0/0`,
    `root_block_device      = { encrypted = false, type = "gp2" }`,
    `metadata_options       = { http_tokens = "optional" }`,
    ...(legacyEnv.length ? legacyEnv.map(([k, v]) => `env ${k.padEnd(18)} = "${v}"`) : ['env                    = {}']),
    `tags                   = { ${Object.entries(app.tags).filter(([k]) => k !== 'Name').map(([k, v]) => `${k} = "${v}"`).join(', ') || '— none —'} }`,
  ]

  // --- after: the generated main.tf (only inputs are variable; hardening lives in the module) ---
  const envLines = Object.entries(env).map(([k, v]) => `    ${k.padEnd(16)} = "${v}"`)
  const after: string[] = [
    `# generated/${app.app_id}/main.tf — rendered from templates/main.tf.j2`,
    `terraform {`,
    `  backend "s3" {`,
    `    bucket = "${TARGET.state_bucket}"`,
    `    key    = "generated/${app.app_id}/terraform.tfstate"`,
    `    region = "${TARGET.region}"`,
    `  }`,
    `}`,
    ``,
    `module "app" {`,
    `  source        = "../../infra/terraform/modules/golden_app"`,
    `  name          = "${app.app_id}"`,
    `  port          = ${app.runtime.port}`,
    `  instance_type = "${app.runtime.instance_type}"`,
    `  path_prefix   = "${prefix(app.app_id)}"`,
    `  env = {`,
    ...(envLines.length ? envLines : ['    # no upstream dependencies']),
    `  }`,
    `  tags = {`,
    ...Object.entries(tags).map(([k, v]) => `    "${k}" = "${v}"${gaps.some(g => g.field === k) ? '   # gap flagged' : ''}`),
    `  }`,
    `  # wiring — from target_outputs.json, never the LLM`,
    `  target_group_arn   = "${TARGET.tg_target[app.app_id] ?? 'arn:…'}"`,
    `  vpc_id             = "${TARGET.vpc_id}"`,
    `  private_subnet_ids = ${JSON.stringify(TARGET.private_subnets)}`,
    `}`,
    ``,
    `# hardcoded inside golden_app (never an input):`,
    `#   private subnet · no public IP · no key pair (SSM only)`,
    `#   ingress 8080 from edge ALB SG only`,
    `#   root volume gp3, KMS alias/mig-ebs`,
    `#   http_tokens = "required" (IMDSv2)`,
    `#   AMI = latest AL2023 (SSM parameter)`,
    `#   tag managed-by = migration-accelerator`,
  ]

  const find = (lines: string[], needle: string) => { const i = lines.findIndex(l => l.includes(needle)); return i < 0 ? null : i + 1 }
  const anchor: Record<FindingCode, [string, string]> = {
    NO_VPC_SEGMENTATION: ['vpc_private_tier', 'private subnet'],
    PUBLIC_IP: ['associate_public_ip', 'no public IP'],
    SG_OPEN_SSH: ['ingress 22', 'no key pair'],
    SG_OPEN_APP: ['ingress 8080', 'edge ALB SG only'],
    EBS_UNENCRYPTED: ['root_block_device', 'KMS alias'],
    IMDSV1: ['metadata_options', 'IMDSv2'],
    OLD_AMI: ['ami ', 'latest AL2023'],
    MISSING_TAGS: ['tags ', 'tags = {'],
    HARDCODED_IP: ['env ', 'UPSTREAM_URL'],
    STATEFUL: ['', ''],
  }
  const annotations: DiffAnnotation[] = app.findings
    .filter(f => f !== 'STATEFUL')
    .map(f => ({ finding: f, before_line: find(before, anchor[f][0]), after_line: find(after, anchor[f][1]), fix: FINDING_META[f].fix }))

  return {
    app_id: app.app_id,
    blueprint: 'golden_app@v1',
    inputs: { name: app.app_id, port: app.runtime.port, instance_type: app.runtime.instance_type, env, tags },
    fixes: annotations.map(a => ({ finding: a.finding, fix: a.fix })),
    gaps,
    diff: { before: before.join('\n'), after: after.join('\n'), annotations },
    tf_dir: `generated/${app.app_id}`,
    validate_ok: true,
    applied: false,
    outputs: {
      instance_ids: [],
      tg_target_arn: TARGET.tg_target[app.app_id] ?? '',
      tg_legacy_arn: TARGET.tg_legacy[app.app_id] ?? '',
      listener_rule_arn: TARGET.listener_rule[app.app_id] ?? '',
    },
    status: 'BLUEPRINTED',
  }
}
