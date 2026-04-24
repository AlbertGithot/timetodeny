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
LLAMA_CPP_RUNTIME_DIR="${RUNTIME_DIR}/llama.cpp"
STATE_DIR="${RUNTIME_DIR}/state"
PID_DIR="${STATE_DIR}/pids"
LOG_DIR="${RUNTIME_DIR}/logs"

ACTION="${1:-start}"
case "$ACTION" in
  start|stop|restart|status|logs|foreground)
    shift || true
    ;;
  *)
    ACTION="start"
    ;;
esac

BACKEND_PID_FILE="${PID_DIR}/backend.pid"
FRONTEND_PID_FILE="${PID_DIR}/frontend.pid"
LLAMA_PID_FILE="${PID_DIR}/llama.pid"
BACKEND_LOG_FILE="${LOG_DIR}/backend.log"
FRONTEND_LOG_FILE="${LOG_DIR}/frontend.log"
LLAMA_LOG_FILE="${LOG_DIR}/llama.log"

SERVER_BIND_HOST="${SERVER_BIND_HOST:-0.0.0.0}"
BACKEND_HOST="${BACKEND_HOST:-$SERVER_BIND_HOST}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-4028}"
LLAMA_CPP_HOST="${LLAMA_CPP_HOST:-127.0.0.1}"
LLAMA_CPP_PORT="${LLAMA_CPP_PORT:-8080}"
NODE_VERSION="${NODE_VERSION:-24.15.0}"
PUBLIC_SCHEME="${PUBLIC_SCHEME:-http}"
PUBLIC_HOST="${PUBLIC_HOST:-}"
BACKEND_PUBLIC_HOST="${BACKEND_PUBLIC_HOST:-}"

export TTD_MODEL_BACKEND="${TTD_MODEL_BACKEND:-llamacpp}"
export TTD_LLAMA_CPP_URL="${TTD_LLAMA_CPP_URL:-http://${LLAMA_CPP_HOST}:${LLAMA_CPP_PORT}}"
export TTD_AUTO_UPDATE="${TTD_AUTO_UPDATE:-1}"
export TTD_AUTO_BOOTSTRAP_LLAMA_CPP="${TTD_AUTO_BOOTSTRAP_LLAMA_CPP:-1}"
export LLAMA_CPP_REPO_URL="${LLAMA_CPP_REPO_URL:-https://github.com/ggml-org/llama.cpp.git}"
export LLAMA_CPP_REPO_REF="${LLAMA_CPP_REPO_REF:-master}"

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

cpu_jobs() {
  if command -v nproc >/dev/null 2>&1; then
    nproc
    return 0
  fi
  if command -v getconf >/dev/null 2>&1; then
    getconf _NPROCESSORS_ONLN
    return 0
  fi
  echo 2
}

ensure_runtime_dirs() {
  mkdir -p "$RUNTIME_DIR" "$STATE_DIR" "$PID_DIR" "$LOG_DIR"
}

read_pid_file() {
  local pid_file="$1"
  [ -f "$pid_file" ] || return 1
  tr -d '[:space:]' < "$pid_file"
}

pid_is_running() {
  local pid="${1:-}"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" >/dev/null 2>&1
}

cleanup_stale_pid_file() {
  local pid_file="$1"
  local pid=""
  pid="$(read_pid_file "$pid_file" 2>/dev/null || true)"
  if [ -n "$pid" ] && ! pid_is_running "$pid"; then
    rm -f "$pid_file"
  fi
}

detect_public_host() {
  local candidate=""

  if [ -n "$PUBLIC_HOST" ]; then
    printf '%s\n' "$PUBLIC_HOST"
    return 0
  fi

  if command -v hostname >/dev/null 2>&1; then
    candidate="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  if [ -z "$candidate" ] && command -v ip >/dev/null 2>&1; then
    candidate="$(ip route get 1.1.1.1 2>/dev/null | awk '/src/ {for (i=1; i<=NF; i++) if ($i == "src") { print $(i+1); exit }}' || true)"
  fi
  if [ -z "$candidate" ] && command -v hostname >/dev/null 2>&1; then
    candidate="$(hostname -f 2>/dev/null || hostname 2>/dev/null || true)"
  fi

  printf '%s\n' "${candidate:-127.0.0.1}"
}

resolve_network_config() {
  local detected_public_host allowed_hosts

  detected_public_host="$(detect_public_host)"
  BACKEND_PUBLIC_HOST="${BACKEND_PUBLIC_HOST:-$detected_public_host}"

  export NEXT_PUBLIC_API_BASE="/api"
  export TTD_FRONTEND_ORIGIN="${PUBLIC_SCHEME}://${BACKEND_PUBLIC_HOST}:${BACKEND_PORT}"
  export TTD_FRONTEND_INTERNAL_URL="http://${FRONTEND_HOST}:${FRONTEND_PORT}"

  allowed_hosts="127.0.0.1,localhost,0.0.0.0,${BACKEND_PUBLIC_HOST}"
  if command -v hostname >/dev/null 2>&1; then
    allowed_hosts="${allowed_hosts},$(hostname 2>/dev/null || true),$(hostname -f 2>/dev/null || true)"
  fi
  export DJANGO_ALLOWED_HOSTS="${DJANGO_ALLOWED_HOSTS:-$allowed_hosts}"
}

spawn_detached() {
  local name="$1"
  local pid_file="$2"
  local log_file="$3"
  local workdir="$4"
  shift 4

  cleanup_stale_pid_file "$pid_file"
  local existing_pid=""
  existing_pid="$(read_pid_file "$pid_file" 2>/dev/null || true)"
  if [ -n "$existing_pid" ] && pid_is_running "$existing_pid"; then
    echo "${name} is already running (pid ${existing_pid})"
    return 0
  fi

  mkdir -p "$(dirname "$pid_file")" "$(dirname "$log_file")"
  (
    cd "$workdir"
    if command -v setsid >/dev/null 2>&1; then
      setsid "$@" >>"$log_file" 2>&1 </dev/null &
    else
      nohup "$@" >>"$log_file" 2>&1 </dev/null &
    fi
    echo $! > "$pid_file"
  )

  sleep 1
  local started_pid=""
  started_pid="$(read_pid_file "$pid_file" 2>/dev/null || true)"
  if [ -z "$started_pid" ] || ! pid_is_running "$started_pid"; then
    echo "${name} failed to start. Last log lines:"
    tail -n 40 "$log_file" 2>/dev/null || true
    return 1
  fi

  echo "${name} started (pid ${started_pid})"
}

stop_from_pid_file() {
  local name="$1"
  local pid_file="$2"
  local pid=""
  pid="$(read_pid_file "$pid_file" 2>/dev/null || true)"

  if [ -z "$pid" ]; then
    echo "${name} is not running"
    return 0
  fi

  if ! pid_is_running "$pid"; then
    rm -f "$pid_file"
    echo "${name} was already stopped"
    return 0
  fi

  kill "$pid" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if ! pid_is_running "$pid"; then
      rm -f "$pid_file"
      echo "${name} stopped"
      return 0
    fi
    sleep 1
  done

  kill -9 "$pid" >/dev/null 2>&1 || true
  rm -f "$pid_file"
  echo "${name} force-stopped"
}

print_process_status() {
  local name="$1"
  local pid_file="$2"
  local pid=""
  pid="$(read_pid_file "$pid_file" 2>/dev/null || true)"
  if [ -n "$pid" ] && pid_is_running "$pid"; then
    echo "${name}: running (pid ${pid})"
  else
    echo "${name}: stopped"
  fi
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
        "${LLAMA_CPP_RUNTIME_DIR}/build/bin/llama-server" \
        "${LLAMA_CPP_RUNTIME_DIR}/llama-server" \
        "${LLAMA_CPP_RUNTIME_DIR}/bin/llama-server" \
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
    candidate="$(find_executable_under "$LLAMA_CPP_RUNTIME_DIR" "llama-server" 6 || true)"
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

bootstrap_llama_cpp() {
  local repo_dir build_dir jobs candidate=""

  if [ "$TTD_AUTO_BOOTSTRAP_LLAMA_CPP" != "1" ]; then
    return 1
  fi

  if ! command -v git >/dev/null 2>&1; then
    echo "Cannot bootstrap llama.cpp automatically: git is not installed"
    return 1
  fi

  if ! command -v cmake >/dev/null 2>&1 && ! command -v make >/dev/null 2>&1; then
    echo "Cannot bootstrap llama.cpp automatically: install cmake or make first"
    return 1
  fi

  if ! command -v c++ >/dev/null 2>&1 && ! command -v g++ >/dev/null 2>&1 && ! command -v clang++ >/dev/null 2>&1; then
    echo "Cannot bootstrap llama.cpp automatically: no C++ compiler found"
    return 1
  fi

  repo_dir="${LLAMA_CPP_SOURCE_DIR:-$LLAMA_CPP_RUNTIME_DIR}"
  build_dir="${repo_dir}/build"
  jobs="${LLAMA_CPP_BUILD_JOBS:-$(cpu_jobs)}"

  mkdir -p "$RUNTIME_DIR"

  if [ ! -d "${repo_dir}/.git" ]; then
    echo "Bootstrapping llama.cpp from ${LLAMA_CPP_REPO_URL}..."
    rm -rf "$repo_dir"
    git clone --depth 1 --branch "$LLAMA_CPP_REPO_REF" --recurse-submodules "$LLAMA_CPP_REPO_URL" "$repo_dir"
  else
    echo "Updating local llama.cpp runtime..."
    if [ -z "$(git -C "$repo_dir" status --porcelain 2>/dev/null || true)" ]; then
      git -C "$repo_dir" fetch --quiet origin "$LLAMA_CPP_REPO_REF" || true
      git -C "$repo_dir" checkout --quiet "$LLAMA_CPP_REPO_REF" || true
      git -C "$repo_dir" pull --ff-only --quiet origin "$LLAMA_CPP_REPO_REF" || true
      git -C "$repo_dir" submodule update --init --recursive >/dev/null 2>&1 || true
    else
      echo "Skipping llama.cpp source update: local runtime tree has changes"
    fi
  fi

  if command -v cmake >/dev/null 2>&1; then
    echo "Building llama-server with CMake..."
    cmake -S "$repo_dir" -B "$build_dir" -DCMAKE_BUILD_TYPE=Release -DLLAMA_BUILD_SERVER=ON >/dev/null
    cmake --build "$build_dir" --config Release --target llama-server -j "$jobs"
    candidate="$(
      first_executable_path \
        "${build_dir}/bin/llama-server" \
        "${build_dir}/llama-server" \
        || true
    )"
  else
    echo "Building llama-server with make..."
    make -C "$repo_dir" -j"$jobs" llama-server
    candidate="$(
      first_executable_path \
        "${repo_dir}/llama-server" \
        "${repo_dir}/bin/llama-server" \
        "${repo_dir}/build/bin/llama-server" \
        || true
    )"
  fi

  if [ -n "$candidate" ]; then
    LLAMA_CPP_BIN="$candidate"
    export LLAMA_CPP_BIN
    echo "Built llama-server: ${LLAMA_CPP_BIN}"
    return 0
  fi

  echo "llama.cpp bootstrap finished, but llama-server binary was not found"
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
  if [ -z "$candidate" ]; then
    candidate="$(find_file_under "${LLAMA_CPP_RUNTIME_DIR}/models" "*.gguf" 6 || true)"
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

prepare_runtime_environment() {
  ensure_runtime_dirs
  auto_update_repo "$ACTION" "$@"
  resolve_repo_layout
  resolve_network_config

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
  export PYTHON
  "$PYTHON" -m pip install --upgrade pip
  "$PYTHON" -m pip install -r "$REQUIREMENTS_FILE"

  mkdir -p "$TTD_MODEL_DIR"

  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    (
      cd "$FRONTEND_DIR"
      npm install
    )
  fi

  NEXT_BIN="${FRONTEND_DIR}/node_modules/.bin/next"
  if [ ! -x "$NEXT_BIN" ]; then
    echo "Next.js binary not found: ${NEXT_BIN}"
    exit 1
  fi

  "$PYTHON" "$MANAGE_PY" migrate --noinput
  "$PYTHON" "$MANAGE_PY" shell -c "from core.seed import ensure_defaults; ensure_defaults()"

  if [ "$TTD_MODEL_BACKEND" = "llamacpp" ]; then
    LLAMA_CPP_BIN="${LLAMA_CPP_BIN:-}"
    if ! resolve_llama_cpp_bin && ! bootstrap_llama_cpp && ! resolve_llama_cpp_bin; then
      echo "llama-server not found. Searched PATH, repo directories, \$HOME/llama.cpp, \$HOME/.local/bin, /usr/local, and /opt."
      echo "Auto-bootstrap also failed. Install build tools (git, cmake or make, and a C++ compiler) or set LLAMA_CPP_BIN manually."
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
  fi
}

build_frontend_release() {
  (
    cd "$FRONTEND_DIR"
    npm run build
  )
}

start_stack_detached() {
  prepare_runtime_environment "$@"

  build_frontend_release

  if [ "$TTD_MODEL_BACKEND" = "llamacpp" ]; then
    spawn_detached "llama.cpp" "$LLAMA_PID_FILE" "$LLAMA_LOG_FILE" "$ROOT_DIR" "$LLAMA_CPP_BIN" "${LLAMA_ARGS[@]}"
  fi

  spawn_detached "backend" "$BACKEND_PID_FILE" "$BACKEND_LOG_FILE" "$ROOT_DIR" \
    "$PYTHON" "$MANAGE_PY" runserver "${BACKEND_HOST}:${BACKEND_PORT}" --noreload

  spawn_detached "frontend" "$FRONTEND_PID_FILE" "$FRONTEND_LOG_FILE" "$FRONTEND_DIR" \
    "$NEXT_BIN" start -H "$FRONTEND_HOST" -p "$FRONTEND_PORT"

  echo "Site:              ${TTD_FRONTEND_ORIGIN}"
  echo "Admin:             ${TTD_FRONTEND_ORIGIN}/admin-panel"
  echo "Backend API:       ${TTD_FRONTEND_ORIGIN}/api"
  echo "Frontend internal: ${TTD_FRONTEND_INTERNAL_URL}"
  echo "Logs:        ${LOG_DIR}"
}

start_stack_foreground() {
  prepare_runtime_environment "$@"

  cleanup() {
    if [ -n "${BACKEND_PID:-}" ]; then
      kill "$BACKEND_PID" >/dev/null 2>&1 || true
    fi
    if [ -n "${FRONTEND_PID:-}" ]; then
      kill "$FRONTEND_PID" >/dev/null 2>&1 || true
    fi
    if [ -n "${LLAMA_PID:-}" ]; then
      kill "$LLAMA_PID" >/dev/null 2>&1 || true
    fi
  }
  trap cleanup EXIT INT TERM

  if [ "$TTD_MODEL_BACKEND" = "llamacpp" ]; then
    "$LLAMA_CPP_BIN" "${LLAMA_ARGS[@]}" &
    LLAMA_PID=$!
    echo "llama.cpp: ${TTD_LLAMA_CPP_URL}"
  fi

  "$PYTHON" "$MANAGE_PY" runserver "${BACKEND_HOST}:${BACKEND_PORT}" &
  BACKEND_PID=$!

  echo "Site:              ${TTD_FRONTEND_ORIGIN}"
  echo "Admin:             ${TTD_FRONTEND_ORIGIN}/admin-panel"
  echo "Backend API:       ${TTD_FRONTEND_ORIGIN}/api"
  echo "Frontend internal: ${TTD_FRONTEND_INTERNAL_URL}"

  (
    cd "$FRONTEND_DIR"
    "$NEXT_BIN" dev -H "$FRONTEND_HOST" -p "$FRONTEND_PORT"
  ) &
  FRONTEND_PID=$!
  wait "$FRONTEND_PID"
}

stop_stack() {
  stop_from_pid_file "frontend" "$FRONTEND_PID_FILE"
  stop_from_pid_file "backend" "$BACKEND_PID_FILE"
  stop_from_pid_file "llama.cpp" "$LLAMA_PID_FILE"
}

show_status() {
  print_process_status "frontend" "$FRONTEND_PID_FILE"
  print_process_status "backend" "$BACKEND_PID_FILE"
  print_process_status "llama.cpp" "$LLAMA_PID_FILE"
}

show_logs() {
  ensure_runtime_dirs
  touch "$BACKEND_LOG_FILE" "$FRONTEND_LOG_FILE" "$LLAMA_LOG_FILE"
  tail -n "${TAIL_LINES:-120}" -f "$BACKEND_LOG_FILE" "$FRONTEND_LOG_FILE" "$LLAMA_LOG_FILE"
}

ensure_runtime_dirs

case "$ACTION" in
  start)
    start_stack_detached "$@"
    ;;
  stop)
    stop_stack
    ;;
  restart)
    stop_stack
    start_stack_detached "$@"
    ;;
  status)
    show_status
    ;;
  logs)
    show_logs
    ;;
  foreground)
    start_stack_foreground "$@"
    ;;
esac
