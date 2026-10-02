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

Write-Output "Ready."
Write-Output "Command line: node .\bin\magenta.mjs --help"
Write-Output "Desktop window: bun run dev"
Write-Output "Global install: powershell -ExecutionPolicy Bypass -File .\install.ps1"
