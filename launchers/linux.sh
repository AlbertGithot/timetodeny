#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-4028}"
LLAMA_CPP_HOST="${LLAMA_CPP_HOST:-127.0.0.1}"
LLAMA_CPP_PORT="${LLAMA_CPP_PORT:-8080}"

export TTD_MODEL_BACKEND="${TTD_MODEL_BACKEND:-llamacpp}"
export TTD_MODEL_DIR="${TTD_MODEL_DIR:-${ROOT_DIR}/backend/models}"
export NEXT_PUBLIC_API_BASE="${NEXT_PUBLIC_API_BASE:-http://${BACKEND_HOST}:${BACKEND_PORT}/api}"
export TTD_FRONTEND_ORIGIN="${TTD_FRONTEND_ORIGIN:-http://127.0.0.1:${FRONTEND_PORT}}"
export TTD_LLAMA_CPP_URL="${TTD_LLAMA_CPP_URL:-http://${LLAMA_CPP_HOST}:${LLAMA_CPP_PORT}}"

if [ -x "${ROOT_DIR}/.runtime/node/current/bin/node" ]; then
  export PATH="${ROOT_DIR}/.runtime/node/current/bin:${PATH}"
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required for the Next.js frontend"
  exit 1
fi

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi

PYTHON=".venv/bin/python"
"$PYTHON" -m pip install --upgrade pip
"$PYTHON" -m pip install -r backend/requirements.txt

mkdir -p "$TTD_MODEL_DIR"

if [ ! -d "node_modules" ]; then
  npm install
fi

"$PYTHON" manage.py migrate --noinput
"$PYTHON" manage.py shell -c "from core.seed import ensure_defaults; ensure_defaults()"

cleanup() {
  if [ -n "${BACKEND_PID:-}" ]; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
  fi
  if [ -n "${LLAMA_PID:-}" ]; then
    kill "$LLAMA_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

if [ "$TTD_MODEL_BACKEND" = "llamacpp" ] && [ -z "${LLAMA_CPP_MODEL_PATH:-}" ]; then
  FOUND_MODEL="$(find "$TTD_MODEL_DIR" -type f -name "*.gguf" -print -quit 2>/dev/null || true)"
  if [ -n "$FOUND_MODEL" ]; then
    export LLAMA_CPP_MODEL_PATH="$FOUND_MODEL"
  fi
fi

if [ "$TTD_MODEL_BACKEND" = "llamacpp" ]; then
  LLAMA_CPP_BIN="${LLAMA_CPP_BIN:-llama-server}"
  if ! command -v "$LLAMA_CPP_BIN" >/dev/null 2>&1; then
    echo "$LLAMA_CPP_BIN is required. Install/build llama.cpp and make llama-server available in PATH."
    exit 1
  fi
  if [ -z "${LLAMA_CPP_MODEL_PATH:-}" ]; then
    echo "No GGUF model found."
    echo "Put a .gguf file into: $TTD_MODEL_DIR"
    echo "Or set LLAMA_CPP_MODEL_PATH=/full/path/model.gguf"
    echo "For UI-only dev without llama.cpp: TTD_MODEL_BACKEND=mock ./launchers/linux.sh"
    exit 1
  fi
  if [ ! -f "$LLAMA_CPP_MODEL_PATH" ]; then
    echo "LLAMA_CPP_MODEL_PATH does not exist: $LLAMA_CPP_MODEL_PATH"
    exit 1
  fi

  LLAMA_ARGS=(
    "-m" "$LLAMA_CPP_MODEL_PATH"
    "--host" "$LLAMA_CPP_HOST"
    "--port" "$LLAMA_CPP_PORT"
    "-c" "${LLAMA_CPP_CTX_SIZE:-8192}"
  )
  if [ -n "${LLAMA_CPP_THREADS:-}" ]; then
    LLAMA_ARGS+=("-t" "$LLAMA_CPP_THREADS")
  fi
  if [ -n "${LLAMA_CPP_GPU_LAYERS:-}" ]; then
    LLAMA_ARGS+=("-ngl" "$LLAMA_CPP_GPU_LAYERS")
  fi

  "$LLAMA_CPP_BIN" "${LLAMA_ARGS[@]}" &
  LLAMA_PID=$!
  echo "llama.cpp: ${TTD_LLAMA_CPP_URL}"
fi

"$PYTHON" manage.py runserver "${BACKEND_HOST}:${BACKEND_PORT}" &
BACKEND_PID=$!

echo "Backend:  http://${BACKEND_HOST}:${BACKEND_PORT}"
echo "Frontend: http://127.0.0.1:${FRONTEND_PORT}"
echo "Admin:    http://127.0.0.1:${FRONTEND_PORT}/admin-panel"

npm run dev
