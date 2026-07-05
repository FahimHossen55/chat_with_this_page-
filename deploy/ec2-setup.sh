#!/usr/bin/env bash
# One-time bootstrap for a fresh Ubuntu EC2 instance.
# Run once, manually, over SSH as the instance's default user (e.g. ubuntu):
#   scp deploy/ec2-setup.sh <user>@<host>:~ && ssh <user>@<host> 'bash ec2-setup.sh'
set -euo pipefail

APP_DIR="/opt/chatwithpage"

echo "==> Installing Docker Engine + Compose plugin"
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo "==> Enabling Docker and adding $USER to the docker group"
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"

echo "==> Creating app directory at ${APP_DIR}"
sudo mkdir -p "${APP_DIR}"
sudo chown "$USER":"$USER" "${APP_DIR}"

if [ ! -f "${APP_DIR}/.env" ]; then
  echo "==> Writing ${APP_DIR}/.env template (fill in the real key!)"
  cat > "${APP_DIR}/.env" <<'EOF'
GROQ_API_KEY=your_groq_api_key_here
EOF
  chmod 600 "${APP_DIR}/.env"
fi

cat <<EOF

==> Bootstrap complete.

Next steps:
  1. Edit ${APP_DIR}/.env and set the real GROQ_API_KEY.
  2. Log out and back in (or run 'newgrp docker') so the docker group membership takes effect.
  3. In the GitHub repo, set these Actions secrets:
       DOCKERHUB_USERNAME, DOCKERHUB_TOKEN
       EC2_HOST, EC2_USER, EC2_SSH_KEY
  4. In the EC2 security group, open inbound ports:
       22   (SSH)
       8000 (backend API)
       3001 (Uptime Kuma, optional — restrict to your IP)
  5. Push to main (or push a v*.*.* tag) to trigger the deploy workflow.
EOF
