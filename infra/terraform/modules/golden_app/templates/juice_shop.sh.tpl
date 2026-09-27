#!/bin/bash
set -euo pipefail

dnf install -y docker
systemctl enable --now docker

# Juice Shop answers with plain HTML, so nothing in a response says which
# side of the migration served it. A small nginx in front adds
# `X-Served-By: target` to every response (errors included): the cutover's
# traffic generator reads it, and the traffic-share gate can tell the golden
# target from legacy (which never sends the header).
#
# Host port ${port} -> nginx :80 -> Juice Shop :3000 on a private Docker
# network, so the golden SG, target group and health checks stay on the same
# port as every other golden app.
docker network create golden >/dev/null 2>&1 || true
docker run -d --name ${app_id} --restart always --network golden ${image}

mkdir -p /etc/golden
cat > /etc/golden/served-by.conf <<'NGINX'
server {
  listen 80;
  location / {
    proxy_pass http://${app_id}:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    add_header X-Served-By target always;
  }
}
NGINX

docker run -d --name served-by --restart always --network golden -p ${port}:80 \
  -v /etc/golden/served-by.conf:/etc/nginx/conf.d/default.conf:ro ${proxy_image}
