# Deploy to Lighthouse — Design Spec

**Date:** 2026-05-01  
**Status:** Approved

## Overview

Provide a one-command deployment workflow that saves `hiring-assistant:v1.0.1` locally, transfers it to the remote server `lighthouse` (`work@119.28.54.112`) via scp, loads it, and starts the container using the existing startup script.

## Architecture

```
Local machine                           Remote: work@119.28.54.112
─────────────────────────────────────   ────────────────────────────────
docker tag <version> → latest
docker save (both tags) → .tar.gz
        │
        └── scp ──────────────────────→ /tmp/hiring-assistant-<version>.tar.gz
                                                  │
                                            docker load
                                                  │
                                        stop existing container (if any)
                                                  │
                                  /home/work/hiring-assistant-config/startup.sh
                                                  │
                                           container running on :3001
```

## Components

### 1. `scripts/sync-to-lighthouse.sh`

Shell script that handles the full sync-and-start lifecycle.

**Interface:**
```bash
./scripts/sync-to-lighthouse.sh [VERSION]
# VERSION defaults to "v1.0.1" if not provided
```

**Steps:**
1. Validate that `hiring-assistant:$VERSION` exists locally (`docker image inspect`)
2. Tag it as `hiring-assistant:latest`
3. Save both tags to `/tmp/hiring-assistant-$VERSION.tar.gz` via `docker save | gzip`
4. `scp` the archive to `work@119.28.54.112:/tmp/`
5. SSH into remote and execute:
   a. `docker load < /tmp/hiring-assistant-$VERSION.tar.gz`
   b. Stop and remove any running `hiring-assistant` container
   c. `bash /home/work/hiring-assistant-config/startup.sh`
6. Clean up: remove local `/tmp/hiring-assistant-$VERSION.tar.gz`
7. Clean up: remove remote `/tmp/hiring-assistant-$VERSION.tar.gz`

**Error handling:**
- Exit immediately on any error (`set -e`)
- Print clear step labels so failures are easy to locate

### 2. `.claude/skills/deploy-lighthouse.md`

A Claude Code skill that guides Claude through invoking the deployment workflow.

**Trigger:** User says something like "部署到 lighthouse", "deploy to lighthouse", or "sync image to lighthouse".

**Skill steps:**
1. Ask for the image version if not specified (default `v1.0.1`)
2. Verify `hiring-assistant:<version>` exists locally using `docker image inspect`
3. Run `bash scripts/sync-to-lighthouse.sh <version>`
4. SSH verify: `ssh work@119.28.54.112 "docker ps | grep hiring-assistant"` and report status
5. Report success with the running container info

## Constraints

- Remote startup script path: `/home/work/hiring-assistant-config/startup.sh` (read-only — do not modify)
- Remote startup script uses untagged `hiring-assistant` image name (resolved as `latest`)
- SSH connection: `work@119.28.54.112` (assumes key-based auth is already set up)
- Target platform: `linux/amd64` (matches Dockerfile second stage)

## Out of Scope

- Building the image (assumed already built and tagged before deploy)
- Managing SSH keys or setting up remote Docker
- Rollback mechanism
- CI/CD integration
