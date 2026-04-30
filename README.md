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
- Chat queueing, stop generation, context history, and a Russian-language guard against random language drift.
- Per-chat workspace API for generated files: tree, read/write, zip download, diff, and rollback.
- Admin maintenance endpoints for runtime logs, disk usage, cleanup, SQLite backup, and local GGUF import.

## Branch

This is the Windows branch. It contains the shared Django/Next.js code and the Windows launcher only.

## Recommended Windows Path

For a Windows machine, keep the project somewhere simple, for example `C:\timetodeny`.

Install the base tools first:

```powershell
winget install Git.Git
winget install Python.Python.3.12
winget install OpenJS.NodeJS.LTS
winget install Kitware.CMake
```

Visual Studio Build Tools with the C++ toolchain are required if the launcher needs to build llama.cpp locally.

```powershell
cd C:\
git clone --branch windows --single-branch https://github.com/AlbertGithot/timetodeny.git timetodeny
cd C:\timetodeny
mkdir models, llamaserver
```

If the project is already cloned, just run:

```powershell
mkdir models, llamaserver
```

The launcher also creates these folders automatically.

## Project Layout

- `manage.py` — Django entrypoint from the repository root.
- `backend/timetodeny/` — Django project settings, URLs, ASGI/WSGI.
- `backend/core/` — app models, API views, serializers, llama.cpp service, tests.
- `requirements.txt` — Python dependencies.
- `models/` — local GGUF models; ignored by git.
- `llamaserver/` — local llama.cpp source/build folder; ignored by git.
- `backend/media/` — generated files/images; ignored by git.
- `frontend/` — Next.js app, source, assets, and config files.
- `build-windows-exe.ps1` — builds `dist\TimeToDeny.exe` with the site icon from `frontend\public\assets\images\app_logo.png`.
- `windows.ps1` / `windows.bat` — script fallback launcher that builds the TypeScript frontend, starts llama.cpp when possible, and serves everything through Django.

## Launch

By default the launcher builds the Next.js/TypeScript frontend into `frontend/out`, then starts `llama-server.exe` and Django in detached mode so they keep running after the terminal closes. Put a GGUF model into `models\` or set `LLAMA_CPP_MODEL_PATH`.
Before startup it also tries to fast-forward the current git branch from `origin` automatically. If the repo has local changes, auto-update is skipped.
The launcher also creates `models\` and `llamaserver\`, uses root `manage.py` and `requirements.txt`, builds the `frontend\` app, and looks for nearby `.gguf` models.
If `llama-server.exe` is missing, the launcher can clone/update and build `ggml-org/llama.cpp` into `llamaserver\llama.cpp` when git, CMake, and a C++ compiler are available.
By default Django binds to `0.0.0.0:8000` and serves both the API and the exported frontend. There is no public or internal Next.js runtime server in the normal launcher path.

Build the native launcher exe first:

```powershell
winget install Microsoft.DotNet.SDK.8
.\build-windows-exe.ps1
.\dist\TimeToDeny.exe start
```

`windows.bat` also uses `dist\TimeToDeny.exe` automatically after it exists.
GitHub Actions also builds the same exe on pushes to the `windows` branch and uploads it as `TimeToDeny-windows-launcher`.

Script fallback:

```powershell
.\windows.ps1
```

Disable auto-update if needed:

```powershell
$env:TTD_AUTO_UPDATE = "0"
.\windows.ps1
```

Disable automatic llama.cpp bootstrap if needed:

```powershell
$env:TTD_AUTO_BOOTSTRAP_LLAMA_CPP = "0"
.\windows.ps1
```

Useful launcher commands:

```powershell
.\dist\TimeToDeny.exe start
.\dist\TimeToDeny.exe stop
.\dist\TimeToDeny.exe restart
.\dist\TimeToDeny.exe status
.\dist\TimeToDeny.exe logs
.\dist\TimeToDeny.exe foreground
.\dist\TimeToDeny.exe doctor
.\dist\TimeToDeny.exe repair
```

The launcher starts:

- llama.cpp: `http://127.0.0.1:8080`
- Site: `http://127.0.0.1:8000`
- Backend API: `http://127.0.0.1:8000/api`
- Admin panel: `http://127.0.0.1:8000/admin-panel`
- Frontend files: `frontend/out`
- Model files: `models/`
- llama.cpp source/build: `llamaserver/llama.cpp`

Model installs from the admin panel download the requested HuggingFace `.gguf` file into `models/` by default. Set `TTD_ALLOW_HF_DOWNLOAD=0` only if you intentionally want to block web downloads.
When a ready model is selected, the launcher prefers that registered local file. If the Django chat sees that `llama-server` is not listening, it also tries to start the managed `llama-server` process automatically before sending the prompt.
The model registry is synchronized from real `.gguf` files under `models/`; stale registry rows without a local file are removed from the UI.

The admin model registry includes a llama.cpp runtime health panel with selected model path, PID, port state, last log lines, and a restart button.
`.\windows.ps1 doctor` prints missing dependencies, model count, frontend export state, and llama-server discovery. `.\windows.ps1 repair` recreates runtime basics, installs dependencies, rebuilds the frontend export, and tries to build llama.cpp if the toolchain exists.

## Manual Backend

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
$env:DJANGO_ALLOWED_HOSTS = "127.0.0.1,localhost,SERVER_IP"
python manage.py migrate
python manage.py shell -c "from core.seed import ensure_defaults; ensure_defaults()"
python manage.py runserver 0.0.0.0:8000
```

## Manual Frontend Build

```powershell
cd frontend
npm install
$env:NEXT_PUBLIC_API_BASE = "/api"
npm run build
```

## MySQL

Set these before running migrations:

```powershell
$env:MYSQL_DATABASE = "timetodeny"
$env:MYSQL_USER = "ttd"
$env:MYSQL_PASSWORD = "change-me"
$env:MYSQL_HOST = "127.0.0.1"
$env:MYSQL_PORT = "3306"
```

Without `MYSQL_DATABASE`, Django uses `backend/db.sqlite3`.

## llama.cpp Model Backend

The model core is `llama.cpp`. The backend streams text requests through `llama-server` when `TTD_MODEL_BACKEND=llamacpp`.

Run an existing llama.cpp server:

```powershell
llama-server.exe -m C:\path\to\model.gguf --host 127.0.0.1 --port 8080 -c 8192
$env:TTD_MODEL_BACKEND = "llamacpp"
$env:TTD_LLAMA_CPP_URL = "http://127.0.0.1:8080"
```

Or let the launcher find and start it:

```powershell
mkdir models, llamaserver
copy C:\path\to\model.gguf models\
.\windows.ps1
```

Useful llama.cpp env vars:

- `TTD_LLAMA_CPP_URL`: Django target URL, default `http://127.0.0.1:8080`.
- `LLAMA_CPP_MODEL_PATH`: GGUF file the launcher passes to `llama-server`.
- `LLAMA_CPP_BIN`: llama.cpp server binary, default `llama-server.exe`.
- `LLAMA_CPP_SOURCE_DIR`: custom llama.cpp source/build folder, default `llamaserver/llama.cpp`.
- `TTD_MODEL_DIR`: custom model folder, default `models/`.
- `LLAMA_CPP_CTX_SIZE`: context size passed to launcher, default `8192`.
- `LLAMA_CPP_THREADS`: optional thread count.
- `LLAMA_CPP_GPU_LAYERS`: optional GPU layer count.
- `TTD_LLAMA_CPP_N_PREDICT`: optional hard cap for generated tokens per request. Default `0` omits `max_tokens`, so llama.cpp lets the model stop naturally.
- `TTD_REQUEST_TIMEOUT_SECONDS`: how long Django waits for llama.cpp to produce stream data before treating the model as stuck, default `900`.
- `TTD_LLAMA_READY_TIMEOUT_SECONDS`: how long Django waits for `llama-server` `/health` and retries temporary `503` responses, default `180`.
- `TTD_MAX_PROMPT_CHARS`: optional prompt limit; `0` means unlimited, default `0`.
- `TTD_MAX_ATTACHMENTS`: optional attachment count limit; `0` means unlimited, default `0`.
- `TTD_MAX_ATTACHMENT_CHARS`: optional per-attachment text/data limit; `0` means unlimited, default `0`.
- `TTD_WORKSPACE_MAX_FILE_BYTES`: optional workspace file preview/write limit; `0` means unlimited, default `0`.
- `TTD_CHAT_CONTEXT_MESSAGES`: previous chat messages sent to llama.cpp, default `12`.
- `TTD_ADMIN_SESSION_TTL_SECONDS`: admin session TTL, default `86400`.
- `TTD_LOGIN_RATE_LIMIT_ATTEMPTS`: failed login attempts before cooldown, default `5`.

`mock` remains available for UI/backend smoke tests, because debugging CSS while waiting for a 14B model to wake up is punishment, not engineering.

```powershell
$env:TTD_MODEL_BACKEND = "mock"
.\windows.ps1
```
