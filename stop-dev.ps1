$portsToStop = @(8000, 5500)
$stoppedPids = @()

foreach ($port in $portsToStop) {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue

    foreach ($connection in $connections) {
        $pid = $connection.OwningProcess
        if ($pid -and $pid -ne 0 -and $pid -ne 4) {
            if ($stoppedPids -notcontains $pid) {
                try {
                    Stop-Process -Id $pid -Force -ErrorAction Stop
                    $stoppedPids += $pid
                    Write-Host "Processo $pid encerrado (porta $port)."
                }
                catch {
                    Write-Warning "Nao foi possivel encerrar o processo $pid na porta $port."
                }
            }
        }
    }
}

# Fecha janelas de PowerShell abertas pelo start-dev.ps1 para uvicorn/http.server.
$devShells = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
    Where-Object {
        $_.CommandLine -and (
            $_.CommandLine -match "uvicorn\s+main:app" -or
            $_.CommandLine -match "http\.server\s+5500"
        )
    }

foreach ($shell in $devShells) {
    try {
        Stop-Process -Id $shell.ProcessId -Force -ErrorAction Stop
        Write-Host "Janela PowerShell $($shell.ProcessId) encerrada."
    }
    catch {
        Write-Warning "Nao foi possivel encerrar a janela PowerShell $($shell.ProcessId)."
    }
}

if ($stoppedPids.Count -eq 0 -and $devShells.Count -eq 0) {
    Write-Host "Nenhum servico de desenvolvimento em execucao foi encontrado."
}
else {
    Write-Host "Parada concluida."
}
