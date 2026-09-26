# Start the orchestrator (port 8000) and the console (port 3000) for a demo.
#
#   powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
#
# Needs: .env filled in (see .env.example), data\target_outputs.json, terraform
# on PATH (or in the winget location below), the Python deps from
# requirements.txt, and `pnpm install` done once in migration-accelerator-console.
# Set $env:PYTHON to your interpreter if `python` isn't the one with the deps.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$py = if ($env:PYTHON) { $env:PYTHON } else { "python" }

if (-not (Get-Command terraform -ErrorAction SilentlyContinue)) {
    $winget = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
    $tf = Get-ChildItem $winget -Recurse -Filter terraform.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($tf) { $env:PATH = "$($tf.DirectoryName);$env:PATH"; Write-Host "terraform: $($tf.FullName)" }
    else { Write-Warning "terraform not found: blueprint apply will fail until it's on PATH" }
}

Write-Host "Orchestrator -> http://localhost:8000  (API docs at /docs)"
$orch = Start-Process -PassThru -NoNewWindow $py -ArgumentList "-m", "uvicorn", "orchestrator.main:app", "--port", "8000"

Write-Host "Console      -> http://localhost:3000  (landing page at /journey, demo dock with ?demo=1)"
Push-Location migration-accelerator-console
try {
    npx --yes pnpm@12.3.4 dev
} finally {
    Pop-Location
    Stop-Process -Id $orch.Id -ErrorAction SilentlyContinue
}
