# server/scripts/make-context-pack.ps1 (v6.2)
# Gera um Context Pack completo + ZIP
# Uso (rodando dentro da pasta server/):
#   pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File scripts/make-context-pack.ps1 `
#        -Name auto -Depth 4 -Symbols -Imports -Zip

param(
  [string] $Name   = "auto",
  [int]    $Depth  = 4,
  [switch] $Symbols,
  [switch] $Imports,
  [switch] $Zip
)

# --- Caminhos
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path    # ...\server\scripts
$ServerDir = Split-Path -Parent $ScriptDir                      # ...\server
$RootDir   = Split-Path -Parent $ServerDir                      # repo raiz

$DocsDir   = Join-Path $RootDir "docs"
$CtxDir    = Join-Path $DocsDir "context"
$RelDir    = Join-Path (Join-Path $DocsDir "releases") "$(Get-Date -Format 'yyyy-MM-dd_HHmmss')-$Name"

# --- Flags p/ o gerador
$env:CTX_DEPTH   = "$Depth"
$env:CTX_SYMBOLS = $Symbols.IsPresent ? "1" : "0"
$env:CTX_IMPORTS = $Imports.IsPresent ? "1" : "0"

# --- Gerar contextos (chama o Node dentro de server/)
Write-Host "➡️  Gerando contextos (full)..." -ForegroundColor Cyan
Push-Location $ServerDir
try {
  node "scripts/gen-context.js"
} finally {
  Pop-Location
}

# --- Criar pasta de release
New-Item -ItemType Directory -Force -Path $RelDir | Out-Null

# --- Copiar artefatos principais do context
$filesWanted = @(
  # básicos
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
  "openapi.json",
  # opcionais (se existirem)
  "symbol-index.json",
  "deps.txt",
  "ctx.yml",
  # banco (v6.2 - turbinado)
  "db-counts.txt",
  "db-schema.sql",
  "db-tables.json",
  "db-indexes.json",
  "db-fks.json",
  "db-enums.json",
  "db-views.sql",
  "db-triggers.sql",
  "db-functions.sql",
  "db-sequences.json",
  "db-extensions.txt",
  "db-sizes.txt"
)

$filesToCopy = @()
foreach ($f in $filesWanted) {
  $p = Join-Path $CtxDir $f
  if (Test-Path $p) { $filesToCopy += $p }
}
foreach ($f in $filesToCopy) {
  Copy-Item $f $RelDir -Force
}

# --- Incluir metadados úteis do repo
$extra = @(".gitattributes", ".gitignore", "package.json") `
  | ForEach-Object { Join-Path $RootDir $_ } `
  | Where-Object { Test-Path $_ }
foreach ($f in $extra) { Copy-Item $f $RelDir -Force }

# --- README curtinho dentro do release
$readme = @"
AFK Miners — Release $Name
Gerado em: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Commit: $(git -C $RootDir rev-parse --short HEAD)

Arquivos chave:
- API.md, openapi.json → visão dos endpoints
- env-usage.json → variáveis de ambiente usadas
- *db-*.{json,sql,txt} → snapshot do Postgres (schema, counts, indexes, fks, views, triggers, functions, enums, sequences, extensions, sizes)
"@
$readme | Set-Content -Encoding UTF8 -Path (Join-Path $RelDir "_README.txt")

# --- Compactar se pedido
if ($Zip) {
  $zipPath = "$RelDir.zip"
  if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
  Write-Host "🧩 Compactando ZIP..." -ForegroundColor Cyan
  Compress-Archive -Path (Join-Path $RelDir "*") -DestinationPath $zipPath
  Write-Host "ZIP: $zipPath"
}

# --- Info final
$describe = (git -C $RootDir describe --tags --abbrev=7 --always) 2>$null
if (-not $describe) { $describe = (git -C $RootDir rev-parse --short HEAD) }

Write-Host "OK: pacote gerado em $RelDir" -ForegroundColor Green
Write-Host "Commit: $describe"
