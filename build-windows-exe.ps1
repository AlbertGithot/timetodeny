$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LauncherDir = Join-Path $RootDir "launcher\windows"
$ProjectFile = Join-Path $LauncherDir "TimeToDeny.Launcher.csproj"
$LogoPng = Join-Path $RootDir "frontend\public\assets\images\app_logo.png"
$IconFile = Join-Path $LauncherDir "app_logo.ico"
$DistDir = Join-Path $RootDir "dist"
$Runtime = if ($env:TTD_EXE_RUNTIME) { $env:TTD_EXE_RUNTIME } else { "win-x64" }

Add-Type -AssemblyName System.Drawing

function Write-UInt16 {
  param([System.IO.BinaryWriter]$Writer, [int]$Value)
  $Writer.Write([uint16]$Value)
}

function Write-UInt32 {
  param([System.IO.BinaryWriter]$Writer, [long]$Value)
  $Writer.Write([uint32]$Value)
}

function New-IconPngBytes {
  param(
    [System.Drawing.Image]$Image,
    [int]$Size
  )

  $bitmap = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $scale = [Math]::Min($Size / $Image.Width, $Size / $Image.Height)
    $width = [int][Math]::Round($Image.Width * $scale)
    $height = [int][Math]::Round($Image.Height * $scale)
    $x = [int][Math]::Floor(($Size - $width) / 2)
    $y = [int][Math]::Floor(($Size - $height) / 2)
    $graphics.DrawImage($Image, $x, $y, $width, $height)

    $stream = New-Object System.IO.MemoryStream
    try {
      $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
      [byte[]]$bytes = $stream.ToArray()
      Write-Output -NoEnumerate $bytes
      return
    } finally {
      $stream.Dispose()
    }
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function Convert-PngToIco {
  param(
    [string]$PngPath,
    [string]$IcoPath
  )

  if (-not (Test-Path $PngPath)) {
    throw "Icon source was not found: $PngPath"
  }

  $sizes = @(16, 24, 32, 48, 64, 128, 256)
  $image = [System.Drawing.Image]::FromFile($PngPath)
  try {
    $entries = @()
    foreach ($size in $sizes) {
      $entries += [pscustomobject]@{
        Size = $size
        Bytes = New-IconPngBytes -Image $image -Size $size
      }
    }
  } finally {
    $image.Dispose()
  }

  $directory = Split-Path -Parent $IcoPath
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  $file = [System.IO.File]::Open($IcoPath, [System.IO.FileMode]::Create)
  $writer = New-Object System.IO.BinaryWriter $file
  try {
    Write-UInt16 $writer 0
    Write-UInt16 $writer 1
    Write-UInt16 $writer $entries.Count

    $offset = 6 + (16 * $entries.Count)
    foreach ($entry in $entries) {
      $sizeByte = if ($entry.Size -eq 256) { 0 } else { $entry.Size }
      $writer.Write([byte]$sizeByte)
      $writer.Write([byte]$sizeByte)
      $writer.Write([byte]0)
      $writer.Write([byte]0)
      Write-UInt16 $writer 1
      Write-UInt16 $writer 32
      Write-UInt32 $writer $entry.Bytes.Length
      Write-UInt32 $writer $offset
      $offset += $entry.Bytes.Length
    }

    foreach ($entry in $entries) {
      $writer.Write([byte[]]$entry.Bytes)
    }
  } finally {
    $writer.Dispose()
    $file.Dispose()
  }
}

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
  throw "dotnet SDK is required. Install it with: winget install Microsoft.DotNet.SDK.8"
}

if (-not (Test-Path $ProjectFile)) {
  throw "Launcher project was not found: $ProjectFile"
}

Convert-PngToIco -PngPath $LogoPng -IcoPath $IconFile

New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
dotnet publish $ProjectFile `
  -c Release `
  -r $Runtime `
  --self-contained true `
  -p:PublishSingleFile=true `
  -p:IncludeNativeLibrariesForSelfExtract=true `
  -p:EnableCompressionInSingleFile=true `
  -o $DistDir

$ExePath = Join-Path $DistDir "TimeToDeny.exe"
if (-not (Test-Path $ExePath)) {
  throw "Build finished but exe was not created: $ExePath"
}

Write-Host "Built launcher: $ExePath"
