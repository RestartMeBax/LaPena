#!/bin/bash
# update.sh - Script to update Docker container on Hetzner server
# Called by deploy.sh after uploading Docker image to Docker Hub

# Check if environment file is provided
if [ $# -ne 1 ]; then
    echo "Error: Environment file path is required"
    echo "Usage: $0 <env_file_path>"
    exit 1
fi

ENV_FILE="$1"

# Check if environment file exists
if [ ! -f "$ENV_FILE" ]; then
    echo "Error: Environment file '$ENV_FILE' not found"
    exit 1
fi

# Load environment variables from the provided file
echo "Loading environment variables from $ENV_FILE..."
export $(grep -v '^#' "$ENV_FILE" | xargs)

echo "======================================================"
echo "🔄 UPDATING SERVER: ${HOST} ENVIRONMENT"
echo "======================================================"

# Container and image configuration
CONTAINER_NAME="openfront-${ENV}-${SUBDOMAIN}"
PERSIST_ROOT="${OPENFRONT_PERSIST_ROOT:-/home/openfront/persistent}"
HOST_DATA_DIR="${PERSIST_ROOT}/${CONTAINER_NAME}/data"

echo "Pulling ${GHCR_IMAGE} from GitHub Container Registry..."
docker pull "${GHCR_IMAGE}"

echo "Preparing persistent data directory: ${HOST_DATA_DIR}"
mkdir -p "$HOST_DATA_DIR"
chmod 0777 "$HOST_DATA_DIR"

echo "Checking for existing container..."
EXISTING_CONTAINER="$(docker ps -a --filter "name=^${CONTAINER_NAME}$" -q | head -n 1)"
if [ -n "$EXISTING_CONTAINER" ] && [ -z "$(ls -A "$HOST_DATA_DIR" 2>/dev/null)" ]; then
    echo "Migrating existing in-container data to host persistent directory..."
    if docker cp "${EXISTING_CONTAINER}:/usr/src/app/data/." "$HOST_DATA_DIR/"; then
        echo "Data migration completed."
    else
        echo "No in-container data found to migrate (continuing)."
    fi
fi

RUNNING_CONTAINER="$(docker ps --filter "name=^${CONTAINER_NAME}$" -q)"
if [ -n "$RUNNING_CONTAINER" ]; then
    echo "Stopping running container $RUNNING_CONTAINER..."
    docker stop "$RUNNING_CONTAINER"
fi

if [ -n "$EXISTING_CONTAINER" ]; then
    echo "Removing existing container $EXISTING_CONTAINER..."
    docker rm "$EXISTING_CONTAINER"
fi

if [ "${SUBDOMAIN}" = main ] || [ "${DOMAIN}" = openfront.io ]; then
    RESTART=always
else
    RESTART=no
fi

echo "Starting new container for ${HOST} environment..."

# Ensure the traefik network exists
docker network create web 2> /dev/null || true

docker run -d \
    --restart="${RESTART}" \
    --env-file "$ENV_FILE" \
    --name "${CONTAINER_NAME}" \
    -v "${HOST_DATA_DIR}:/usr/src/app/data" \
    --network web \
    --label "traefik.enable=true" \
    --label "traefik.http.routers.${CONTAINER_NAME}.rule=Host(\`${SUBDOMAIN}.${DOMAIN}\`)" \
    --label "traefik.http.routers.${CONTAINER_NAME}.entrypoints=websecure" \
    --label "traefik.http.routers.${CONTAINER_NAME}.tls=true" \
    --label "traefik.http.services.${CONTAINER_NAME}.loadbalancer.server.port=80" \
    "${GHCR_IMAGE}"

if [ $? -eq 0 ]; then
    echo "Update complete! New ${CONTAINER_NAME} container is running."

    # Final cleanup after successful deployment
    echo "Performing final cleanup of unused Docker resources..."
    echo "Removing unused images (not referenced)..."
    docker image prune -a -f
    docker container prune -f
    echo "Cleanup complete."

    # Remove the environment file
    echo "Removing environment file ${ENV_FILE}..."
    rm -f "$ENV_FILE"
    echo "Environment file removed."
else
    echo "Failed to start container"
    exit 1
fi

echo "======================================================"
echo "✅ SERVER UPDATE COMPLETED SUCCESSFULLY"
echo "Container name: ${CONTAINER_NAME}"
echo "Image: ${FULL_IMAGE_NAME}"
echo "======================================================"
