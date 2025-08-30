# server/scripts/make-context-pack.ps1 (v6.1)
# Gera um Context Pack completo + ZIP (agora orientado a Postgres)
# Uso:
#   pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File scripts/make-context-pack.ps1 `
#        -Name auto -Depth 4 -Symbols -Imports -Zip

param(
  [string] $Name   = "auto",
  [int]    $Depth  = 4,
  [switch] $Symbols,
  [switch] $Imports,
  [switch] $Zip
)

# --- Preparação de caminhos
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path      # ...\server\scripts
$ServerDir = Split-Path -Parent $ScriptDir                        # ...\server
$RootDir   = Split-Path -Parent $ServerDir                        # repo raiz
Set-Location $ServerDir

# --- Timestamp + release dir
$ts = Get-Date -Format "yyyy-MM-dd_HHmmss"
$RelName    = "${ts}-${Name}"
$OutRoot    = Join-Path $RootDir "docs\releases"
$ReleaseDir = Join-Path $OutRoot $RelName
New-Item -ItemType Directory -Force -Path $ReleaseDir | Out-Null

# --- Gerar contextos (full) -> escreve em docs/context/* na RAIZ
Write-Host "➡️  Gerando contextos (full)..." -ForegroundColor Cyan
$env:CTX_DEPTH   = $Depth
$env:CTX_SYMBOLS = ($Symbols.IsPresent ? "1" : "0")
$env:CTX_IMPORTS = ($Imports.IsPresent ? "1" : "0")
node "scripts\gen-context.js" --full | Out-Null

# --- Copiar principais artefatos para o release
$CtxDir = Join-Path $RootDir "docs\context"
$filesToCopy = @(
  "context-pack.txt",
  "API.md",
  "data-summary.json",
  "symbol-index.json",
  "deps.txt",
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
  # Postgres snapshot
  "db-tables.json",
  "db-schema.sql",
  "db-counts.txt"
) | ForEach-Object { Join-Path $CtxDir $_ } | Where-Object { Test-Path $_ }
foreach ($f in $filesToCopy) { Copy-Item $f $ReleaseDir -Force }

# --- Incluir metadados úteis do repo
$extra = @(".gitattributes", ".gitignore", "package.json") `
  | ForEach-Object { Join-Path $RootDir $_ } `
  | Where-Object { Test-Path $_ }
foreach ($f in $extra) { Copy-Item $f $ReleaseDir -Force }

# --- README com instruções
$Readme = @()
$Readme += "AFK Miners — Release Context Pack"
$Readme += "--------------------------------"
$Readme += "Pasta: docs/releases/$RelName"
$Readme += ""
$Readme += "Como usar em uma conversa nova:"
$Readme += "1) Informe: Commit curto (git rev-parse --short HEAD) e Tag (se houver)."
$Readme += "2) Cole as 10–30 primeiras linhas de context-pack.txt (ou anexe o arquivo)."
$Readme += "3) Se mudar data/, cite data-summary.json."
$Readme += ""
$Readme += "Arquivos principais neste pacote:"
$Readme += " - API.md                   → documentação legível (payloads, erros, env, respostas)"
$Readme += " - context-pack.txt         → estrutura, rotas, inventário, maiores arquivos, HTML/YAML/JSON"
$Readme += " - endpoints-contracts.json → rotas com exemplos de params/query/body"
$Readme += " - responses-sample.json    → exemplos de sucesso por rota"
$Readme += " - error-map.json           → mapa de status/mensagens por rota"
$Readme += " - env-usage.json           → todas as process.env + defaults detectados"
$Readme += " - function-signatures.json → assinaturas (nome/params/arquivo/linha)"
$Readme += " - deps-graph.json          → grafo de imports (JSON)"
$Readme += " - route-history.json       → rotas alteradas desde a última tag"
$Readme += " - openapi.json             → OpenAPI inferido (Postman/Insomnia)"
$Readme += " - db-schema.sql            → **Postgres**: DDL gerado por introspecção"
$Readme += " - db-tables.json           → **Postgres**: colunas/constraints por tabela"
$Readme += " - db-counts.txt            → **Postgres**: contagem de linhas por tabela"
$Readme | Out-File -FilePath (Join-Path $ReleaseDir "_README.txt") -Encoding utf8

# --- Zip (opcional)
if ($Zip) {
  $zipPath = "$ReleaseDir.zip"
  if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
  Write-Host "🧩 Compactando ZIP..." -ForegroundColor Cyan
  Compress-Archive -Path (Join-Path $ReleaseDir "*") -DestinationPath $zipPath
  Write-Host "ZIP: $zipPath"
}

# --- Info final
$describe = (git -C $RootDir describe --tags --abbrev=7 --always) 2>$null
if (-not $describe) { $describe = (git -C $RootDir rev-parse --short HEAD) }

Write-Host "OK: pacote gerado em $ReleaseDir" -ForegroundColor Green
Write-Host "Commit: $describe"
