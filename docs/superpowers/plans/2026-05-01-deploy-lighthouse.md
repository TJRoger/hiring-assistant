# Deploy to Lighthouse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a one-command shell script and a Claude Code skill that saves `hiring-assistant:<version>` locally, transfers it to `work@119.28.54.112` via scp, and starts the container using the remote startup script.

**Architecture:** The shell script performs all side-effectful steps (tag, save, scp, ssh remote ops, cleanup) in sequence with `set -e` so any failure aborts early. The Claude Code skill is a markdown guide that instructs Claude to verify the local image, invoke the script, and confirm the container is running.

**Tech Stack:** Bash, Docker CLI, scp, ssh, Claude Code skills (Markdown)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `scripts/sync-to-lighthouse.sh` | Full sync-and-start lifecycle |
| Create | `.claude/skills/deploy-lighthouse.md` | Claude Code skill for guided deployment |

---

### Task 1: Create `scripts/sync-to-lighthouse.sh`

**Files:**
- Create: `scripts/sync-to-lighthouse.sh`

- [ ] **Step 1: Create the scripts directory and write the script**

```bash
mkdir -p scripts
```

Create `scripts/sync-to-lighthouse.sh` with the following content:

```bash
#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-v1.0.1}"
IMAGE="hiring-assistant"
REMOTE_USER="work"
REMOTE_HOST="119.28.54.112"
REMOTE="$REMOTE_USER@$REMOTE_HOST"
ARCHIVE="/tmp/${IMAGE}-${VERSION}.tar.gz"
REMOTE_ARCHIVE="/tmp/${IMAGE}-${VERSION}.tar.gz"

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
EXISTING=\$(docker ps -q --filter "ancestor=${IMAGE}" --filter "ancestor=${IMAGE}:latest" 2>/dev/null || true)
if [ -n "\$EXISTING" ]; then
  docker stop \$EXISTING
  docker rm \$EXISTING
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
```

- [ ] **Step 2: Make the script executable**

```bash
chmod +x scripts/sync-to-lighthouse.sh
```

- [ ] **Step 3: Verify shell syntax**

```bash
bash -n scripts/sync-to-lighthouse.sh
```

Expected output: no output (exit 0 = syntax OK)

- [ ] **Step 4: Commit**

```bash
git add scripts/sync-to-lighthouse.sh
git commit -m "feat: add sync-to-lighthouse deployment script"
```

---

### Task 2: Create `.claude/skills/deploy-lighthouse.md`

**Files:**
- Create: `.claude/skills/deploy-lighthouse.md`

- [ ] **Step 1: Create the skills directory and write the skill file**

```bash
mkdir -p .claude/skills
```

Create `.claude/skills/deploy-lighthouse.md` with the following content:

```markdown
# Deploy to Lighthouse

Use this skill when the user says "部署到 lighthouse", "deploy to lighthouse", "sync image to lighthouse", or similar deployment requests targeting the remote server.

## Steps

### 1. Resolve version

If the user did not specify a version, ask:
> "Which version should I deploy? (default: v1.0.1)"

Use `v1.0.1` if the user accepts the default or provides no answer.

### 2. Verify the local image exists

Run:
```bash
docker image inspect hiring-assistant:<VERSION>
```

If this fails, stop and tell the user:
> "Local image `hiring-assistant:<VERSION>` not found. Build it first with: `docker build -t hiring-assistant:<VERSION> .`"

### 3. Run the deployment script

Run:
```bash
bash scripts/sync-to-lighthouse.sh <VERSION>
```

Stream the output to the user. If the script exits with a non-zero code, report the step label where it failed (the `==> [N/7]` prefix in the output).

### 4. Verify the container is running on remote

Run:
```bash
ssh work@119.28.54.112 "docker ps --filter ancestor=hiring-assistant --format 'table {{.ID}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'"
```

### 5. Report result

If a container row is returned, report:
> "Deployment successful. `hiring-assistant` is running on `119.28.54.112:3001`."

If no container row is returned, report:
> "Script completed but no running container was found. Check the remote startup script at `/home/work/hiring-assistant-config/startup.sh`."
```

- [ ] **Step 2: Verify the skill file is well-formed Markdown**

```bash
cat .claude/skills/deploy-lighthouse.md
```

Scan the output: confirm all code fences are closed, no stray characters.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/deploy-lighthouse.md
git commit -m "feat: add deploy-lighthouse Claude Code skill"
```

---

## Self-Review Checklist

- [x] Spec §Components §1 covered → Task 1 (script with all 7 steps, `set -e`, step labels)
- [x] Spec §Components §2 covered → Task 2 (skill with version prompt, image verify, script run, verify, report)
- [x] Constraint: remote startup script not modified
- [x] Constraint: `latest` tag applied before save so remote startup script works unchanged
- [x] Constraint: `linux/amd64` — handled by existing Dockerfile, no action needed here
- [x] No TBD or placeholder steps
- [x] Type/name consistency: `IMAGE`, `VERSION`, `REMOTE` variables consistent across Task 1
