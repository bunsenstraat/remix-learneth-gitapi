#!/bin/bash
# Remix GitAPI Server startup script

# Source NVM
export NVM_DIR="/root/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Change to app directory
cd /usr/src/remix-learneth-gitapi

# Start the application
exec node ./bin/www
