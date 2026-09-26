# Account A (Legacy) — CloudFormation deploy steps

## Option A: one file, one stack (recommended for the demo)

[account-a-all-in-one.yaml](account-a-all-in-one.yaml) creates everything —
network, the cross-account readonly IAM role, and the 3 legacy apps with
their dependency wiring — in a single stack.

```bash
aws cloudformation deploy --profile mig-legacy \
  --stack-name mig-legacy-all \
  --template-file account-a-all-in-one.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    KeyName=mig-legacy-key \
    OldAmiId=<ami-xxxxxxxx> \
    AccountBId=<ACCOUNT_B_ID> \
    ExternalId=<generate-a-random-string>
```

`PeeringConnectionId` is left blank by default (route is skipped). Once
Account B's peering requester exists and you've accepted it:

```bash
aws ec2 accept-vpc-peering-connection --profile mig-legacy \
  --vpc-peering-connection-id <pcx-id>

aws cloudformation deploy --profile mig-legacy \
  --stack-name mig-legacy-all \
  --template-file account-a-all-in-one.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    KeyName=mig-legacy-key \
    OldAmiId=<ami-xxxxxxxx> \
    AccountBId=<ACCOUNT_B_ID> \
    ExternalId=<same-string-as-before> \
    PeeringConnectionId=<pcx-id>
```

Verify and tear down the same way as below, just against stack
`mig-legacy-all` instead of the four separate ones.

Teardown:
```bash
aws cloudformation delete-stack --profile mig-legacy --stack-name mig-legacy-all
```

---

## Option B: 4 separate stacks (finer-grained, matches the original plan)

Stacks apply in order. Each exports values the next one imports.

## 0. Prerequisites

```ini
# ~/.aws/config
[profile mig-legacy]
region = us-east-1
```

```bash
aws sts get-caller-identity --profile mig-legacy
```

Create a throwaway EC2 key pair for legacy SSH access (SSH-open is intentional):
```bash
aws ec2 create-key-pair --profile mig-legacy --key-name mig-legacy-key \
  --query 'KeyMaterial' --output text > mig-legacy-key.pem
chmod 400 mig-legacy-key.pem
```

Look up a real but **outdated** Amazon Linux 2 AMI ID for `us-east-1` (do this manually — an old dated AMI, not the "latest" SSM parameter) and note it for step 4.

## 1. Network

```bash
aws cloudformation deploy --profile mig-legacy \
  --stack-name mig-legacy-network \
  --template-file 01-network.yaml \
  --parameter-overrides EnvName=mig-legacy
```

## 2. Peering route (after Account B's requester stack exists)

Accept the peering request Account B created (one-time CLI step — CloudFormation can't accept a cross-account peering declaratively):

```bash
aws ec2 accept-vpc-peering-connection --profile mig-legacy \
  --vpc-peering-connection-id <pcx-id-from-account-B>
```

Then add the return route:

```bash
aws cloudformation deploy --profile mig-legacy \
  --stack-name mig-legacy-peering-route \
  --template-file 02-peering-route.yaml \
  --parameter-overrides EnvName=mig-legacy PeeringConnectionId=<pcx-id> TargetVpcCidr=10.20.0.0/16
```

## 3. Cross-account readonly role

```bash
aws cloudformation deploy --profile mig-legacy \
  --stack-name mig-legacy-iam \
  --template-file 03-iam-readonly-role.yaml \
  --parameter-overrides AccountBId=<ACCOUNT_B_ID> ExternalId=<generate-a-random-string> \
  --capabilities CAPABILITY_NAMED_IAM
```

**Test immediately from Account B** before building anything else on top of it:

```bash
aws sts assume-role --profile mig-target \
  --role-arn arn:aws:iam::<ACCOUNT_A_ID>:role/mig-discovery-readonly \
  --role-session-name test --external-id <same-external-id>
```

## 4. The 3 legacy apps

```bash
aws cloudformation deploy --profile mig-legacy \
  --stack-name mig-legacy-apps \
  --template-file 04-legacy-apps.yaml \
  --parameter-overrides \
    EnvName=mig-legacy \
    KeyName=mig-legacy-key \
    OldAmiId=<ami-xxxxxxxx> \
    TargetVpcCidr=10.20.0.0/16
```

## 5. Verify

```bash
CATALOG_IP=$(aws cloudformation describe-stacks --profile mig-legacy \
  --stack-name mig-legacy-apps --query "Stacks[0].Outputs[?OutputKey=='CatalogPublicIp'].OutputValue" --output text)
ORDERS_IP=$(aws cloudformation describe-stacks --profile mig-legacy \
  --stack-name mig-legacy-apps --query "Stacks[0].Outputs[?OutputKey=='OrdersPublicIp'].OutputValue" --output text)

curl http://$CATALOG_IP:8080/health
curl http://$ORDERS_IP:8080/       # should show the nested upstream chain: orders -> pricing -> catalog

aws ssm get-parameters-by-path --profile mig-legacy --path /legacy/ --recursive
```

Checklist (Checkpoint 1, hour 8):
- [ ] All 3 apps: `200` on `/health`, correct nested JSON on `/`
- [ ] 7 findings present: `SG_OPEN_SSH`, `SG_OPEN_APP`, `EBS_UNENCRYPTED`, `IMDSV1`, `OLD_AMI`, `PUBLIC_IP` (all 3), `MISSING_TAGS` (pricing + orders)
- [ ] Dependencies discoverable 3 ways: `depends-on` tag, `/legacy/<app>/*_URL` SSM param, SG-to-SG ingress reference
- [ ] `mig-discovery-readonly` assumable from Account B, `describe`/`GetParametersByPath` calls succeed
- [ ] Peering route to `10.20.0.0/16` in place

## Teardown

Delete in reverse order (apps first, network last), and **destroy Account B's stacks before this one** — the peering connection and ALB IP targets depend on this VPC:

```bash
aws cloudformation delete-stack --profile mig-legacy --stack-name mig-legacy-apps
aws cloudformation delete-stack --profile mig-legacy --stack-name mig-legacy-iam
aws cloudformation delete-stack --profile mig-legacy --stack-name mig-legacy-peering-route
aws cloudformation delete-stack --profile mig-legacy --stack-name mig-legacy-network
```
