param(
    [string]$Source = "",
    [string]$Prefix = (Join-Path $env:LOCALAPPDATA "magenta-windows"),
    [switch]$NoPath
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Missing git."
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw "Missing uv. Install it from https://docs.astral.sh/uv/ and run install.ps1 again."
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Missing node. Install Node.js 20 or newer and run install.ps1 again."
}

$app = if ($Source) { (Resolve-Path $Source).Path } else { Join-Path $Prefix "app" }
if (-not $Source) {
    if (Test-Path (Join-Path $app ".git")) {
        git -C $app pull --ff-only
    } else {
        git clone https://github.com/stepupgaming/magenta-windows.git $app
    }
}

Set-Location (Join-Path $app "engine")
uv sync
Set-Location $app

$python = Join-Path $app "engine\.venv\Scripts\python.exe"
& $python (Join-Path $app "scripts\release_weights.py") ensure
if ($LASTEXITCODE -ne 0) {
    throw "Weight setup failed."
}

$bin = Join-Path $Prefix "bin"
New-Item -ItemType Directory -Force -Path $bin | Out-Null
$launcher = Join-Path $bin "magenta.cmd"
@(
    "@echo off",
    "node `"$app\bin\magenta.mjs`" %*"
) | Set-Content -Path $launcher -Encoding ascii

if (-not $NoPath) {
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not $userPath) {
        $userPath = ""
    }
    $parts = $userPath.Split(";") | Where-Object { $_ -and ($_.TrimEnd("\") -ne $bin.TrimEnd("\")) }
    $next = (@($parts) + $bin) -join ";"
    [Environment]::SetEnvironmentVariable("Path", $next, "User")
    $env:Path = "$env:Path;$bin"
}

Write-Output "Installed: $launcher"
Write-Output "Open a new terminal and run: magenta --help"
Write-Output "Desktop window from the checkout: bun run dev"
