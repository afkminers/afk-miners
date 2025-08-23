# server/scripts/make-context-pack.ps1
# Gera um Context Pack completo + ZIP
# Uso:
#   pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File scripts/make-context-pack.ps1 `
#        -Name lobby-alpha -Depth 4 -Symbols -Imports -Zip

param(
  [string] $Name   = "auto",
  [int]    $Depth  = 3,
  [switch] $Symbols,
  [switch] $Imports,
  [switch] $Zip
)

# --- Preparação de caminhos
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path            # ...\server\scripts
$ServerDir = Split-Path -Parent $ScriptDir                              # ...\server
$RootDir   = Split-Path -Parent $ServerDir                              # repo raiz
Set-Location $ServerDir

# --- Timestamp + release dir
$ts = Get-Date -Format "yyyy-MM-dd_HHmmss"
$RelName    = "${ts}-${Name}"
$OutRoot    = Join-Path $RootDir "docs\releases"
$ReleaseDir = Join-Path $OutRoot $RelName
New-Item -ItemType Directory -Force -Path $ReleaseDir | Out-Null

# --- Gerar contextos (robusto) -> escreve em docs/context/* na RAIZ
Write-Host "➡️  Gerando contextos (full)..." -ForegroundColor Cyan
node "scripts\gen-context.js" --full | Out-Null

# --- Copiar principais artefatos para o release
$CtxDir = Join-Path $RootDir "docs\context"

$filesToCopy = @(
  "context-pack.txt",
  "data-summary.json",
  "symbol-index.json",
  "deps.txt",
  "changes-since.txt"
) | ForEach-Object { Join-Path $CtxDir $_ } | Where-Object { Test-Path $_ }

foreach ($f in $filesToCopy) {
  Copy-Item $f $ReleaseDir -Force
}

# --- Incluir metadados úteis do repo
$extra = @(".gitattributes", ".gitignore", "package.json") `
  | ForEach-Object { Join-Path $RootDir $_ } `
  | Where-Object { Test-Path $_ }

foreach ($f in $extra) {
  Copy-Item $f $ReleaseDir -Force
}

# --- DB: dumps (schema / tables / counts)
$Sqlite = "C:\sqlite\sqlite3.exe"
$DbPath = Join-Path $ServerDir "db\database.sqlite"

if ( (Test-Path $Sqlite) -and (Test-Path $DbPath) ) {
  Write-Host "📄 Extraindo schema/tables/counts do SQLite..." -ForegroundColor DarkCyan

  $schemaOut = Join-Path $ReleaseDir "db-schema.sql"
  $tablesOut = Join-Path $ReleaseDir "db-tables.txt"
  $countsOut = Join-Path $ReleaseDir "db-counts.txt"

  & $Sqlite $DbPath ".schema"  | Out-File -Encoding utf8 $schemaOut
  & $Sqlite $DbPath ".tables"  | Out-File -Encoding utf8 $tablesOut

  # .tables pode vir em várias colunas/linhas; junta tudo e filtra nomes válidos
  $tablesRaw = & $Sqlite $DbPath ".tables"
  $tables = @()
  if ($tablesRaw) {
    $tables = ($tablesRaw -join ' ') -split '\s+' | Where-Object { $_ -match '^\w+$' }
  }

  $counts = New-Object System.Collections.Generic.List[string]
  foreach ($t in $tables) {
    try {
      $n = & $Sqlite $DbPath "SELECT COUNT(*) FROM [$t];"
      # formato alinhado quando OK
      $line = "{0,-30} {1,12}" -f $t, $n
    } catch {
      # evita -f no catch (alguns nomes/ruídos quebram o format)
      $pad  = ' ' * ([Math]::Max(1, 30 - $t.Length))
      $line = "$t$pad (erro ao contar)"
    }
    $counts.Add($line)
  }
  $counts | Out-File -Encoding utf8 $countsOut
} else {
  Write-Host "⚠️  SQLite não encontrado em C:\sqlite\sqlite3.exe ou DB ausente. Pulando dumps." -ForegroundColor Yellow
}

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
$Readme += " - context-pack.txt        → estrutura, rotas, inventário, maiores arquivos, HTML/YAML/JSON"
$Readme += " - symbol-index.json       → por arquivo: exports/imports/requires, funções, classes/métodos, variáveis, process.env, TODO/FIXME"
$Readme += " - data-summary.json       → chaves/top-keys dos YAML/JSON do repo"
$Readme += " - deps.txt                → dependências por package.json (root/server/client)"
$Readme += " - changes-since.txt       → diff do último tag até HEAD (se existir tag)"
$Readme += " - db-schema.sql / db-tables.txt / db-counts.txt (se SQLite disponível)"
$Readme += " - .gitattributes / .gitignore / package.json (root)"
$Readme += ""
$Readme += "Gerado por: scripts/make-context-pack.ps1"
$Readme | Out-File -Encoding utf8 (Join-Path $ReleaseDir "README.txt")

# --- Zipar se pedido
if ($Zip) {
  $zipPath = "$ReleaseDir.zip"
  if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
  Write-Host "🧩 Compactando ZIP..." -ForegroundColor Cyan
  Compress-Archive -Path (Join-Path $ReleaseDir "*") -DestinationPath $zipPath
  Write-Host "ZIP: $zipPath"
}

# --- Info final
# Tentar descrever o commit atual (silencioso mesmo sem tag)
$describe = (git -C $RootDir describe --tags --abbrev=7 --always) 2>$null
if (-not $describe) { $describe = (git -C $RootDir rev-parse --short HEAD) }

Write-Host "OK: pacote gerado em $ReleaseDir" -ForegroundColor Green
Write-Host "Commit: $describe"
