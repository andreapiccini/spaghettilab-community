$ErrorActionPreference = 'Stop'
$hubRoot = $PSScriptRoot
$healthUrl = 'http://127.0.0.1:8790/health'
try {
    $health = Invoke-RestMethod $healthUrl -TimeoutSec 2
    Write-Host 'Community Hub già attivo: http://127.0.0.1:8790/admin'
    exit 0
} catch {}
New-Item -ItemType Directory -Path (Join-Path $hubRoot 'data') -Force | Out-Null
$nodePath = (Get-Command node -ErrorAction Stop).Source
Start-Process -FilePath $nodePath -ArgumentList 'src/server.mjs' -WorkingDirectory $hubRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $hubRoot 'data/server.log') -RedirectStandardError (Join-Path $hubRoot 'data/server-error.log') | Out-Null
Write-Host 'Community Hub avviato: http://127.0.0.1:8790/admin'
