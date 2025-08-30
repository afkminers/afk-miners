# server/scripts/print-context-full.ps1 (v7 — PG-friendly & utilitários)
# Mostra o docs/context/context-pack.txt no console com UTF-8 e opções úteis
# Requisitos: PowerShell 7+ (pwsh)

[CmdletBinding()]
param(
  [switch] $Less,         # pagina a saída (Out-Host -Paging)
  [int]    $Head,         # primeiras N linhas
  [int]    $Tail,         # últimas N linhas
  [string] $Grep,         # filtra por regex (case-insensitive)
  [string] $Section,      # imprime apenas a seção cujo título contenha esse texto (ex.: "Rotas", "YAML", "JSON", "Migrations")
  [switch] $PgSummary,    # mostra um resumo rápido dos artefatos PG (db-stats.json, db-counts.txt, etc.)
  [switch] $Open,         # abre o arquivo no app padrão do SO
  [switch] $NoColor,      # sem cores
  [switch] $Raw           # imprime sem coloração ou banners auxiliares (útil para pipes)
)

# -----------------------------
# Helpers
# -----------------------------
function _color([string]$text, [ConsoleColor]$fg = [ConsoleColor]::Cyan) {
  if ($NoColor -or $Raw) { Write-Host $text; return }
  $old = $Host.UI.RawUI.ForegroundColor
  $Host.UI.RawUI.ForegroundColor = $fg
  Write-Host $text
  $Host.UI.RawUI.ForegroundColor = $old
}
function _warn([string]$text) {
  if ($NoColor -or $Raw) { Write-Host $text; return }
  $old = $Host.UI.RawUI.ForegroundColor
  $Host.UI.RawUI.ForegroundColor = 'Yellow'
  Write-Host $text
  $Host.UI.RawUI.ForegroundColor = $old
}
function _err([string]$text) {
  if ($NoColor -or $Raw) { Write-Host $text; return }
  $old = $Host.UI.RawUI.ForegroundColor
  $Host.UI.RawUI.ForegroundColor = 'Red'
  Write-Host $text
  $Host.UI.RawUI.ForegroundColor = $old
}
function _hr() {
  if (-not $Raw) { _color ('-' * 70) 'DarkGray' }
}

function _readJson($p) {
  try {
    if (Test-Path $p) { return Get-Content -Raw -LiteralPath $p | ConvertFrom-Json }
  } catch { }
  return $null
}

function _safeLines($path) {
  try { return Get-Content -LiteralPath $path -ErrorAction Stop }
  catch { return @() }
}

function _showPgSummary($CtxDir) {
  $dbStatsPath  = Join-Path $CtxDir 'db-stats.json'
  $dbCountsPath = Join-Path $CtxDir 'db-counts.txt'
  $dbIdxPath    = Join-Path $CtxDir 'db-indexes.json'
  $dbViewsPath  = Join-Path $CtxDir 'db-views.json'
  $dbEnumsPath  = Join-Path $CtxDir 'db-enums.json'
  $dbExtPath    = Join-Path $CtxDir 'db-extensions.json'
  $dbSchemaPath = Join-Path $CtxDir 'db-schema.sql'
  $dbTablesPath = Join-Path $CtxDir 'db-tables.json'

  $any = $false
  _hr; _color "Resumo PG (se disponível):" 'Green'

    if (Test-Path $dbSchemaPath) {
        $lineCount = (Get-Content -LiteralPath $dbSchemaPath | Measure-Object -Line).Lines
        _color ("• db-schema.sql → {0} linha(s)" -f $lineCount) 'DarkCyan'
        $any = $true
    }

  $tables = _readJson $dbTablesPath
  if ($tables) {
    $tblCount = ($tables.tables | Measure-Object).Count
    _color ("• db-tables.json: {0} tabela(s)" -f $tblCount) 'DarkCyan'
    $any = $true
  }
  $stats = _readJson $dbStatsPath
  if ($stats) {
    $top = $stats | Sort-Object -Property size_total_bytes -Descending | Select-Object -First 5
    _color "• db-stats.json (top 5 por tamanho):" 'DarkCyan'
    foreach ($t in $top) {
      $sz = '{0:N2} MB' -f [double]$t.size_total_mb
      Write-Host ("   - {0,-24} {1,10}  ~{2} linhas" -f $t.table_name, $sz, $t.rows_estimate)
    }
    $any = $true
  }
  if (Test-Path $dbCountsPath) {
    $first = Get-Content -LiteralPath $dbCountsPath | Select-Object -Skip 1 -First 5
    _color "• db-counts.txt (amostra):" 'DarkCyan'
    foreach ($line in $first) { Write-Host ("   - {0}" -f $line) }
    $any = $true
  }
  $idx  = _readJson $dbIdxPath
  if ($idx)  { _color ("• db-indexes.json: {0} índice(s)" -f ($idx|Measure-Object).Count) 'DarkCyan'; $any=$true }
  $views= _readJson $dbViewsPath
  if ($views){ _color ("• db-views.json: {0} view(s)"   -f ($views|Measure-Object).Count) 'DarkCyan'; $any=$true }
  $enums= _readJson $dbEnumsPath
  if ($enums){ _color ("• db-enums.json: {0} enum(s)"   -f ($enums|Measure-Object).Count) 'DarkCyan'; $any=$true }
  $ext  = _readJson $dbExtPath
  if ($ext)  { _color ("• db-extensions.json: {0} extensão(ões)" -f ($ext|Measure-Object).Count) 'DarkCyan'; $any=$true }

  if (-not $any) { _warn "Nenhum artefato PG encontrado em docs/context/. Gere com: npm run ctx:pack (com DATABASE_URL setado)." }
  _hr
}

function _printSection($lines, [string]$needle) {
  # Seções começam com linhas como: "== Nome da Seção =="
  $regexHeader = '^\s*==\s*(.+?)\s*==\s*$'
  $targets = @()
  for ($i=0; $i -lt $lines.Count; $i++) {
    $m = [regex]::Match($lines[$i], $regexHeader)
    if ($m.Success) { $targets += [pscustomobject]@{ Name=$m.Groups[1].Value; Index=$i } }
  }
  if (-not $targets.Count) { _warn "Nenhum cabeçalho de seção encontrado."; return }

  $match = $targets | Where-Object { $_.Name -match [regex]::Escape($needle) } | Select-Object -First 1
  if (-not $match) {
    _warn "Seção não encontrada: $needle"
    _color "Seções disponíveis:" 'DarkGray'
    foreach ($t in $targets) { Write-Host " - $($t.Name)" }
    return
  }

  $start = $match.Index
  $next  = ($targets | Where-Object { $_.Index -gt $start } | Select-Object -First 1)
  $end   = $next ? ($next.Index - 1) : ($lines.Count - 1)

  if (-not $Raw) { _hr; _color ("[Seção] {0}" -f $match.Name) 'Green'; _hr }
  $slice = $lines[$start..$end]
  if ($Grep) {
    $slice = $slice | Where-Object { $_ -match $Grep }
  }
  if ($Less) { $slice | Out-Host -Paging } else { $slice | ForEach-Object { Write-Host $_ } }
}

# -----------------------------
# Caminhos
# -----------------------------
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root      = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$CtxDir    = Join-Path $Root 'docs\context'
$Pack      = Join-Path $CtxDir 'context-pack.txt'

# -----------------------------
# UTF-8 no console (Windows)
# -----------------------------
$chcp = Join-Path $env:SystemRoot 'System32\chcp.com'
if (Test-Path $chcp) { & $chcp 65001 > $null }
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding  = [System.Text.UTF8Encoding]::new($false)

# -----------------------------
# Sanidade
# -----------------------------
if (-not (Test-Path $Pack)) {
  _err "Arquivo não encontrado: $Pack"
  _warn "Dica: gere o pacote primeiro:"
  Write-Host "  cd server"
  Write-Host "  npm run ctx:pack"
  exit 1
}
if ($Open) {
  Invoke-Item -LiteralPath $Pack
  if (-not $Raw) { _color "Abrindo: $Pack" 'DarkGray' }
  return
}

# -----------------------------
# Cabeçalho
# -----------------------------
if (-not $Raw) {
  _hr
  _color "AFK Miners — Print Context (v7)" 'Green'
  _color "Arquivo: $Pack" 'DarkGray'
  if ($Grep)    { _color "Filtro: /$Grep/i" 'DarkGray' }
  if ($Section) { _color "Seção: $Section" 'DarkGray' }
  if ($Head)    { _color "Head: $Head" 'DarkGray' }
  if ($Tail)    { _color "Tail: $Tail" 'DarkGray' }
  if ($Less)    { _color "Paging: ON" 'DarkGray' }
  _hr
}

# -----------------------------
# Carregar linhas
# -----------------------------
$lines = _safeLines $Pack

# Se pedirem seção específica
if ($Section) {
  _printSection -lines $lines -needle $Section
} else {
  # Aplicar grep se houver
  if ($Grep) { $lines = $lines | Where-Object { $_ -match $Grep } }

  # Head/Tail
  if ($Head -gt 0 -and $Tail -gt 0) {
    _warn "Head e Tail juntos — aplicando apenas Head."
    $Tail = 0
  }
  if ($Head -gt 0) { $lines = $lines | Select-Object -First $Head }
  elseif ($Tail -gt 0) { $lines = $lines | Select-Object -Last $Tail }

  # Imprimir
  if ($Less) { $lines | Out-Host -Paging } else { $lines | ForEach-Object { Write-Host $_ } }
}

# -----------------------------
# Bônus PG (opcional)
# -----------------------------
if ($PgSummary) {
  _showPgSummary -CtxDir $CtxDir
}

# Fim
