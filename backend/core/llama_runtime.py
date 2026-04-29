from __future__ import annotations

import os
import signal
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from django.conf import settings

from .models import ModelRegistry

try:
    import psutil
except ImportError:  # pragma: no cover - requirements include psutil, this keeps fallback sane.
    psutil = None


def _project_root() -> Path:
    return Path(settings.PROJECT_ROOT)


def _runtime_dir() -> Path:
    return _project_root() / ".runtime"


def _state_dir() -> Path:
    return _runtime_dir() / "state"


def _pid_file() -> Path:
    return _state_dir() / "pids" / "llama.pid"


def _log_file() -> Path:
    return _runtime_dir() / "logs" / "llama.log"


def _llama_host_port() -> tuple[str, int]:
    parsed = urlparse(settings.TTD_LLAMA_CPP_URL)
    return parsed.hostname or "127.0.0.1", parsed.port or 8080


def _health_url() -> str:
    return f"{settings.TTD_LLAMA_CPP_URL.rstrip('/')}/health"


def _socket_host(host: str) -> str:
    return "127.0.0.1" if host in {"0.0.0.0", "::"} else host


def _port_open() -> bool:
    host, port = _llama_host_port()
    try:
        with socket.create_connection((_socket_host(host), port), timeout=0.5):
            return True
    except OSError:
        return False


def _llama_ready() -> tuple[bool, str]:
    if not _port_open():
        return False, "port closed"
    try:
        with urllib.request.urlopen(_health_url(), timeout=2) as response:
            body = response.read(256).decode("utf-8", errors="replace").strip()
            return 200 <= response.status < 300, body or f"HTTP {response.status}"
    except urllib.error.HTTPError as exc:
        body = exc.read(256).decode("utf-8", errors="replace").strip()
        if exc.code == 404:
            return True, "health endpoint missing; assuming ready"
        return False, body or f"HTTP {exc.code}"
    except (OSError, TimeoutError) as exc:
        return False, str(exc)


def _wait_for_llama_ready(proc: subprocess.Popen | None = None, timeout: int | None = None) -> None:
    timeout = timeout or settings.TTD_LLAMA_READY_TIMEOUT_SECONDS
    deadline = time.monotonic() + timeout
    last_status = "not checked"

    while time.monotonic() < deadline:
        if proc and proc.poll() is not None:
            raise RuntimeError(f"llama-server exited during startup. Check {_log_file()}.")
        ready, last_status = _llama_ready()
        if ready:
            return
        time.sleep(1)

    raise RuntimeError(
        f"llama-server opened {settings.TTD_LLAMA_CPP_URL}, but the model was not ready within {timeout}s "
        f"(/health: {last_status}). Check {_log_file()}."
    )


def _pid_running(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _read_managed_pid() -> int | None:
    try:
        raw = _pid_file().read_text(encoding="utf-8").strip()
        return int(raw) if raw else None
    except (OSError, ValueError):
        return None


def _log_tail(lines: int = 40) -> str:
    try:
        content = _log_file().read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return ""
    return "\n".join(content[-lines:])


def _bytes_label(value: int | float | None) -> str:
    amount = float(value or 0)
    if amount <= 0:
        return "-"
    gb = amount / (1024**3)
    if gb >= 1:
        return f"{gb:.2f}GB"
    mb = amount / (1024**2)
    if mb >= 1:
        return f"{mb:.1f}MB"
    kb = amount / 1024
    if kb >= 1:
        return f"{kb:.1f}KB"
    return f"{int(amount)}B"


def _duration_label(seconds: int | float | None) -> str:
    value = int(seconds or 0)
    if value <= 0:
        return "-"
    minutes, sec = divmod(value, 60)
    hours, minutes = divmod(minutes, 60)
    days, hours = divmod(hours, 24)
    if days:
        return f"{days}d {hours}h"
    if hours:
        return f"{hours}h {minutes}m"
    if minutes:
        return f"{minutes}m {sec}s"
    return f"{sec}s"


def _process_info(pid: int | None, source: str) -> dict | None:
    if not psutil or not pid:
        return None
    try:
        proc = psutil.Process(pid)
        with proc.oneshot():
            memory = proc.memory_info().rss
            created = proc.create_time()
            uptime = max(0, int(time.time() - created))
            cmdline = " ".join(proc.cmdline())
            return {
                "pid": proc.pid,
                "source": source,
                "name": proc.name(),
                "status": proc.status(),
                "cpuPercent": proc.cpu_percent(interval=0.0),
                "memoryRss": memory,
                "memoryRssLabel": _bytes_label(memory),
                "createdAt": int(created),
                "uptimeSeconds": uptime,
                "uptimeLabel": _duration_label(uptime),
                "cmdline": cmdline,
            }
    except (psutil.Error, OSError):
        return None


def _process_for_port(port: int) -> dict | None:
    if not psutil:
        return None
    try:
        for conn in psutil.net_connections(kind="tcp"):
            if not conn.laddr or conn.status != psutil.CONN_LISTEN:
                continue
            if conn.laddr.port == port and conn.pid:
                return _process_info(conn.pid, "port")
    except (psutil.Error, OSError):
        return None
    return None


def stop_managed_llama() -> None:
    pid = _read_managed_pid()
    if not pid or not _pid_running(pid):
        try:
            _pid_file().unlink()
        except OSError:
            pass
        return

    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        return

    for _ in range(20):
        if not _pid_running(pid):
            try:
                _pid_file().unlink()
            except OSError:
                pass
            return
        time.sleep(0.25)

    try:
        os.kill(pid, signal.SIGKILL)
    except OSError:
        return
    try:
        _pid_file().unlink()
    except OSError:
        pass


def _selected_model_path(model: ModelRegistry | None = None) -> Path | None:
    selected = model or ModelRegistry.objects.filter(selected=True, status="ready").first()
    if selected and selected.local_path:
        path = Path(selected.local_path).expanduser()
        if path.is_file():
            return path.resolve()

    for candidate in Path(settings.TTD_MODEL_DIR).glob("**/*.gguf"):
        if candidate.is_file():
            return candidate.resolve()
    return None


def _find_llama_server_binary() -> Path | None:
    configured = os.environ.get("LLAMA_CPP_BIN", "").strip()
    candidates: list[Path] = []
    if configured:
        candidates.append(Path(configured).expanduser())
    discovered = shutil.which("llama-server")
    if discovered:
        candidates.append(Path(discovered))

    project_root = _project_root()
    candidates.extend(
        [
            project_root / "llamaserver" / "llama.cpp" / "build" / "bin" / "llama-server",
            project_root / "llamaserver" / "llama.cpp" / "build" / "llama-server",
            project_root / "llamaserver" / "llama.cpp" / "llama-server",
            project_root / "llamaserver" / "llama-server",
            Path("/usr/local/bin/llama-server"),
            Path("/usr/bin/llama-server"),
        ]
    )

    for candidate in candidates:
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return candidate.resolve()
    return None


def llama_runtime_status() -> dict:
    pid = _read_managed_pid()
    host, port = _llama_host_port()
    selected = ModelRegistry.objects.filter(selected=True, status="ready").first()
    model_path = _selected_model_path(selected)
    binary = _find_llama_server_binary()
    port_open = _port_open()
    ready, health = _llama_ready() if port_open else (False, "port closed")
    pid_running = bool(pid and _pid_running(pid))
    process = _process_info(pid, "managed") if pid_running else None
    if not process and port_open:
        process = _process_for_port(port)
    return {
        "backend": settings.TTD_MODEL_BACKEND,
        "url": settings.TTD_LLAMA_CPP_URL,
        "host": host,
        "port": port,
        "portOpen": port_open,
        "ready": ready,
        "health": health,
        "running": ready,
        "managedPid": pid,
        "managedPidRunning": pid_running,
        "process": process,
        "selectedModel": selected.name if selected else None,
        "modelPath": str(model_path) if model_path else None,
        "modelFileExists": bool(model_path and model_path.is_file()),
        "binary": str(binary) if binary else None,
        "binaryExists": bool(binary),
        "logFile": str(_log_file()),
        "logTail": _log_tail(),
        "settings": {
            "contextSize": selected.llama_context_size if selected and selected.llama_context_size else settings.TTD_LLAMA_CPP_CTX_SIZE,
            "threads": selected.llama_threads if selected and selected.llama_threads else None,
            "gpuLayers": selected.llama_gpu_layers if selected and selected.llama_gpu_layers >= 0 else None,
            "promptCache": selected.prompt_cache_enabled if selected else True,
        },
    }


def llama_launch_check(model: ModelRegistry | None = None) -> dict:
    selected = model or ModelRegistry.objects.filter(selected=True, status="ready").first()
    model_path = _selected_model_path(selected)
    binary = _find_llama_server_binary()
    host, port = _llama_host_port()
    errors: list[str] = []
    warnings: list[str] = []

    if settings.TTD_MODEL_BACKEND not in {"llamacpp", "llama.cpp"}:
        warnings.append(f"Backend is {settings.TTD_MODEL_BACKEND}, llama.cpp launch is disabled.")
    if not selected:
        errors.append("No ready model selected.")
    elif selected.model_type == "vision":
        errors.append("Vision models cannot be launched as the chat response model.")
    if not model_path or not model_path.is_file():
        errors.append(f"GGUF file is missing in {settings.TTD_MODEL_DIR}.")
    if not binary:
        errors.append("llama-server binary was not found.")

    ready, health = _llama_ready() if _port_open() else (False, "port closed")
    if ready and selected and model_path:
        warnings.append("llama-server is already responding on the configured port.")

    return {
        "ok": not errors,
        "message": "Launch check passed." if not errors else "Launch check failed.",
        "errors": errors,
        "warnings": warnings,
        "model": selected.name if selected else None,
        "modelPath": str(model_path) if model_path else None,
        "binary": str(binary) if binary else None,
        "url": settings.TTD_LLAMA_CPP_URL,
        "host": host,
        "port": port,
        "ready": ready,
        "health": health,
    }


def restart_llama_server(model: ModelRegistry | None = None) -> dict:
    stop_managed_llama()
    ensure_llama_server(model)
    return llama_runtime_status()


def ensure_llama_server(model: ModelRegistry | None = None) -> None:
    if settings.TTD_MODEL_BACKEND not in {"llamacpp", "llama.cpp"}:
        return
    if _port_open():
        _wait_for_llama_ready(timeout=settings.TTD_LLAMA_READY_TIMEOUT_SECONDS)
        return

    model_path = _selected_model_path(model)
    if not model_path:
        raise RuntimeError(f"No local GGUF model found in {settings.TTD_MODEL_DIR}. Install a model first.")

    binary = _find_llama_server_binary()
    if not binary:
        raise RuntimeError("llama-server binary was not found. Run ./linux.sh restart to build llama.cpp.")

    host, port = _llama_host_port()
    _pid_file().parent.mkdir(parents=True, exist_ok=True)
    _log_file().parent.mkdir(parents=True, exist_ok=True)
    log_handle = _log_file().open("ab")
    cmd = [
        str(binary),
        "-m",
        str(model_path),
        "--host",
        host,
        "--port",
        str(port),
        "-c",
        str(model.llama_context_size if model and model.llama_context_size else settings.TTD_LLAMA_CPP_CTX_SIZE),
    ]
    threads = model.llama_threads if model and model.llama_threads else 0
    if threads > 0:
        cmd.extend(["-t", str(threads)])
    gpu_layers = model.llama_gpu_layers if model else -1
    if gpu_layers >= 0:
        cmd.extend(["-ngl", str(gpu_layers)])

    proc = subprocess.Popen(
        cmd,
        cwd=str(_project_root()),
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
    )
    log_handle.close()
    _pid_file().write_text(str(proc.pid), encoding="utf-8")

    timeout = int(os.environ.get("TTD_LLAMA_START_TIMEOUT_SECONDS", str(settings.TTD_LLAMA_READY_TIMEOUT_SECONDS)))
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"llama-server exited during startup. Check {_log_file()}.")
        if _port_open():
            _wait_for_llama_ready(proc, timeout=max(1, int(deadline - time.monotonic())))
            return
        time.sleep(1)

    raise RuntimeError(f"llama-server did not open {settings.TTD_LLAMA_CPP_URL} within {timeout}s. Check {_log_file()}.")
