#!/bin/bash
set -euo pipefail

dnf install -y docker
systemctl enable --now docker

# Host port ${port} -> container 3000, so the golden SG, target group and
# health checks stay on the same port as every other golden app.
docker run -d --name ${app_id} --restart always -p ${port}:3000 ${image}
