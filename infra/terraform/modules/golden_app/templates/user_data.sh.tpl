#!/bin/bash
set -euo pipefail

mkdir -p /opt/app
cat > /opt/app/server.py <<'PYEOF'
${server_py}
PYEOF

cat > /etc/systemd/system/mig-app.service <<EOF
[Unit]
Description=Migration accelerator demo app
After=network.target

[Service]
ExecStart=/usr/bin/python3 /opt/app/server.py
Restart=always
Environment=APP_ID=${app_id}
Environment=SERVED_BY=${served_by}
Environment=PORT=${port}
Environment=PATH_PREFIX=${path_prefix}
%{ for key, value in env_vars ~}
Environment=${key}=${value}
%{ endfor ~}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now mig-app.service
