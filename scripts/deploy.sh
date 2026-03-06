#!/usr/bin/env bash
# deploy.sh — Full VPS deployment script for whatsapp-bot
# Usage: bash scripts/deploy.sh [--skip-build] [--skip-migrate]
set -euo pipefail

# ── Colours ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; RESET='\033[0m'
info()  { echo -e "${GREEN}[deploy]${RESET} $*"; }
warn()  { echo -e "${YELLOW}[deploy]${RESET} $*"; }
error() { echo -e "${RED}[deploy]${RESET} $*" >&2; exit 1; }

# ── Parse flags ────────────────────────────────────────────────────────────────
SKIP_BUILD=false
SKIP_MIGRATE=false
for arg in "$@"; do
  case $arg in
    --skip-build)   SKIP_BUILD=true ;;
    --skip-migrate) SKIP_MIGRATE=true ;;
  esac
done

# ── Ensure npm is available ────────────────────────────────────────────────────
command -v npm >/dev/null 2>&1 || error "npm is not installed. Please install Node.js/npm"

# ── Working directory = repo root ─────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
info "Deploying from: $REPO_ROOT"

# ── 1. Install dependencies ───────────────────────────────────────────────────
info "Installing dependencies…"
npm install

# ── 2. Build web (frontend) ───────────────────────────────────────────────────
if [ "$SKIP_BUILD" = false ]; then
  info "Building frontend…"
  (cd packages/web && npm run build)

  info "Building server…"
  (cd packages/server && npm run build)
else
  warn "Skipping build (--skip-build)"
fi

# ── 3. Run database migrations ────────────────────────────────────────────────
if [ "$SKIP_MIGRATE" = false ]; then
  info "Running database migrations…"
  (cd packages/server && npm run db:migrate)
else
  warn "Skipping migrations (--skip-migrate)"
fi

# ── 4. Done ───────────────────────────────────────────────────────────────────
info "✅ Deployment complete!"
info "Start the server with: npm run start"
info "  or with PM2:          pm2 start 'npm run start' --name whatsapp-bot"
