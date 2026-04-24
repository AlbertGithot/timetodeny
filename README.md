# Time To Deny

Next.js chat UI with a Django/Python backend for local AI workflows.

## What Works

- Streaming chat responses over Server-Sent Events.
- Persistent chats, messages, generated files, request logs, model registry, and admin sessions.
- File attachments with stored text/data URL content.
- Generated file cards with content preview and a backend smoke test.
- Image generation placeholder output saved under Django media.
- Admin login, request database, server load view, model registry actions, password change, and session log.
- HuggingFace GGUF model search in the admin registry with one-click install form fill.
- SQLite for local development, MySQL via environment variables.
- llama.cpp integration through `llama-server` and GGUF models.

## Branch

This is the Linux branch. It contains the shared Django/Next.js code and the Linux launcher only.

## Project Layout

- `manage.py` — Django entrypoint from the repository root.
- `backend/timetodeny/` — Django project settings, URLs, ASGI/WSGI.
- `backend/core/` — app models, API views, serializers, llama.cpp service, tests.
- `requirements.txt` — Python dependencies.
- `backend/models/` — local GGUF models; ignored by git.
- `backend/media/` — generated files/images; ignored by git.
- `frontend/` — Next.js app, source, assets, and config files.
- `linux.sh` — Linux launcher that starts llama.cpp, Django, and Next.js.

## Launch

By default the launcher starts `llama-server`, Django, and Next.js in detached mode so they survive SSH logout. Put a GGUF model into `backend/models` or set `LLAMA_CPP_MODEL_PATH`.
Before startup it also tries to fast-forward the current git branch from `origin` automatically. If the repo has local changes, auto-update is skipped.
If `node`/`npm` is missing on Linux, `./linux.sh` downloads a local runtime into `.runtime/node` automatically.
The launcher also auto-discovers `manage.py`, `requirements.txt`, the frontend folder, `llama-server`, and nearby `.gguf` models in common project/system locations.
If `llama-server` is missing, the launcher can clone and build `ggml-org/llama.cpp` automatically into `.runtime/llama.cpp` when git/build tools are available.
By default backend/frontend bind to `0.0.0.0`; public URLs are derived from the server IP unless you override `PUBLIC_HOST`, `BACKEND_PUBLIC_HOST`, or `FRONTEND_PUBLIC_HOST`.

```bash
./linux.sh
```

Disable auto-update if needed:

```bash
TTD_AUTO_UPDATE=0 ./linux.sh
```

Disable automatic llama.cpp bootstrap if needed:

```bash
TTD_AUTO_BOOTSTRAP_LLAMA_CPP=0 ./linux.sh
```

Useful launcher commands:

```bash
./linux.sh start
./linux.sh stop
./linux.sh restart
./linux.sh status
./linux.sh logs
./linux.sh foreground
```

The launcher starts:

- llama.cpp: `http://127.0.0.1:8080`
- Frontend: `http://127.0.0.1:4028`
- Backend API: `http://127.0.0.1:8000/api`
- Admin panel: `http://127.0.0.1:4028/admin-panel`

## Manual Backend

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
export DJANGO_ALLOWED_HOSTS="127.0.0.1,localhost,SERVER_IP"
python manage.py migrate
python manage.py shell -c "from core.seed import ensure_defaults; ensure_defaults()"
python manage.py runserver 0.0.0.0:8000
```

## Manual Frontend

```bash
cd frontend
npm install
NEXT_PUBLIC_API_BASE=http://SERVER_IP:8000/api npm run dev -- -H 0.0.0.0 -p 4028
```

## MySQL

Set these before running migrations:

```bash
export MYSQL_DATABASE=timetodeny
export MYSQL_USER=ttd
export MYSQL_PASSWORD=change-me
export MYSQL_HOST=127.0.0.1
export MYSQL_PORT=3306
```

Without `MYSQL_DATABASE`, Django uses `backend/db.sqlite3`.

## llama.cpp Model Backend

The model core is `llama.cpp`. The backend streams text requests through `llama-server` when `TTD_MODEL_BACKEND=llamacpp`.

Run an existing llama.cpp server:

```bash
llama-server -m /path/to/model.gguf --host 127.0.0.1 --port 8080 -c 8192
export TTD_MODEL_BACKEND=llamacpp
export TTD_LLAMA_CPP_URL=http://127.0.0.1:8080
```

Or let the launcher find and start it:

```bash
mkdir -p backend/models
cp /path/to/model.gguf backend/models/
./linux.sh
```

Useful llama.cpp env vars:

- `TTD_LLAMA_CPP_URL`: Django target URL, default `http://127.0.0.1:8080`.
- `LLAMA_CPP_MODEL_PATH`: GGUF file the launcher passes to `llama-server`.
- `LLAMA_CPP_BIN`: llama.cpp server binary, default `llama-server`.
- `LLAMA_CPP_CTX_SIZE`: context size passed to launcher, default `8192`.
- `LLAMA_CPP_THREADS`: optional thread count.
- `LLAMA_CPP_GPU_LAYERS`: optional GPU layer count.
- `TTD_LLAMA_CPP_N_PREDICT`: max generated tokens per request, default `1024`.

`mock` remains available for UI/backend smoke tests, because debugging CSS while waiting for a 14B model to wake up is punishment, not engineering.

```bash
TTD_MODEL_BACKEND=mock ./linux.sh
```
