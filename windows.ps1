$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RootDir

$ScriptPath = $MyInvocation.MyCommand.Path
$RuntimeDir = Join-Path $RootDir ".runtime"
$StateDir = Join-Path $RuntimeDir "state"
$PidDir = Join-Path $StateDir "pids"
$LogDir = Join-Path $RuntimeDir "logs"
$ModelsDir = if ($env:TTD_PROJECT_MODELS_DIR) { $env:TTD_PROJECT_MODELS_DIR } else { Join-Path $RootDir "models" }
$LlamaServerDir = if ($env:TTD_LLAMA_SERVER_DIR) { $env:TTD_LLAMA_SERVER_DIR } else { Join-Path $RootDir "llamaserver" }
$LlamaCppDir = if ($env:LLAMA_CPP_SOURCE_DIR) { $env:LLAMA_CPP_SOURCE_DIR } else { Join-Path $LlamaServerDir "llama.cpp" }

$Action = if ($args.Count -gt 0) { $args[0].ToLowerInvariant() } else { "start" }
if (@("start", "stop", "restart", "status", "logs", "foreground", "doctor", "repair") -notcontains $Action) {
  $Action = "start"
}

$BackendPidFile = Join-Path $PidDir "backend.pid"
$LlamaPidFile = Join-Path $PidDir "llama.pid"
$BackendLogFile = Join-Path $LogDir "backend.log"
$BackendErrFile = Join-Path $LogDir "backend.err.log"
$LlamaLogFile = Join-Path $LogDir "llama.log"
$LlamaErrFile = Join-Path $LogDir "llama.err.log"

$ServerBindHost = if ($env:SERVER_BIND_HOST) { $env:SERVER_BIND_HOST } else { "0.0.0.0" }
$BackendHost = if ($env:BACKEND_HOST) { $env:BACKEND_HOST } else { $ServerBindHost }
$BackendPort = if ($env:BACKEND_PORT) { $env:BACKEND_PORT } else { "8000" }
$LlamaCppHost = if ($env:LLAMA_CPP_HOST) { $env:LLAMA_CPP_HOST } else { "127.0.0.1" }
$LlamaCppPort = if ($env:LLAMA_CPP_PORT) { $env:LLAMA_CPP_PORT } else { "8080" }

if (-not $env:TTD_MODEL_BACKEND) { $env:TTD_MODEL_BACKEND = "llamacpp" }
if (-not $env:TTD_MODEL_DIR) { $env:TTD_MODEL_DIR = $ModelsDir }
if (-not $env:TTD_LLAMA_CPP_URL) { $env:TTD_LLAMA_CPP_URL = "http://${LlamaCppHost}:${LlamaCppPort}" }
if (-not $env:TTD_FRONTEND_ORIGIN) { $env:TTD_FRONTEND_ORIGIN = "http://127.0.0.1:${BackendPort}" }
if (-not $env:NEXT_PUBLIC_API_BASE) { $env:NEXT_PUBLIC_API_BASE = "/api" }
if (-not $env:DJANGO_ALLOWED_HOSTS) { $env:DJANGO_ALLOWED_HOSTS = "127.0.0.1,localhost,0.0.0.0" }
if (-not $env:TTD_AUTO_UPDATE) { $env:TTD_AUTO_UPDATE = "1" }
if (-not $env:TTD_AUTO_BOOTSTRAP_LLAMA_CPP) { $env:TTD_AUTO_BOOTSTRAP_LLAMA_CPP = "1" }
if (-not $env:LLAMA_CPP_REPO_URL) { $env:LLAMA_CPP_REPO_URL = "https://github.com/ggml-org/llama.cpp.git" }
if (-not $env:LLAMA_CPP_REPO_REF) { $env:LLAMA_CPP_REPO_REF = "master" }

function Ensure-Dirs {
  New-Item -ItemType Directory -Force -Path $RuntimeDir, $StateDir, $PidDir, $LogDir, $ModelsDir, $LlamaServerDir | Out-Null
}

function Get-CommandPath([string]$Name) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function Get-Python {
  $py = Get-CommandPath "py"
  if ($py) { return @{ File = $py; Prefix = @("-3") } }
  $python = Get-CommandPath "python"
  if ($python) { return @{ File = $python; Prefix = @() } }
  $python3 = Get-CommandPath "python3"
  if ($python3) { return @{ File = $python3; Prefix = @() } }
  throw "python is required"
}

function Invoke-Python {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$PythonArgs)
  $py = Get-Python
  & $py.File @($py.Prefix + $PythonArgs)
}

function Get-VenvPython {
  return Join-Path $RootDir ".venv\Scripts\python.exe"
}

function Ensure-Venv {
  if (-not (Test-Path ".venv")) {
    Invoke-Python -m venv .venv
  }
  $python = Get-VenvPython
  if (-not (Test-Path $python)) {
    throw "virtualenv python was not found: $python"
  }
  & $python -m ensurepip --upgrade | Out-Null
  & $python -m pip install --upgrade pip
  & $python -m pip install -r (Join-Path $RootDir "requirements.txt")
}

function Auto-Update {
  if ($env:TTD_AUTO_UPDATE -ne "1") { return }
  if (-not (Get-CommandPath "git")) { return }
  if (-not (Test-Path (Join-Path $RootDir ".git"))) { return }
  if ((git status --porcelain) -ne $null) {
    Write-Host "Skipping auto-update: repository has local changes"
    return
  }
  $branch = (git branch --show-current 2>$null).Trim()
  if (-not $branch) { return }
  git ls-remote --exit-code --heads origin $branch *> $null
  if ($LASTEXITCODE -ne 0) { return }
  $before = (git rev-parse HEAD).Trim()
  git fetch --quiet origin $branch
  git merge --ff-only --quiet "origin/$branch" *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Skipping auto-update: fast-forward failed"
    return
  }
  $after = (git rev-parse HEAD).Trim()
  if ($before -ne $after) {
    Write-Host "Repository updated from origin/$branch. Restarting launcher..."
    & $ScriptPath $Action
    exit $LASTEXITCODE
  }
}

function Get-PidFromFile([string]$Path) {
  if (-not (Test-Path $Path)) { return $null }
  $raw = (Get-Content $Path -Raw).Trim()
  if (-not $raw) { return $null }
  $pidValue = 0
  if ([int]::TryParse($raw, [ref]$pidValue)) { return $pidValue }
  return $null
}

function Test-PidRunning([int]$PidValue) {
  if (-not $PidValue) { return $false }
  return $null -ne (Get-Process -Id $PidValue -ErrorAction SilentlyContinue)
}

function Stop-PidFile([string]$Path, [string]$Name) {
  $pidValue = Get-PidFromFile $Path
  if ($pidValue -and (Test-PidRunning $pidValue)) {
    Write-Host "Stopping $Name ($pidValue)"
    Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -Force -ErrorAction SilentlyContinue $Path
}

function Test-PortOpen([string]$HostName, [int]$Port) {
  $client = New-Object Net.Sockets.TcpClient
  try {
    $socketHost = if ($HostName -eq "0.0.0.0") { "127.0.0.1" } else { $HostName }
    $async = $client.BeginConnect($socketHost, $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(500, $false)) { return $false }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Ensure-Frontend {
  $frontend = Join-Path $RootDir "frontend"
  if (-not (Test-Path $frontend)) { throw "frontend directory was not found" }
  if (-not (Get-CommandPath "npm")) { throw "npm is required for the Next.js frontend" }
  Push-Location $frontend
  try {
    if (-not (Test-Path "node_modules")) {
      npm install
    }
    $env:NEXT_PUBLIC_API_BASE = "/api"
    npm run build
  } finally {
    Pop-Location
  }
}

function Find-LlamaServer {
  $candidates = @()
  if ($env:LLAMA_CPP_BIN) { $candidates += $env:LLAMA_CPP_BIN }
  $cmd = Get-CommandPath "llama-server.exe"
  if ($cmd) { $candidates += $cmd }
  $cmd2 = Get-CommandPath "llama-server"
  if ($cmd2) { $candidates += $cmd2 }
  $candidates += @(
    (Join-Path $LlamaCppDir "build\bin\Release\llama-server.exe"),
    (Join-Path $LlamaCppDir "build\bin\llama-server.exe"),
    (Join-Path $LlamaCppDir "build\Release\llama-server.exe"),
    (Join-Path $LlamaCppDir "build\llama-server.exe"),
    (Join-Path $LlamaServerDir "llama-server.exe")
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return (Resolve-Path $candidate).Path }
  }
  return $null
}

function Bootstrap-LlamaCpp {
  if ($env:TTD_AUTO_BOOTSTRAP_LLAMA_CPP -ne "1") { return }
  if (Find-LlamaServer) { return }
  if (-not (Get-CommandPath "git") -or -not (Get-CommandPath "cmake")) {
    Write-Host "Cannot bootstrap llama.cpp automatically: git and cmake are required"
    return
  }
  if (-not (Test-Path $LlamaCppDir)) {
    Write-Host "Cloning llama.cpp into $LlamaCppDir"
    git clone --depth 1 --branch $env:LLAMA_CPP_REPO_REF $env:LLAMA_CPP_REPO_URL $LlamaCppDir
  } else {
    Push-Location $LlamaCppDir
    try {
      git fetch --quiet origin $env:LLAMA_CPP_REPO_REF
      git checkout --quiet $env:LLAMA_CPP_REPO_REF
      git pull --ff-only --quiet origin $env:LLAMA_CPP_REPO_REF
    } finally {
      Pop-Location
    }
  }
  Write-Host "Building llama-server with CMake"
  cmake -S $LlamaCppDir -B (Join-Path $LlamaCppDir "build") -DCMAKE_BUILD_TYPE=Release
  cmake --build (Join-Path $LlamaCppDir "build") --config Release --target llama-server
}

function Find-ModelFile {
  if ($env:LLAMA_CPP_MODEL_PATH -and (Test-Path $env:LLAMA_CPP_MODEL_PATH)) {
    return (Resolve-Path $env:LLAMA_CPP_MODEL_PATH).Path
  }
  $model = Get-ChildItem -Path $ModelsDir -Filter "*.gguf" -File -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($model) { return $model.FullName }
  return $null
}

function Start-Llama {
  if ($env:TTD_MODEL_BACKEND -notin @("llamacpp", "llama.cpp")) { return }
  if (Test-PortOpen $LlamaCppHost ([int]$LlamaCppPort)) {
    Write-Host "llama.cpp already listens at $env:TTD_LLAMA_CPP_URL"
    return
  }
  Bootstrap-LlamaCpp
  $bin = Find-LlamaServer
  if (-not $bin) {
    Write-Host "llama-server.exe not found. Install/build llama.cpp or set LLAMA_CPP_BIN."
    return
  }
  $model = Find-ModelFile
  if (-not $model) {
    Write-Host "No GGUF model found in $ModelsDir. Install one from the admin panel."
    return
  }
  $ctx = if ($env:LLAMA_CPP_CTX_SIZE) { $env:LLAMA_CPP_CTX_SIZE } else { "8192" }
  $llamaArgs = @("-m", $model, "--host", $LlamaCppHost, "--port", $LlamaCppPort, "-c", $ctx)
  if ($env:LLAMA_CPP_THREADS) { $llamaArgs += @("-t", $env:LLAMA_CPP_THREADS) }
  if ($env:LLAMA_CPP_GPU_LAYERS) { $llamaArgs += @("-ngl", $env:LLAMA_CPP_GPU_LAYERS) }
  $proc = Start-Process -FilePath $bin -ArgumentList $llamaArgs -PassThru -WindowStyle Hidden -RedirectStandardOutput $LlamaLogFile -RedirectStandardError $LlamaErrFile
  Set-Content -Path $LlamaPidFile -Value $proc.Id
  Write-Host "llama.cpp: $env:TTD_LLAMA_CPP_URL ($model)"
}

function Start-Backend([switch]$Foreground) {
  $python = Get-VenvPython
  & $python manage.py migrate --noinput
  & $python manage.py shell -c "from core.seed import ensure_defaults; ensure_defaults()"
  $bind = "${BackendHost}:${BackendPort}"
  if ($Foreground) {
    & $python manage.py runserver $bind
    return
  }
  $existingPid = Get-PidFromFile $BackendPidFile
  if ($existingPid -and (Test-PidRunning $existingPid)) {
    Write-Host "Backend already running: http://127.0.0.1:${BackendPort} ($existingPid)"
    return
  }
  $proc = Start-Process -FilePath $python -ArgumentList @("manage.py", "runserver", $bind) -PassThru -WindowStyle Hidden -RedirectStandardOutput $BackendLogFile -RedirectStandardError $BackendErrFile
  Set-Content -Path $BackendPidFile -Value $proc.Id
  Write-Host "Site:  http://127.0.0.1:${BackendPort}"
  Write-Host "Admin: http://127.0.0.1:${BackendPort}/admin-panel"
}

function Show-Status {
  $backendPid = Get-PidFromFile $BackendPidFile
  $llamaPid = Get-PidFromFile $LlamaPidFile
  $backendLabel = if ($backendPid) { $backendPid } else { "-" }
  $llamaLabel = if ($llamaPid) { $llamaPid } else { "-" }
  $backendRunning = if ($backendPid) { Test-PidRunning $backendPid } else { $false }
  $llamaRunning = if ($llamaPid) { Test-PidRunning $llamaPid } else { $false }
  Write-Host "Backend PID: $backendLabel running=$backendRunning"
  Write-Host "llama PID:   $llamaLabel running=$llamaRunning"
  Write-Host "Site:        http://127.0.0.1:${BackendPort}"
  Write-Host "llama.cpp:   $env:TTD_LLAMA_CPP_URL"
  Write-Host "Models:      $ModelsDir"
}

function Show-Doctor {
  Write-Host "Time To Deny Windows doctor"
  foreach ($tool in @("git", "cmake", "npm")) {
    $path = Get-CommandPath $tool
    $label = if ($path) { $path } else { "missing" }
    Write-Host "$tool`: $label"
  }
  $python = Get-Python
  $llamaServer = Find-LlamaServer
  $llamaLabel = if ($llamaServer) { $llamaServer } else { "missing" }
  Write-Host "python: $($python.File)"
  Write-Host "llama-server: $llamaLabel"
  Write-Host "model count: $((Get-ChildItem -Path $ModelsDir -Filter '*.gguf' -File -Recurse -ErrorAction SilentlyContinue | Measure-Object).Count)"
  Show-Status
}

function Start-App([switch]$Foreground) {
  Ensure-Dirs
  Auto-Update
  Ensure-Venv
  Ensure-Frontend
  Start-Llama
  Start-Backend -Foreground:$Foreground
}

Ensure-Dirs

switch ($Action) {
  "stop" {
    Stop-PidFile $BackendPidFile "backend"
    Stop-PidFile $LlamaPidFile "llama.cpp"
  }
  "restart" {
    Stop-PidFile $BackendPidFile "backend"
    Stop-PidFile $LlamaPidFile "llama.cpp"
    Start-App
  }
  "status" {
    Show-Status
  }
  "logs" {
    Get-Content -Path $BackendLogFile, $BackendErrFile, $LlamaLogFile, $LlamaErrFile -Tail 80 -Wait -ErrorAction SilentlyContinue
  }
  "foreground" {
    Start-App -Foreground
  }
  "doctor" {
    Show-Doctor
  }
  "repair" {
    Ensure-Venv
    Ensure-Frontend
    Bootstrap-LlamaCpp
    Show-Doctor
  }
  default {
    Start-App
  }
}
