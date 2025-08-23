param(
  [Parameter(Mandatory=$true)][string]$Name,
  [int]$Depth = 3,
  [switch]$Symbols,
  [switch]$Imports,
  [switch]$Zip
)

# Descobre caminhos (repo root = dois níveis acima deste script)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServerDir = Split-Path -Parent $ScriptDir
$Root = Split-Path -Parent $ServerDir
$Docs = Join-Path $Root 'docs'
$Ctx = Join-Path $Docs 'context'
$Releases = Join-Path $Docs 'releases'

# Garante pastas
New-Item -ItemType Directory -Force -Path $Docs | Out-Null
New-Item -ItemType Directory -Force -Path $Ctx  | Out-Null
New-Item -ItemType Directory -Force -Path $Releases | Out-Null

# Configura ENV para o gerador
$env:CTX_DEPTH = [string]$Depth
if ($Symbols) { $env:CTX_SYMBOLS = '1' } else { Remove-Item Env:CTX_SYMBOLS -ErrorAction SilentlyContinue }
if ($Imports) { $env:CTX_IMPORTS = '1' } else { Remove-Item Env:CTX_IMPORTS -ErrorAction SilentlyContinue }

# Gera os artefatos principais
Push-Location $ServerDir
try {
  node scripts/gen-context.js | Out-Null
}
finally {
  Pop-Location
}

# Coleta metadados do git
$Commit = (git rev-parse --short HEAD) 2>$null
if (-not $Commit) { $Commit = 'n/a' }
$Branch = (git rev-parse --abbrev-ref HEAD) 2>$null
if (-not $Branch) { $Branch = 'n/a' }
$LastTag = (git describe --tags --abbrev=0) 2>$null
if (-not $LastTag) { $LastTag = 'n/a' }

# Normaliza nome e cria pasta de versao com timestamp
$SafeName = ($Name -replace '[^A-Za-z0-9_-]','-')
$Stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$OutDir = Join-Path $Releases ("$Stamp-$SafeName")
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# Copia os arquivos necessarios
$files = @(
  'context-pack.txt',
  'data-summary.json',
  'changes-since.txt',
  'ctx.yml'
)
foreach ($f in $files) {
  $src = Join-Path $Ctx $f
  if (Test-Path $src) {
    Copy-Item $src -Destination (Join-Path $OutDir $f) -Force
  }
}

# Opcionais: symbol-index.json e deps.txt
$opt = @('symbol-index.json','deps.txt')
foreach ($f in $opt) {
  $src = Join-Path $Ctx $f
  if (Test-Path $src) {
    Copy-Item $src -Destination (Join-Path $OutDir $f) -Force
  }
}

# Tambem util: marcador atual, caso exista
$SnapMarker = Join-Path $Docs 'SNAPSHOT_CURRENT.md'
if (Test-Path $SnapMarker) {
  Copy-Item $SnapMarker -Destination (Join-Path $OutDir 'SNAPSHOT_CURRENT.md') -Force
}

# Cria um README com metadados (usar somente ASCII)
$readmeLines = @()
$readmeLines += 'AFK Miners - Release Context Pack'
$readmeLines += ('Timestamp: ' + $Stamp)
$readmeLines += ('Name: ' + $Name)
$readmeLines += ('Commit: ' + $Commit + ' | Branch: ' + $Branch + ' | LastTag: ' + $LastTag)
$readmeLines += ('Depth: ' + $Depth + ' | Symbols: ' + $Symbols.IsPresent + ' | Imports: ' + $Imports.IsPresent)
$readmeLines += ''
$readmeLines += 'Arquivos incluidos:'
Get-ChildItem $OutDir | ForEach-Object { $readmeLines += (' - ' + $_.Name) }
$readmePath = Join-Path $OutDir 'README.txt'
$readmeLines | Out-File -Encoding UTF8 $readmePath

# (Opcional) Compacta para .zip
if ($Zip) {
  $ZipPath = "$OutDir.zip"
  if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
  Compress-Archive -Path (Join-Path $OutDir '*') -DestinationPath $ZipPath
}

Write-Host ('OK: pacote gerado em ' + $OutDir)
if ($Zip) {
  Write-Host ('ZIP: ' + $OutDir + '.zip')
}
