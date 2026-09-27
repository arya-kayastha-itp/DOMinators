#!/bin/bash
# DOMinators control plane bootstrap (AL2023). Installs the runtime, then
# `dominators-deploy` pulls the latest release bundle from S3 and starts it.
# Re-deploys run the same command (the deploy script triggers it via SSM).
set -euo pipefail
exec > >(tee -a /var/log/dominators-bootstrap.log) 2>&1

dnf install -y python3.11 python3.11-pip nginx unzip

# Terraform, verified against HashiCorp's published SHA-256 list.
TFV="${terraform_version}"
cd /tmp
curl -fsSLO "https://releases.hashicorp.com/terraform/$TFV/terraform_$${TFV}_linux_amd64.zip"
curl -fsSLO "https://releases.hashicorp.com/terraform/$TFV/terraform_$${TFV}_SHA256SUMS"
grep "linux_amd64.zip" "terraform_$${TFV}_SHA256SUMS" | sha256sum -c -
unzip -o "terraform_$${TFV}_linux_amd64.zip" -d /usr/local/bin
terraform version

id dominators >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/dominators dominators
mkdir -p /opt/dominators/releases /opt/dominators/data/generated /opt/dominators/data/tf-plugin-cache
chmod 755 /opt/dominators
[ -d /opt/dominators/venv ] || python3.11 -m venv /opt/dominators/venv
chown -R dominators:dominators /opt/dominators

cat > /usr/local/bin/dominators-deploy <<'DEPLOY'
#!/bin/bash
# Pull releases/current.tar.gz, write .env from SSM, switch `current`, restart.
set -euo pipefail
BUCKET="${bucket}"
PREFIX="${ssm_prefix}"
REGION="${region}"
REL="/opt/dominators/releases/$(date +%Y%m%d%H%M%S)"

mkdir -p "$REL"
aws s3 cp "s3://$BUCKET/releases/current.tar.gz" /tmp/dominators-release.tar.gz --region "$REGION" --only-show-errors
tar -xzf /tmp/dominators-release.tar.gz -C "$REL"
rm -f /tmp/dominators-release.tar.gz

aws ssm get-parameter --with-decryption --name "$PREFIX/env" --region "$REGION" \
  --query Parameter.Value --output text > "$REL/.env"
chmod 600 "$REL/.env"

# State that must survive a redeploy: the SQLite store, generated terraform
# dirs (reset + destroy walks them) and the provider cache.
rm -rf "$REL/generated" && ln -s /opt/dominators/data/generated "$REL/generated"

/opt/dominators/venv/bin/pip install --quiet --disable-pip-version-check -r "$REL/requirements.txt"

chown -R dominators:dominators "$REL"
ln -sfn "$REL" /opt/dominators/current
systemctl restart dominators

# Keep the three newest releases.
ls -1dt /opt/dominators/releases/*/ | tail -n +4 | xargs -r rm -rf
echo "deployed $REL"
DEPLOY
chmod 755 /usr/local/bin/dominators-deploy

cat > /etc/systemd/system/dominators.service <<'UNIT'
[Unit]
Description=DOMinators orchestrator
After=network-online.target
Wants=network-online.target

[Service]
User=dominators
WorkingDirectory=/opt/dominators/current
Environment=PATH=/opt/dominators/venv/bin:/usr/local/bin:/usr/bin:/bin
# One worker on purpose: run locks and the watchdog live in this process.
ExecStart=/opt/dominators/venv/bin/uvicorn orchestrator.main:app --host 127.0.0.1 --port 8000 --proxy-headers
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/nginx/nginx.conf <<'NGINX'
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log notice;
pid /run/nginx.pid;
events { worker_connections 1024; }
http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;
  sendfile on;
  server_tokens off;
  gzip on;
  gzip_types text/css application/javascript application/json image/svg+xml;

  server {
    listen 80 default_server;
    root /opt/dominators/current/migration-accelerator-console/out;

    # Orchestrator. SSE (/api/events) needs buffering off and a long read timeout.
    location /api/ {
      proxy_pass http://127.0.0.1:8000/;
      proxy_http_version 1.1;
      proxy_set_header Connection "";
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_buffering off;
      proxy_cache off;
      proxy_read_timeout 3600s;
    }

    location / {
      try_files $uri $uri/ $uri.html /404.html;
    }
  }
}
NGINX

systemctl daemon-reload
systemctl enable --now nginx
systemctl enable dominators

# First deploy, if a release has already been uploaded.
/usr/local/bin/dominators-deploy || echo "no release yet — run scripts/deploy_control_plane.py"
