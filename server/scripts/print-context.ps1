param([int]$Lines = 160)

# Caminhos
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root      = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$Pack      = Join-Path $Root 'docs\context\context-pack.txt'

# 1) Força codepage da console pra UTF-8 (usa chcp.com direto)
$chcp = Join-Path $env:SystemRoot 'System32\chcp.com'
if (Test-Path $chcp) {
  & $chcp 65001 > $null
}

# 2) Garante encoding de saída UTF-8 no host PowerShell
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding  = [System.Text.UTF8Encoding]::new($false)

# 3) Lê e imprime (preview configurável)
if ($Lines -gt 0) {
  Get-Content -Path $Pack -TotalCount $Lines
} else {
  Get-Content -Path $Pack
}
