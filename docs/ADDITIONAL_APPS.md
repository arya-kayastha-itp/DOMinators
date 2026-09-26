# Additional legacy apps: OWASP Juice Shop + Gitea

Two real, open-source apps join the 3 demo services in Account A. Each one
demonstrates something the existing apps can't:

| App | Tier Discovery should give it | What the demo shows |
|---|---|---|
| `app-juice-shop` (OWASP Juice Shop `v20.2.0`) | **Golden**: stateless, since it resets its own SQLite DB on every start | A recognizable, deliberately insecure real app migrating end-to-end |
| `app-gitea` (Gitea `1.27.3`) | **Red**: tagged `stateful=true` (repos/users live on the instance disk) | The accelerator refusing to blindly rehost a stateful app; Planning parks it |

Sock Shop was considered and dropped: it needs MySQL, MongoDB and RabbitMQ, its
Java services don't fit a 1 GiB `t3.micro`, and the project is archived.

Both apps run in Docker with **host port 8080 → container port 3000**, so the
security groups, target groups and health checks keep the same port as every
other app.

**Who does what:** Arya and Palak write and verify the template changes (Arya:
Juice Shop, Palak: Gitea). Nancy owns the `mig-legacy-all` stack and runs the
deploy. Priyansh does the Account B side (§3).

---

## 1. Account A (legacy) — CloudFormation changes

### 1.1 Start from the *deployed* template, not the repo copy

CloudFormation → stack **`mig-legacy-all`** → **Template** tab → copy the whole
body into a local file (e.g. `account-a-v3.yaml`). Editing the exact deployed
body guarantees the update only adds what's below. If the repo's
`infra/cloudformation/legacy/account-a-v2.yaml` has drifted from what's
deployed, a stack update from it could silently change existing resources.

### 1.2 Add these 4 resources under `Resources:` (after `OrdersInstance`)

They copy the existing `CatalogSG` / `CatalogInstance` pattern exactly: old
Amazon Linux 2 AMI, IMDSv1, unencrypted gp2, public subnet, open SGs. The AMI is
Amazon Linux 2, which is why Docker comes from `amazon-linux-extras`, not `dnf`.

```yaml
  # ================= app-juice-shop (real app, stateless -> Golden) =================

  JuiceShopSG:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: app-juice-shop SG - deliberately open
      VpcId: !Ref VPC
      SecurityGroupIngress:
        - IpProtocol: tcp
          FromPort: 22
          ToPort: 22
          CidrIp: 0.0.0.0/0
        - IpProtocol: tcp
          FromPort: 8080
          ToPort: 8080
          CidrIp: 0.0.0.0/0
        - IpProtocol: tcp
          FromPort: 8080
          ToPort: 8080
          CidrIp: !Ref TargetVpcCidr
      Tags:
        - Key: Name
          Value: app-juice-shop-sg

  JuiceShopInstance:
    Type: AWS::EC2::Instance
    Properties:
      InstanceType: !Ref InstanceType
      ImageId: !Ref OldAmiId
      KeyName: !Ref KeyName
      SubnetId: !Ref PublicSubnetA
      SecurityGroupIds: [!Ref JuiceShopSG]
      MetadataOptions:
        HttpTokens: optional
        HttpEndpoint: enabled
      BlockDeviceMappings:
        - DeviceName: /dev/xvda
          Ebs:
            VolumeType: gp2
            Encrypted: false
      Tags:
        - Key: Name
          Value: app-juice-shop
        - Key: owner
          Value: team-x
        - Key: cost-center
          Value: cc-1
        - Key: data-class
          Value: internal
        - Key: findings
          Value: "SG_OPEN_SSH,SG_OPEN_APP,EBS_UNENCRYPTED,IMDSV1,OLD_AMI,NO_VPC_SEGMENTATION,PUBLIC_IP"
      UserData:
        Fn::Base64: |
          #!/bin/bash
          amazon-linux-extras install -y docker
          systemctl enable --now docker
          docker run -d --name app-juice-shop --restart always -p 8080:3000 bkimminich/juice-shop:v20.2.0

  # ================= app-gitea (real app, stateful -> Red, parked) =================

  GiteaSG:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: app-gitea SG - deliberately open
      VpcId: !Ref VPC
      SecurityGroupIngress:
        - IpProtocol: tcp
          FromPort: 22
          ToPort: 22
          CidrIp: 0.0.0.0/0
        - IpProtocol: tcp
          FromPort: 8080
          ToPort: 8080
          CidrIp: 0.0.0.0/0
      Tags:
        - Key: Name
          Value: app-gitea-sg

  GiteaInstance:
    Type: AWS::EC2::Instance
    Properties:
      InstanceType: !Ref InstanceType
      ImageId: !Ref OldAmiId
      KeyName: !Ref KeyName
      SubnetId: !Ref PublicSubnetA
      SecurityGroupIds: [!Ref GiteaSG]
      MetadataOptions:
        HttpTokens: optional
        HttpEndpoint: enabled
      BlockDeviceMappings:
        - DeviceName: /dev/xvda
          Ebs:
            VolumeType: gp2
            Encrypted: false
      Tags:
        - Key: Name
          Value: app-gitea
        - Key: owner
          Value: team-x
        - Key: cost-center
          Value: cc-1
        - Key: data-class
          Value: internal
        - Key: stateful
          Value: "true"
        - Key: findings
          Value: "SG_OPEN_SSH,SG_OPEN_APP,EBS_UNENCRYPTED,IMDSV1,OLD_AMI,NO_VPC_SEGMENTATION,PUBLIC_IP,STATEFUL"
      UserData:
        Fn::Base64: |
          #!/bin/bash
          amazon-linux-extras install -y docker
          systemctl enable --now docker
          mkdir -p /opt/gitea
          docker run -d --name app-gitea --restart always -p 8080:3000 \
            -e GITEA__security__INSTALL_LOCK=true \
            -e GITEA__database__DB_TYPE=sqlite3 \
            -v /opt/gitea:/data gitea/gitea:1.27.3
```

Notes:
- **Gitea has no `TargetVpcCidr` ingress on purpose.** It never migrates, so
  Account B's ALB never needs to reach it.
- The `findings` tag is the test oracle only. Discovery must never read it as
  an input.

### 1.3 Add 2 outputs under `Outputs:`

```yaml
  JuiceShopPrivateIp:
    Value: !GetAtt JuiceShopInstance.PrivateIp
  GiteaPrivateIp:
    Value: !GetAtt GiteaInstance.PrivateIp
```

### 1.4 Deploy with a change set (don't apply blind)

1. CloudFormation → **`mig-legacy-all`** → **Stack actions** → **Create change
   set for current stack**.
2. **Replace current template** → upload the edited file → **Next**.
3. **Parameters: leave every value exactly as it is.** In particular, **do not
   fill in `PeeringConnectionId`**. The return route to `10.20.0.0/16` was added
   by hand, so if you set that parameter now, CloudFormation tries to create
   the same route, fails with "already exists", and **rolls back the whole
   update**, new apps included. (Reconciling that drift is a separate item,
   T1-6 in `checklist.md`.)
4. **Next → Next → Create change set.** When it finishes, open it and check the
   **Changes** list. It must show **exactly 4 rows, all `Add`**: `JuiceShopSG`,
   `JuiceShopInstance`, `GiteaSG`, `GiteaInstance`. If any existing resource
   shows `Modify` or `Remove`, **don't execute**; send the list to Priyansh
   first.
5. **Execute change set** → wait for `UPDATE_COMPLETE`.

### 1.5 Verify (give Docker ~3–5 min after `UPDATE_COMPLETE` to pull the images)

From the stack's **Outputs** tab, then EC2 for the public IPs:

```bash
curl -s -o /dev/null -w "juice-shop %{http_code}\n" http://<juice-shop-public-ip>:8080/
curl -s http://<gitea-public-ip>:8080/api/healthz
```

- Juice Shop → `200`.
- Gitea → JSON with `"status": "pass"`. If Gitea instead shows its install page
  on `/`, it's still running (fine for the demo, since it's never migrated),
  but tell Priyansh.

If either fails: EC2 → the instance → **Actions → Monitor and troubleshoot →
Get system log**, and look at the end for the Docker pull / run output.

### 1.6 Hand-off and repo

1. Send Priyansh the **`JuiceShopPrivateIp`** from Outputs (Gitea's isn't needed).
2. Copy the same 4 resources + 2 outputs into the repo's
   `account-a-v2.yaml` **and** `account-a-all-in-one.yaml` (they're meant to be
   identical), plus `04-legacy-apps.yaml` for the split-stack variant. Commit on
   your own branch with `checklist.md` updated (AGENTS.md rule 3), then PR.
3. Update the app table in `docs/Cloud_ENVIRONMENTS.md` §4.

---

## 2. What changed in Account B (already done)

- `modules/edge_alb`: an app can have its own **listener port** instead of a
  path rule on `:80`. Juice Shop is a single-page app with absolute asset
  paths, so it breaks behind a `/juice-shop/` prefix the ALB doesn't strip.
  There's still exactly one listener *rule* per app, so Cutover shifts weights
  with `ModifyRule` the same way for every app.
- `modules/golden_app`: a fixed **`runtime`** choice (`demo-server` default,
  `juice-shop`), each mapped to a vetted install template. Blueprint picks the
  runtime from `app_routes`; its LLM never writes install steps, so "hardening
  is never an LLM input" still holds.
- `envs/target`: `app-juice-shop` registered on ALB **port 3000**, with
  `tg-app-juice-shop-legacy` / `-target` (health check `/`, weights 100/0).
  New `app_routes` output (T1-4) with each app's `path_prefix`, `priority`,
  `port`, `listener_port`, `health_path` and `runtime`.
- `app-gitea` gets nothing in Account B: it's Red, so it never migrates.

## 3. Account B — after Nancy's deploy (Priyansh)

```bash
TG=$(aws elbv2 describe-target-groups --profile mig-target --region ap-south-1 \
  --names tg-app-juice-shop-legacy --query "TargetGroups[0].TargetGroupArn" --output text)

aws elbv2 register-targets --profile mig-target --region ap-south-1 \
  --target-group-arn "$TG" --targets Id=<JuiceShopPrivateIp>,Port=8080,AvailabilityZone=all

aws elbv2 describe-target-health --profile mig-target --region ap-south-1 --target-group-arn "$TG"
# → healthy within ~15 s

curl -s -o /dev/null -w "%{http_code}\n" http://mig-edge-alb-1536629619.ap-south-1.elb.amazonaws.com:3000/
# → 200, served by the legacy Juice Shop over peering
```

## 4. Knock-on for the agent tracks

- **Track 2:** the Wave 0 rule ("exactly the 3 real apps") and the Discovery
  expected-findings tests need updating once these apps are live. Discovery
  should find `app-juice-shop` Golden, and `app-gitea` Red via `STATEFUL`.
- **Track 3:** Blueprint passes `runtime` from `app_routes[app]` into
  `golden_app`, and targets `listener_port` rather than `path_prefix` when it's
  set.
