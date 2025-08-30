# server/scripts/print-context-full.ps1
# Mostra TODO o docs/context/context-pack.txt com UTF-8 no console
# Requisitos: PowerShell 7+ (pwsh)

# Descobre caminhos
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root      = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$Pack      = Join-Path $Root 'docs\context\context-pack.txt'

# Força codepage do console (fallback para hosts antigos)
$chcp = Join-Path $env:SystemRoot 'System32\chcp.com'
if (Test-Path $chcp) { & $chcp 65001 > $null }

# Garante UTF-8 na saída
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding  = [System.Text.UTF8Encoding]::new($false)

# Imprime tudo
Get-Content -Path $Pack
