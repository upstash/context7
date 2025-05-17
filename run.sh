#!/bin/bash

# Clean up existing containers
docker-compose down --volumes --remove-orphans

# Build and start new containers
docker-compose build --no-cache
docker-compose up