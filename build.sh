#!/usr/bin/env bash
# Produces web/dist, which server/index.js serves alongside /api on one origin.
set -o errexit

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm is required to build the frontend." >&2
  exit 1
fi

npm ci
npm run build

echo "Built web/dist. Start with: NODE_ENV=production SESSION_SECRET=... npm start"
