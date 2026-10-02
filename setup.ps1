$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

foreach ($cmd in @("uv", "pnpm", "node", "cargo")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        throw "Missing $cmd. Install it, then run setup.ps1 again."
    }
}

Set-Location (Join-Path $PSScriptRoot "engine")
uv sync
Set-Location $PSScriptRoot
pnpm install

Write-Output "Ready. From this folder run: pnpm tauri dev"
Write-Output "Or the command line: .\magenta.cmd --help"
Write-Output "Then click Load model, or run .\magenta.cmd load. The first load downloads the weights if they are not cached."
