#!/bin/bash

# Define the services directory
SERVICES_DIR="/app/bodycam2/services"
SYSTEMD_DIR="/etc/systemd/system"

echo "Starting service installation process..."

# Check if services directory exists
if [ ! -d "$SERVICES_DIR" ]; then
  echo "Error: Services directory $SERVICES_DIR does not exist!"
  exit 1
fi

# Process each service file in the directory
for service_file in "$SERVICES_DIR"/*.service; do
  # Check if there are service files to process
  if [ ! -f "$service_file" ]; then
    echo "No service files found in $SERVICES_DIR."
    exit 1
  fi

  # Copy the service file to the systemd directory
  echo "Installing $service_file..."
  sudo cp "$service_file" "$SYSTEMD_DIR/"
  
  # Reload systemd to recognize the new service
  echo "Reloading systemd..."
  sudo systemctl daemon-reload

  # Extract the service file name
  service_name=$(basename "$service_file")
  
  # Enable and start the service
  echo "Enabling $service_name..."
  sudo systemctl enable "$service_name"
  
  echo "Starting $service_name..."
  sudo systemctl restart "$service_name"

  # Verify the service status
  if sudo systemctl is-active --quiet "$service_name"; then
    echo "$service_name is running."
  else
    echo "Error: Failed to start $service_name."
  fi
done

echo "Service installation process completed."
