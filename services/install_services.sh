#!/bin/bash

set -euo pipefail

SERVICES_DIR="$(dirname "$0")"  # Use the directory where the script is located
SYSTEMD_DIR="/etc/systemd/system"

echo "Starting service installation process..."

# Check if services directory exists
if [ ! -d "$SERVICES_DIR" ]; then
  echo "Error: Services directory $SERVICES_DIR does not exist!"
  exit 1
fi

# Find .service files in the directory (not subdirectories)
shopt -s nullglob
service_files=("$SERVICES_DIR"/*.service)
shopt -u nullglob

if [ ${#service_files[@]} -eq 0 ]; then
  echo "No service files found in $SERVICES_DIR."
  exit 1
fi

# Copy all .service files first
for service_file in "${service_files[@]}"; do
  service_name=$(basename "$service_file")
  echo "Installing $service_name..."
  sudo cp "$service_file" "$SYSTEMD_DIR/$service_name"
done

echo "Reloading systemd..."
sudo systemctl daemon-reload

# Enable and restart all services
for service_file in "${service_files[@]}"; do
  service_name=$(basename "$service_file")
  echo "Enabling $service_name..."
  sudo systemctl enable "$service_name"

  echo "Restarting $service_name..."
  sudo systemctl restart "$service_name"

  if sudo systemctl is-active --quiet "$service_name"; then
    echo "$service_name is running."
  else
    echo "Error: Failed to start $service_name."
  fi
done

echo "Service installation process completed."
