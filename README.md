# Time To Deny

Next.js chat UI with a Django/Python backend for local AI workflows.

## What Works

- Streaming chat responses over Server-Sent Events.
- Persistent chats, messages, generated files, request logs, model registry, and admin sessions.
- File attachments with stored text/data URL content.
- Generated file cards with content preview and a backend smoke test.
- Image generation placeholder output saved under Django media.
- Admin login, request database, server load view, model registry actions, password change, and session log.
- SQLite for local development, MySQL via environment variables.
- llama.cpp integration through `llama-server` and GGUF models.

## Branch

This is the Windows branch. It contains the shared Django/Next.js code and the Windows launchers only.

## Launch

By default the launcher starts `llama-server.exe` together with Django and Next.js. Put a GGUF model into `backend\models` or set `LLAMA_CPP_MODEL_PATH`.

```bat
launchers\windows.bat
```

The launcher starts:

- llama.cpp: `http://127.0.0.1:8080`
- Frontend: `http://127.0.0.1:4028`
- Backend API: `http://127.0.0.1:8000/api`
- Admin panel: `http://127.0.0.1:4028/admin-panel`

## Manual Backend

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
python backend\manage.py migrate
python backend\manage.py shell -c "from core.seed import ensure_defaults; ensure_defaults()"
python backend\manage.py runserver 127.0.0.1:8000
```

## Manual Frontend

```powershell
npm install
$env:NEXT_PUBLIC_API_BASE = "http://127.0.0.1:8000/api"
npm run dev
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

The model core is `llama.cpp`. The backend streams text requests through `llama-server.exe` when `TTD_MODEL_BACKEND=llamacpp`.

Run an existing llama.cpp server:

```powershell
llama-server.exe -m C:\models\model.gguf --host 127.0.0.1 --port 8080 -c 8192
$env:TTD_MODEL_BACKEND = "llamacpp"
$env:TTD_LLAMA_CPP_URL = "http://127.0.0.1:8080"
```

Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force backend\models
Copy-Item C:\models\model.gguf backend\models\
launchers\windows.bat
```

Useful llama.cpp env vars:

- `TTD_LLAMA_CPP_URL`: Django target URL, default `http://127.0.0.1:8080`.
- `LLAMA_CPP_MODEL_PATH`: GGUF file the launcher passes to `llama-server.exe`.
- `LLAMA_CPP_BIN`: llama.cpp server binary, default `llama-server.exe`.
- `LLAMA_CPP_CTX_SIZE`: context size passed to launcher, default `8192`.
- `LLAMA_CPP_THREADS`: optional thread count.
- `LLAMA_CPP_GPU_LAYERS`: optional GPU layer count.
- `TTD_LLAMA_CPP_N_PREDICT`: max generated tokens per request, default `1024`.

`mock` remains available for UI/backend smoke tests, because debugging CSS while waiting for a 14B model to wake up is punishment, not engineering.

```powershell
$env:TTD_MODEL_BACKEND = "mock"
launchers\windows.bat
```
