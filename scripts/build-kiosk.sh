#!/bin/bash
set -e

echo "=== Wishboard Raspberry Pi Container Deploy ==="

MODE="${1:-dev}"
DOMAIN_NAME="${2:-wishboard.painless-computing.com}"
DEPLOY_RULES="${3:-keep}"
APP_VERSION="${4:-latest}"
EVENT_PROFILE="${5:-lifestyle}"
REMOTE_TEMP_DIR="${6:-}"

# Configure the Docker command to securely execute as the wishboard service user using their isolated rootless daemon
WISHBOARD_UID=$(id -u wishboard)
WISHBOARD_GID=$(id -g wishboard)
RUN_CMD="sudo -u wishboard DOCKER_HOST=unix:///run/user/$WISHBOARD_UID/docker.sock docker"

echo "Deployment Mode: $MODE, Domain: $DOMAIN_NAME, Rules: $DEPLOY_RULES, Version: $APP_VERSION, Profile: $EVENT_PROFILE"
REQUIRED_MB=800
AVAILABLE_MB=$(df -m /home | awk 'NR==2 {print $4}')
if [[ "$AVAILABLE_MB" -lt "$REQUIRED_MB" ]]; then
    echo "ERROR: Not enough disk space. Available: ${AVAILABLE_MB} MB, Required: ${REQUIRED_MB} MB" >&2
    exit 1
fi
echo "Disk space OK (${AVAILABLE_MB} MB available)."

# Determine the home directory dynamically
WISHBOARD_HOME=$(getent passwd wishboard | cut -d: -f6 || echo "/home/wishboard")

# Ensure directory exists for env file and copy docker-compose.yml if provided
sudo mkdir -p $WISHBOARD_HOME/wishboard
if [[ -n "$REMOTE_TEMP_DIR" && -f "$REMOTE_TEMP_DIR/docker-compose.yml" ]]; then
    sudo cp "$REMOTE_TEMP_DIR/docker-compose.yml" "$WISHBOARD_HOME/wishboard/docker-compose.yml"
    sudo chown wishboard:wishboard "$WISHBOARD_HOME/wishboard/docker-compose.yml"
fi

echo "Configuring environment variables..."
if [[ "$MODE" = "prod" || "$MODE" = "dual" ]]; then
    # Runtime env (read by the server, served via /api/config). The old VITE_* names
    # were baked at image-build time in CI, so a value written here never reached the
    # already-built client bundle — the poster/Wi-Fi popup showed the wrong domain.
    sudo -u wishboard bash -c "echo 'WISHBOARD_DOMAIN=$DOMAIN_NAME' > $WISHBOARD_HOME/wishboard/.env"
    sudo -u wishboard bash -c "echo 'WISHBOARD_AP_IP=10.42.0.1:3000' >> $WISHBOARD_HOME/wishboard/.env"
else
    sudo rm -f $WISHBOARD_HOME/wishboard/.env
fi

if [[ "$MODE" = "dev" || "$MODE" = "dual" ]]; then
    sudo -u wishboard bash -c "echo 'NODE_ENV=development' >> $WISHBOARD_HOME/wishboard/.env"
fi

# Ensure application data directory permissions are cleanly owned by mapped container subuids.
# sqld drops privileges from root to UID 666; node runs as UID 1000.
#   node  (container UID 1000) -> host subuid_start + 999
#   sqld  (container UID 666)  -> host subuid_start + 665
echo "Configuring application data directory permissions..."
if [[ -d "$WISHBOARD_HOME/wishboard/data" ]]; then
    SUBUID_START=$(grep "^wishboard:" /etc/subuid 2>/dev/null | cut -d: -f2 || true)
    if [[ -z "$SUBUID_START" ]]; then
        SUBUID_START=$(grep "^pi:" /etc/subuid 2>/dev/null | cut -d: -f2 || true)
    fi
    if [[ -n "$SUBUID_START" ]]; then
        NODE_SUBUID=$((SUBUID_START + 1000 - 1))
        SQLD_SUBUID=$((SUBUID_START + 666 - 1))
        # chown ./data to node first (recursive), then override ./data/db for sqld
        sudo chown -R "$NODE_SUBUID:$NODE_SUBUID" "$WISHBOARD_HOME/wishboard/data" || true
        if [[ -d "$WISHBOARD_HOME/wishboard/data/db" ]]; then
            sudo chown -R "$SQLD_SUBUID:$SQLD_SUBUID" "$WISHBOARD_HOME/wishboard/data/db" || true
        fi
    fi
    sudo chmod -R 2775 "$WISHBOARD_HOME/wishboard/data" || true
fi

sudo -u wishboard bash -c "echo 'CORS_ALLOWED_ORIGINS=https://$DOMAIN_NAME,http://localhost:3000,http://localhost:5173' >> $WISHBOARD_HOME/wishboard/.env"
sudo -u wishboard bash -c "echo 'APP_VERSION=$APP_VERSION' >> $WISHBOARD_HOME/wishboard/.env"
sudo -u wishboard bash -c "echo 'EVENT_PROFILE=$EVENT_PROFILE' >> $WISHBOARD_HOME/wishboard/.env"

# One-time migration from the legacy db_data named volume to the new ./data/db host bind mount
if $RUN_CMD volume inspect db_data &>/dev/null && { [[ ! -d "$WISHBOARD_HOME/wishboard/data/db" ]] || [[ -z "$(ls -A $WISHBOARD_HOME/wishboard/data/db 2>/dev/null)" ]]; }; then
    echo "One-time migration: copying existing database from db_data named volume to ./data/db..."
    sudo -u wishboard mkdir -p $WISHBOARD_HOME/wishboard/data/db
    # Temporary alpine container to copy files (runs under rootless docker, so files will be owned by wishboard user)
    $RUN_CMD run --rm -v db_data:/from -v $WISHBOARD_HOME/wishboard/data/db:/to alpine sh -c 'cp -a /from/. /to/ 2>/dev/null || true'
    sudo -u wishboard chmod -R 700 $WISHBOARD_HOME/wishboard/data/db
    echo "Removing migrated db_data named volume..."
    $RUN_CMD volume rm db_data || true
fi

# Navigate to the application directory where docker-compose.yml is uploaded
cd $WISHBOARD_HOME/wishboard

echo "Starting/Updating services via Docker Compose..."
# We assume the user has copied docker-compose.yml to the target directory.
# If they are running this script in the repository root, it will find docker-compose.yml.
export APP_VERSION=$APP_VERSION
# Pull policy by mode:
#   prod  -> missing : events run offline; a cached image must be authoritative.
#            --pull always would REQUIRE network and fail a disconnected deploy.
#   dev/dual -> always : testing wants the freshest image for a moving tag
#            (e.g. pr-NNN / latest), which 'missing' would serve stale from cache.
PULL_POLICY="missing"
if [[ "$MODE" = "dev" || "$MODE" = "dual" ]]; then
  PULL_POLICY="always"
fi
echo "Docker image pull policy: $PULL_POLICY (mode: $MODE)"
$RUN_CMD compose --env-file .env up -d --pull "$PULL_POLICY"

# Note: libsql-server data ownership alignment is handled via /etc/subuid offset mapping
# (NODE_SUBUID = SUBUID_START + 999, SQLD_SUBUID = SUBUID_START + 665) configured above prior to container launch.

if [[ "$DEPLOY_RULES" = "reset" ]]; then
    # #194: reset matching rules ONLY — do not touch users, wishes, or images.
    # Rules live in the DB `rules` table (see ADR 0002/0004). Clear that table,
    # then restart the app so rulesManager.seedIfEmpty() reseeds the bundled
    # defaults on boot. Remove only the vestigial legacy rules.yaml (NOT images)
    # so the reseed uses the bundled defaults rather than a stale file.
    echo "Resetting matching rules to the bundled defaults (DB rules table)..."
    sudo rm -f $WISHBOARD_HOME/wishboard/data/rules.yaml || true
    # Wait for the app to be up, then clear the rules table via the app's own
    # libSQL client (DATABASE_URL points at the db service on the compose network).
    for _ in $(seq 1 20); do
        if $RUN_CMD exec wishboard node -e "import('@libsql/client').then(async ({ createClient }) => { const c = createClient({ url: process.env.DATABASE_URL }); await c.execute('DELETE FROM rules'); process.exit(0); }).catch(() => process.exit(1))"; then
            echo "Rules table cleared."
            break
        fi
        sleep 1
    done
    $RUN_CMD compose --env-file .env restart wishboard
fi

echo "Restarting Display Manager..."
sudo systemctl restart lightdm || true

echo "Deployment complete! Wishboard container and Display Manager have been restarted."
exit 0
