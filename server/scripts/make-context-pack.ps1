# server/scripts/make-context-pack.ps1 (v7 — PG-only, fix ternário + fix $args)
# Gera um Context Pack completo + ZIP, focado em Postgres (Neon/Supabase/etc.).
# Remove todo legado de SQLite. Inclui artefatos ricos de PG (db-indexes, db-views, db-enums, db-extensions, db-stats, db-counts).
#
# Uso:
#   pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File scripts/make-context-pack.ps1 `
#        -Name lobby-alpha -Depth 4 -Symbols -Imports -Zip [-PgDump]
#
# Requisitos:
#   - Node instalado; projeto com dependências ok
#   - DATABASE_URL no ambiente p/ gerar artefatos de DB
#   - (Opcional) pg_dump/psql no PATH se usar -PgDump (dump completo .sql)
#
# Saída:
#   docs/releases/<timestamp>-<Name>/ com todos os artefatos
#   (e <...>.zip se -Zip)

[CmdletBinding()]
param(
  [string] $Name   = "auto",
  [int]    $Depth  = 4,
  [switch] $Symbols,
  [switch] $Imports,
  [switch] $Zip,
  [switch] $PgDump
)

# -----------------------------
# Helpers
# -----------------------------
function _git([string[]]$gitArgs) {
  try { (git @gitArgs) 2>$null } catch { "" }
}
function _section($title) {
  Write-Host ""
  Write-Host ("=== {0} ===" -f $title) -ForegroundColor Cyan
}
function _ensureDir($p) {
  if (-not (Test-Path $p)) { New-Item -ItemType Directory -Force -Path $p | Out-Null }
}

# -----------------------------
# Caminhos base
# -----------------------------
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path      # ...\server\scripts
$ServerDir = Split-Path -Parent $ScriptDir                        # ...\server
$RootDir   = Split-Path -Parent $ServerDir                        # repo raiz
Set-Location $ServerDir

$DocsDir = Join-Path $RootDir "docs"
$CtxDir  = Join-Path $DocsDir "context"
_ensureDir $DocsDir
_ensureDir $CtxDir

# -----------------------------
# Timestamp + diretório release
# -----------------------------
$ts        = Get-Date -Format "yyyy-MM-dd_HHmmss"
$RelName   = "${ts}-${Name}"
$OutRoot   = Join-Path $DocsDir "releases"
$ReleaseDir= Join-Path $OutRoot $RelName
_ensureDir $OutRoot
_ensureDir $ReleaseDir

# -----------------------------
# Metadados GIT
# -----------------------------
$hash     = _git @("-C",$RootDir,"rev-parse","--short","HEAD"); if (-not $hash) { $hash = "nohash" }
$branch   = _git @("-C",$RootDir,"rev-parse","--abbrev-ref","HEAD"); if (-not $branch) { $branch = "unknown" }
$describe = _git @("-C",$RootDir,"describe","--tags","--abbrev=7","--always"); if (-not $describe) { $describe = $hash }
$lastTag  = _git @("-C",$RootDir,"describe","--tags","--abbrev=0")
$lastTagStr = if ([string]::IsNullOrWhiteSpace($lastTag)) { "n/a" } else { $lastTag }

# -----------------------------
# Geração do Context (PG aware)
# -----------------------------
_section "Gerando Context Pack (Node)"
$env:CTX_DEPTH   = "$Depth"
$env:CTX_SYMBOLS = ($Symbols.IsPresent ? "1" : "0")
$env:CTX_IMPORTS = ($Imports.IsPresent ? "1" : "0")

if (-not $env:DATABASE_URL) {
  Write-Host "⚠️  DATABASE_URL não está definido. Artefatos de DB serão omitidos." -ForegroundColor Yellow
}

# Executa generator (v7) — produz db-* quando DATABASE_URL estiver setado
node "scripts\gen-context.js" | Out-Null

# -----------------------------
# Verificação (se arquivo existir)
# -----------------------------
$verifyMjs = Join-Path $ScriptDir "verify-context.mjs"
if (Test-Path $verifyMjs) {
  _section "Verificando artefatos (verify-context.mjs)"
  node $verifyMjs
  if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Verificação falhou. Interrompendo." -ForegroundColor Red
    exit 1
  }
} else {
  Write-Host "ℹ️  verify-context.mjs não encontrado — prosseguindo sem verificação" -ForegroundColor DarkYellow
}

# -----------------------------
# Copiar artefatos p/ Release
# -----------------------------
_section "Copiando artefatos para o release"
$filesCore = @(
  "context-pack.txt",
  "API.md",
  "data-summary.json",
  "changes-since.txt",
  "endpoints-contracts.json",
  "env-usage.json",
  "error-map.json",
  "function-signatures.json",
  "responses-sample.json",
  "deps-graph.json",
  "route-history.json",
  "todos.json",
  "openapi.json"
)
$filesOptional = @(
  "symbol-index.json",   # se CTX_SYMBOLS=1
  "deps.txt"             # se CTX_IMPORTS=1
)
$filesPg = @(
  "db-tables.json",
  "db-schema.sql",
  "db-indexes.json",
  "db-views.json",
  "db-enums.json",
  "db-extensions.json",
  "db-stats.json",
  "db-counts.txt"
)

$toCopy = @()
foreach ($f in $filesCore)     { $p = Join-Path $CtxDir $f; if (Test-Path $p) { $toCopy += $p } else { Write-Host "⚠️  Ausente: $f" -ForegroundColor Yellow } }
foreach ($f in $filesOptional) { $p = Join-Path $CtxDir $f; if (Test-Path $p) { $toCopy += $p } }
foreach ($f in $filesPg)       { $p = Join-Path $CtxDir $f; if (Test-Path $p) { $toCopy += $p } else { if ($env:DATABASE_URL) { Write-Host "⚠️  Artefato PG ausente: $f" -ForegroundColor Yellow } } }

foreach ($src in $toCopy) { Copy-Item $src $ReleaseDir -Force }

# -----------------------------
# Dump completo via pg_dump (opcional)
# -----------------------------
if ($PgDump) {
  _section "pg_dump opcional"
  $pgDump = Get-Command "pg_dump" -ErrorAction SilentlyContinue
  if ($pgDump -and $env:DATABASE_URL) {
    $dumpPath = Join-Path $ReleaseDir "db-dump.sql"
    Write-Host "Executando pg_dump → $dumpPath"
    & $pgDump.Source " --no-owner --no-privileges --format=plain --file `"$dumpPath`" `"$env:DATABASE_URL`"" | Out-Null
    if (Test-Path $dumpPath) {
      Write-Host "OK: db-dump.sql" -ForegroundColor Green
    } else {
      Write-Host "⚠️  pg_dump não gerou arquivo (verifique credenciais/SSL)." -ForegroundColor Yellow
    }
  } else {
    if (-not $pgDump) { Write-Host "⚠️  pg_dump não encontrado no PATH." -ForegroundColor Yellow }
    if (-not $env:DATABASE_URL) { Write-Host "⚠️  DATABASE_URL ausente." -ForegroundColor Yellow }
  }
}

# -----------------------------
# Extras úteis do repo
# -----------------------------
_section "Incluindo metadados do repo"
$extras = @(".gitattributes", ".gitignore", "package.json", "package-lock.json") `
  | ForEach-Object { Join-Path $RootDir $_ } `
  | Where-Object { Test-Path $_ }
foreach ($f in $extras) { Copy-Item $f $ReleaseDir -Force }

# -----------------------------
# README do pacote
# -----------------------------
$Readme = @()
$Readme += "AFK Miners — Release Context Pack (PG-only)"
$Readme += "-------------------------------------------"
$Readme += "Pasta: docs/releases/$RelName"
$Readme += ""
$Readme += "Git:"
$Readme += "  - Commit : $hash"
$Readme += "  - Branch : $branch"
$Readme += "  - Describe: $describe"
$Readme += "  - LastTag: $lastTagStr"
$Readme += ""
$Readme += "Como usar em conversa nova:"
$Readme += "  1) Informe o commit curto e (se houver) a tag."
$Readme += "  2) Cole as 10–30 primeiras linhas de context-pack.txt ou anexe o arquivo."
$Readme += "  3) Se dados mudaram, cite data-summary.json."
$Readme += ""
$Readme += "Principais arquivos:"
$Readme += "  - API.md / context-pack.txt / endpoints-contracts.json / responses-sample.json"
$Readme += "  - error-map.json / env-usage.json / function-signatures.json"
$Readme += "  - deps-graph.json / route-history.json / todos.json / openapi.json"
$Readme += "  - symbol-index.json (se CTX_SYMBOLS=1) / deps.txt (se CTX_IMPORTS=1)"
$Readme += "  - db-schema.sql / db-tables.json / db-indexes.json / db-views.json / db-enums.json / db-extensions.json"
$Readme += "  - db-stats.json (tamanhos/linhas estimadas) / db-counts.txt (contagem exata por tabela)"
$Readme += "  - db-dump.sql (se -PgDump)"
$Readme += ""
$Readme += "Gerado por: server/scripts/make-context-pack.ps1 (v7 — PG-only)"
$ReadmePath = Join-Path $ReleaseDir "README.txt"
$Readme | Out-File -Encoding utf8 $ReadmePath

# -----------------------------
# Zip opcional
# -----------------------------
if ($Zip) {
  _section "Compactando ZIP"
  $zipPath = "$ReleaseDir.zip"
  if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
  Compress-Archive -Path (Join-Path $ReleaseDir "*") -DestinationPath $zipPath
  Write-Host "ZIP: $zipPath"
}

# -----------------------------
# Info final
# -----------------------------
Write-Host ""
Write-Host "✅ OK: pacote gerado em $ReleaseDir" -ForegroundColor Green
Write-Host "Commit: $describe"
if ($env:DATABASE_URL) {
  Write-Host "DB:    Artefatos PG gerados (verifique db-*.json, db-schema.sql, db-counts.txt)" -ForegroundColor Green
} else {
  Write-Host "DB:    DATABASE_URL ausente — artefatos de banco podem não ter sido criados." -ForegroundColor Yellow
}
