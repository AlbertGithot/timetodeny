#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

SCRIPT_PATH="${ROOT_DIR}/$(basename "${BASH_SOURCE[0]}")"
BACKEND_DIR=""
FRONTEND_DIR=""
MANAGE_PY=""
REQUIREMENTS_FILE=""
RUNTIME_DIR="${ROOT_DIR}/.runtime"
NODE_RUNTIME_DIR="${RUNTIME_DIR}/node"
NODE_DIST_DIR="${RUNTIME_DIR}/node-dist"

BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-4028}"
LLAMA_CPP_HOST="${LLAMA_CPP_HOST:-127.0.0.1}"
LLAMA_CPP_PORT="${LLAMA_CPP_PORT:-8080}"
NODE_VERSION="${NODE_VERSION:-24.15.0}"

export TTD_MODEL_BACKEND="${TTD_MODEL_BACKEND:-llamacpp}"
export NEXT_PUBLIC_API_BASE="${NEXT_PUBLIC_API_BASE:-http://${BACKEND_HOST}:${BACKEND_PORT}/api}"
export TTD_FRONTEND_ORIGIN="${TTD_FRONTEND_ORIGIN:-http://127.0.0.1:${FRONTEND_PORT}}"
export TTD_LLAMA_CPP_URL="${TTD_LLAMA_CPP_URL:-http://${LLAMA_CPP_HOST}:${LLAMA_CPP_PORT}}"
export TTD_AUTO_UPDATE="${TTD_AUTO_UPDATE:-1}"

auto_update_repo() {
  local current_branch before_head after_head upstream_ref

  if [ "$TTD_AUTO_UPDATE" != "1" ]; then
    return 0
  fi

  if ! command -v git >/dev/null 2>&1; then
    echo "Skipping auto-update: git is not installed"
    return 0
  fi

  if [ ! -d "${ROOT_DIR}/.git" ]; then
    return 0
  fi

  if [ -n "$(git status --porcelain)" ]; then
    echo "Skipping auto-update: repository has local changes"
    return 0
  fi

  current_branch="$(git branch --show-current 2>/dev/null || true)"
  if [ -z "$current_branch" ]; then
    echo "Skipping auto-update: detached HEAD"
    return 0
  fi

  if ! git ls-remote --exit-code --heads origin "$current_branch" >/dev/null 2>&1; then
    echo "Skipping auto-update: origin/${current_branch} not found"
    return 0
  fi

  before_head="$(git rev-parse HEAD)"
  upstream_ref="origin/${current_branch}"

  if ! git fetch --quiet origin "$current_branch"; then
    echo "Skipping auto-update: failed to fetch origin/${current_branch}"
    return 0
  fi

  if ! git merge --ff-only --quiet "$upstream_ref" >/dev/null 2>&1; then
    echo "Skipping auto-update: fast-forward merge failed"
    return 0
  fi

  after_head="$(git rev-parse HEAD)"
  if [ "$before_head" != "$after_head" ]; then
    echo "Repository updated from ${upstream_ref}. Restarting launcher..."
    exec "$SCRIPT_PATH" "$@"
  fi
}

first_existing_path() {
  local candidate
  for candidate in "$@"; do
    if [ -n "$candidate" ] && [ -e "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

first_existing_dir() {
  local candidate
  for candidate in "$@"; do
    if [ -n "$candidate" ] && [ -d "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

first_executable_path() {
  local candidate
  for candidate in "$@"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

find_repo_file() {
  local name="$1"
  find "$ROOT_DIR" \
    \( -path "*/.git" -o -path "*/node_modules" -o -path "*/.venv" -o -path "*/.next" -o -path "*/.runtime" \) -prune \
    -o -type f -name "$name" -print -quit 2>/dev/null
}

find_file_under() {
  local base_dir="$1"
  local pattern="$2"
  local depth="${3:-5}"
  [ -d "$base_dir" ] || return 0
  find "$base_dir" -maxdepth "$depth" -type f -name "$pattern" -print -quit 2>/dev/null
}

find_executable_under() {
  local base_dir="$1"
  local name="$2"
  local depth="${3:-5}"
  [ -d "$base_dir" ] || return 0
  find "$base_dir" -maxdepth "$depth" -type f -name "$name" -perm -u+x -print -quit 2>/dev/null
}

resolve_repo_layout() {
  local frontend_package settings_file model_dir_override
  MANAGE_PY="$(
    first_existing_path \
      "${ROOT_DIR}/manage.py" \
      "${ROOT_DIR}/backend/manage.py" \
      "$(find_repo_file "manage.py")" \
      || true
  )"
  if [ -z "$MANAGE_PY" ]; then
    echo "manage.py not found under ${ROOT_DIR}"
    exit 1
  fi

  REQUIREMENTS_FILE="$(
    first_existing_path \
      "${ROOT_DIR}/requirements.txt" \
      "${ROOT_DIR}/backend/requirements.txt" \
      "$(find_repo_file "requirements.txt")" \
      || true
  )"
  if [ -z "$REQUIREMENTS_FILE" ]; then
    echo "requirements.txt not found under ${ROOT_DIR}"
    exit 1
  fi

  frontend_package="$(
    first_existing_path \
      "${ROOT_DIR}/frontend/package.json" \
      "${ROOT_DIR}/package.json" \
      "$(find_repo_file "package.json")" \
      || true
  )"
  if [ -z "$frontend_package" ]; then
    echo "frontend package.json not found under ${ROOT_DIR}"
    exit 1
  fi
  FRONTEND_DIR="$(cd "$(dirname "$frontend_package")" && pwd)"

  settings_file="$(
    first_existing_path \
      "${ROOT_DIR}/backend/timetodeny/settings.py" \
      "${ROOT_DIR}/timetodeny/settings.py" \
      "$(find_repo_file "settings.py")" \
      || true
  )"
  if [ -z "$settings_file" ]; then
    echo "Django settings.py not found under ${ROOT_DIR}"
    exit 1
  fi
  BACKEND_DIR="$(cd "$(dirname "$settings_file")/.." && pwd)"

  model_dir_override="${TTD_MODEL_DIR:-}"
  if [ -n "$model_dir_override" ]; then
    export TTD_MODEL_DIR="$model_dir_override"
  else
    export TTD_MODEL_DIR="$(
      first_existing_dir \
        "${ROOT_DIR}/backend/models" \
        "${ROOT_DIR}/models" \
        "${BACKEND_DIR}/models" \
        || true
    )"
    if [ -z "${TTD_MODEL_DIR:-}" ]; then
      export TTD_MODEL_DIR="${BACKEND_DIR}/models"
    fi
  fi
}

resolve_llama_cpp_bin() {
  local candidate=""

  if [ -n "${LLAMA_CPP_BIN:-}" ]; then
    if [ -x "$LLAMA_CPP_BIN" ]; then
      return 0
    fi
    if command -v "$LLAMA_CPP_BIN" >/dev/null 2>&1; then
      LLAMA_CPP_BIN="$(command -v "$LLAMA_CPP_BIN")"
      return 0
    fi
  fi

  candidate="$(command -v llama-server 2>/dev/null || true)"
  if [ -z "$candidate" ]; then
    candidate="$(
      first_executable_path \
        "${ROOT_DIR}/llama-server" \
        "${ROOT_DIR}/bin/llama-server" \
        "${ROOT_DIR}/build/bin/llama-server" \
        "${ROOT_DIR}/llama.cpp/llama-server" \
        "${ROOT_DIR}/llama.cpp/bin/llama-server" \
        "${ROOT_DIR}/llama.cpp/build/bin/llama-server" \
        "${ROOT_DIR}/backend/llama.cpp/build/bin/llama-server" \
        "${HOME}/.local/bin/llama-server" \
        "${HOME}/llama.cpp/llama-server" \
        "${HOME}/llama.cpp/bin/llama-server" \
        "${HOME}/llama.cpp/build/bin/llama-server" \
        "/usr/local/bin/llama-server" \
        "/usr/bin/llama-server" \
        "/opt/llama.cpp/bin/llama-server" \
        "/opt/llama.cpp/build/bin/llama-server" \
        || true
    )"
  fi
  if [ -z "$candidate" ]; then
    candidate="$(find_executable_under "$ROOT_DIR" "llama-server" 6 || true)"
  fi
  if [ -z "$candidate" ]; then
    candidate="$(find_executable_under "${HOME}/llama.cpp" "llama-server" 6 || true)"
  fi
  if [ -z "$candidate" ]; then
    candidate="$(find_executable_under "${HOME}/.local" "llama-server" 5 || true)"
  fi
  if [ -z "$candidate" ]; then
    candidate="$(find_executable_under "/usr/local" "llama-server" 5 || true)"
  fi
  if [ -z "$candidate" ]; then
    candidate="$(find_executable_under "/opt" "llama-server" 5 || true)"
  fi

  if [ -n "$candidate" ]; then
    LLAMA_CPP_BIN="$candidate"
    export LLAMA_CPP_BIN
    echo "Discovered llama-server: ${LLAMA_CPP_BIN}"
    return 0
  fi

  return 1
}

resolve_llama_model_path() {
  local candidate=""
  local bin_parent=""

  if [ -n "${LLAMA_CPP_MODEL_PATH:-}" ] && [ -f "$LLAMA_CPP_MODEL_PATH" ]; then
    return 0
  fi

  candidate="$(find_file_under "$TTD_MODEL_DIR" "*.gguf" 5 || true)"
  if [ -z "$candidate" ]; then
    candidate="$(find_file_under "${ROOT_DIR}/models" "*.gguf" 5 || true)"
  fi
  if [ -z "$candidate" ]; then
    candidate="$(find_file_under "${BACKEND_DIR}/models" "*.gguf" 5 || true)"
  fi
  if [ -z "$candidate" ]; then
    candidate="$(find_file_under "$(cd "${ROOT_DIR}/.." && pwd)" "*.gguf" 4 || true)"
  fi
  if [ -z "$candidate" ]; then
    candidate="$(find_file_under "${HOME}/models" "*.gguf" 5 || true)"
  fi
  if [ -z "$candidate" ]; then
    candidate="$(find_file_under "${HOME}/project" "*.gguf" 6 || true)"
  fi
  if [ -z "$candidate" ]; then
    candidate="$(find_file_under "${HOME}/llama.cpp/models" "*.gguf" 6 || true)"
  fi

  if [ -n "${LLAMA_CPP_BIN:-}" ]; then
    bin_parent="$(cd "$(dirname "$LLAMA_CPP_BIN")/.." && pwd 2>/dev/null || true)"
    if [ -z "$candidate" ] && [ -n "$bin_parent" ]; then
      candidate="$(find_file_under "${bin_parent}/models" "*.gguf" 5 || true)"
    fi
  fi

  if [ -n "$candidate" ]; then
    export LLAMA_CPP_MODEL_PATH="$candidate"
    echo "Discovered GGUF model: ${LLAMA_CPP_MODEL_PATH}"
    return 0
  fi

  return 1
}

add_local_node_to_path() {
  if [ -x "${NODE_RUNTIME_DIR}/current/bin/node" ]; then
    export PATH="${NODE_RUNTIME_DIR}/current/bin:${PATH}"
  fi
}

download_with_fallback() {
  local url="$1"
  local destination="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$destination"
    return 0
  fi

  if command -v wget >/dev/null 2>&1; then
    wget -qO "$destination" "$url"
    return 0
  fi

  echo "curl or wget is required to download Node.js"
  return 1
}

ensure_node_runtime() {
  add_local_node_to_path
  if command -v npm >/dev/null 2>&1; then
    return 0
  fi

  local uname_s uname_m node_arch archive_name download_url archive_path extract_dir
  uname_s="$(uname -s)"
  uname_m="$(uname -m)"

  if [ "$uname_s" != "Linux" ]; then
    echo "npm is required for the Next.js frontend"
    return 1
  fi

  case "$uname_m" in
    x86_64|amd64)
      node_arch="x64"
      ;;
    aarch64|arm64)
      node_arch="arm64"
      ;;
    *)
      echo "Unsupported CPU architecture for bundled Node.js: $uname_m"
      return 1
      ;;
  esac

  mkdir -p "$NODE_DIST_DIR" "$NODE_RUNTIME_DIR"
  archive_name="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"
  archive_path="${NODE_DIST_DIR}/${archive_name}"
  extract_dir="${NODE_RUNTIME_DIR}/node-v${NODE_VERSION}-linux-${node_arch}"
  download_url="https://nodejs.org/dist/v${NODE_VERSION}/${archive_name}"

  if [ ! -x "${extract_dir}/bin/node" ]; then
    if [ ! -f "$archive_path" ]; then
      echo "Downloading Node.js v${NODE_VERSION} (${node_arch})..."
      download_with_fallback "$download_url" "$archive_path"
    fi

    rm -rf "$extract_dir"
    mkdir -p "$NODE_RUNTIME_DIR"
    tar -xJf "$archive_path" -C "$NODE_RUNTIME_DIR"
  fi

  rm -f "${NODE_RUNTIME_DIR}/current"
  ln -s "$extract_dir" "${NODE_RUNTIME_DIR}/current"
  add_local_node_to_path

  if ! command -v npm >/dev/null 2>&1; then
    echo "Failed to bootstrap npm from local Node.js runtime"
    return 1
  fi
}

add_local_node_to_path
auto_update_repo "$@"
resolve_repo_layout

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required"
  exit 1
fi

if ! ensure_node_runtime; then
  exit 1
fi

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi

PYTHON=".venv/bin/python"
"$PYTHON" -m pip install --upgrade pip
"$PYTHON" -m pip install -r "$REQUIREMENTS_FILE"

mkdir -p "$TTD_MODEL_DIR"

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  (
    cd "$FRONTEND_DIR"
    npm install
  )
fi

"$PYTHON" "$MANAGE_PY" migrate --noinput
"$PYTHON" "$MANAGE_PY" shell -c "from core.seed import ensure_defaults; ensure_defaults()"

cleanup() {
  if [ -n "${BACKEND_PID:-}" ]; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
  fi
  if [ -n "${LLAMA_PID:-}" ]; then
    kill "$LLAMA_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

if [ "$TTD_MODEL_BACKEND" = "llamacpp" ]; then
  LLAMA_CPP_BIN="${LLAMA_CPP_BIN:-}"
  if ! resolve_llama_cpp_bin; then
    echo "llama-server not found. Searched PATH, repo directories, \$HOME/llama.cpp, \$HOME/.local/bin, /usr/local, and /opt."
    exit 1
  fi
  if ! resolve_llama_model_path; then
    echo "No GGUF model found."
    echo "Searched model directories around the repo, ${TTD_MODEL_DIR}, \$HOME/models, \$HOME/project, and llama.cpp model folders."
    echo "Put a .gguf file into: $TTD_MODEL_DIR"
    echo "Or set LLAMA_CPP_MODEL_PATH=/full/path/model.gguf"
    echo "For UI-only dev without llama.cpp: TTD_MODEL_BACKEND=mock ./linux.sh"
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

"$PYTHON" "$MANAGE_PY" runserver "${BACKEND_HOST}:${BACKEND_PORT}" &
BACKEND_PID=$!

echo "Backend:  http://${BACKEND_HOST}:${BACKEND_PORT}"
echo "Frontend: http://127.0.0.1:${FRONTEND_PORT}"
echo "Admin:    http://127.0.0.1:${FRONTEND_PORT}/admin-panel"

(
  cd "$FRONTEND_DIR"
  npm run dev
)
