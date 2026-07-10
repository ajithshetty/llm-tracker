#!/usr/bin/env bash
set -euo pipefail
export APP_CONFIG_PATH="${APP_CONFIG_PATH:-$(dirname "$0")/config.yaml}"
uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --reload
