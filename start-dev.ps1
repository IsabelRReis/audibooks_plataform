$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonExe = Join-Path $projectRoot ".venv\Scripts\python.exe"
$backendDir = Join-Path $projectRoot "backend\text-to-speak"
$frontendDir = Join-Path $projectRoot "frontend"

if (-not (Test-Path $pythonExe)) {
    Write-Error "Python do .venv nao encontrado em: $pythonExe"
    exit 1
}

if (-not (Test-Path $backendDir)) {
    Write-Error "Pasta do backend nao encontrada em: $backendDir"
    exit 1
}

if (-not (Test-Path $frontendDir)) {
    Write-Error "Pasta do frontend nao encontrada em: $frontendDir"
    exit 1
}

$backendCmd = "cd `"$backendDir`"; & `"$pythonExe`" -m uvicorn main:app --reload --host 127.0.0.1 --port 8000"
$frontendCmd = "cd `"$frontendDir`"; & `"$pythonExe`" -m http.server 5500"

Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd
Start-Sleep -Milliseconds 400
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd

Write-Host "Backend:  http://127.0.0.1:8000"
Write-Host "Frontend: http://127.0.0.1:5500/login.html"
