#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-v1.0.1}"
IMAGE="hiring-assistant"
REMOTE_USER="work"
REMOTE_HOST="119.28.54.112"
REMOTE="$REMOTE_USER@$REMOTE_HOST"
ARCHIVE="/tmp/${IMAGE}-${VERSION}.tar.gz"
REMOTE_ARCHIVE="/tmp/${IMAGE}-${VERSION}.tar.gz"

trap 'rm -f "${ARCHIVE}"' EXIT

echo "==> [1/7] Verifying local image ${IMAGE}:${VERSION} ..."
docker image inspect "${IMAGE}:${VERSION}" > /dev/null

echo "==> [2/7] Tagging ${IMAGE}:${VERSION} as ${IMAGE}:latest ..."
docker tag "${IMAGE}:${VERSION}" "${IMAGE}:latest"

echo "==> [3/7] Saving image to ${ARCHIVE} ..."
docker save "${IMAGE}:${VERSION}" "${IMAGE}:latest" | gzip > "${ARCHIVE}"

echo "==> [4/7] Transferring to ${REMOTE}:${REMOTE_ARCHIVE} ..."
scp "${ARCHIVE}" "${REMOTE}:${REMOTE_ARCHIVE}"

echo "==> [5/7] Loading image and restarting container on remote ..."
ssh "${REMOTE}" bash <<EOF
set -euo pipefail

echo "  -> Loading image ..."
docker load < "${REMOTE_ARCHIVE}"

echo "  -> Stopping existing container (if any) ..."
EXISTING=\$(docker ps -q --filter "ancestor=${IMAGE}:latest" 2>/dev/null || true)
if [ -n "\$EXISTING" ]; then
  echo "\$EXISTING" | xargs docker stop
  echo "\$EXISTING" | xargs docker rm
fi

echo "  -> Starting container via startup script ..."
bash /home/work/hiring-assistant-config/startup.sh
EOF

echo "==> [6/7] Cleaning up local archive ..."
rm -f "${ARCHIVE}"

echo "==> [7/7] Cleaning up remote archive ..."
ssh "${REMOTE}" "rm -f ${REMOTE_ARCHIVE}"

echo ""
echo "Deployment complete. Container should be running on ${REMOTE_HOST}:3001"
