$ErrorActionPreference = "Stop"

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RootDir

$BackendHost = if ($env:BACKEND_HOST) { $env:BACKEND_HOST } else { "127.0.0.1" }
$BackendPort = if ($env:BACKEND_PORT) { $env:BACKEND_PORT } else { "8000" }
$FrontendPort = if ($env:FRONTEND_PORT) { $env:FRONTEND_PORT } else { "4028" }
$LlamaCppHost = if ($env:LLAMA_CPP_HOST) { $env:LLAMA_CPP_HOST } else { "127.0.0.1" }
$LlamaCppPort = if ($env:LLAMA_CPP_PORT) { $env:LLAMA_CPP_PORT } else { "8080" }

if (-not $env:TTD_MODEL_BACKEND) {
  $env:TTD_MODEL_BACKEND = "llamacpp"
}
if (-not $env:TTD_MODEL_DIR) {
  $env:TTD_MODEL_DIR = Join-Path $RootDir "backend\models"
}
if (-not $env:NEXT_PUBLIC_API_BASE) {
  $env:NEXT_PUBLIC_API_BASE = "http://${BackendHost}:${BackendPort}/api"
}
if (-not $env:TTD_FRONTEND_ORIGIN) {
  $env:TTD_FRONTEND_ORIGIN = "http://127.0.0.1:${FrontendPort}"
}
if (-not $env:TTD_LLAMA_CPP_URL) {
  $env:TTD_LLAMA_CPP_URL = "http://${LlamaCppHost}:${LlamaCppPort}"
}

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  throw "python is required"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm is required for the Next.js frontend"
}

if (-not (Test-Path ".venv")) {
  python -m venv .venv
}

$Python = Join-Path $RootDir ".venv\Scripts\python.exe"
& $Python -m pip install --upgrade pip
& $Python -m pip install -r backend\requirements.txt

New-Item -ItemType Directory -Force -Path $env:TTD_MODEL_DIR | Out-Null

if (-not (Test-Path "node_modules")) {
  npm install
}

& $Python manage.py migrate --noinput
& $Python manage.py shell -c "from core.seed import ensure_defaults; ensure_defaults()"

$Llama = $null
if ($env:TTD_MODEL_BACKEND -eq "llamacpp" -and -not $env:LLAMA_CPP_MODEL_PATH) {
  $FoundModel = Get-ChildItem -Path $env:TTD_MODEL_DIR -Filter "*.gguf" -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($FoundModel) {
    $env:LLAMA_CPP_MODEL_PATH = $FoundModel.FullName
  }
}

if ($env:TTD_MODEL_BACKEND -eq "llamacpp") {
  $LlamaCppBin = if ($env:LLAMA_CPP_BIN) { $env:LLAMA_CPP_BIN } else { "llama-server.exe" }
  if (-not (Get-Command $LlamaCppBin -ErrorAction SilentlyContinue)) {
    throw "$LlamaCppBin is required. Install/build llama.cpp and make llama-server.exe available in PATH."
  }
  if (-not $env:LLAMA_CPP_MODEL_PATH) {
    throw "No GGUF model found. Put a .gguf file into $env:TTD_MODEL_DIR or set LLAMA_CPP_MODEL_PATH. For UI-only dev use: `$env:TTD_MODEL_BACKEND='mock'"
  }
  if (-not (Test-Path $env:LLAMA_CPP_MODEL_PATH)) {
    throw "LLAMA_CPP_MODEL_PATH does not exist: $env:LLAMA_CPP_MODEL_PATH"
  }

  $LlamaCtxSize = if ($env:LLAMA_CPP_CTX_SIZE) { $env:LLAMA_CPP_CTX_SIZE } else { "8192" }
  $LlamaArgs = @(
    "-m", $env:LLAMA_CPP_MODEL_PATH,
    "--host", $LlamaCppHost,
    "--port", $LlamaCppPort,
    "-c", $LlamaCtxSize
  )
  if ($env:LLAMA_CPP_THREADS) {
    $LlamaArgs += @("-t", $env:LLAMA_CPP_THREADS)
  }
  if ($env:LLAMA_CPP_GPU_LAYERS) {
    $LlamaArgs += @("-ngl", $env:LLAMA_CPP_GPU_LAYERS)
  }

  $Llama = Start-Process -FilePath $LlamaCppBin -ArgumentList $LlamaArgs -PassThru -NoNewWindow
  Write-Host "llama.cpp: $env:TTD_LLAMA_CPP_URL"
}

$Backend = Start-Process -FilePath $Python `
  -ArgumentList "manage.py", "runserver", "${BackendHost}:${BackendPort}" `
  -PassThru `
  -NoNewWindow

Write-Host "Backend:  http://${BackendHost}:${BackendPort}"
Write-Host "Frontend: http://127.0.0.1:${FrontendPort}"
Write-Host "Admin:    http://127.0.0.1:${FrontendPort}/admin-panel"

try {
  npm run dev
}
finally {
  if ($Backend -and -not $Backend.HasExited) {
    Stop-Process -Id $Backend.Id -Force
  }
  if ($Llama -and -not $Llama.HasExited) {
    Stop-Process -Id $Llama.Id -Force
  }
}
