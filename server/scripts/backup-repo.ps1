# backup-repo.ps1
# Cria um .zip completo do repositório (raiz), excluindo junk (node_modules, .git, dist, etc.)
# Uso:
#   pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File scripts/backup-repo.ps1 -Label pre
#   pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File scripts/backup-repo.ps1 -Label post

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("pre","post")]
  [string] $Label,

  [string] $OutDir = ""
)

# --- paths
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path      # ...\server\scripts
$ServerDir = Split-Path -Parent $ScriptDir                        # ...\server
$RootDir   = Split-Path -Parent $ServerDir                        # repo raiz

if (-not $OutDir -or $OutDir -eq "") {
  $OutDir = Join-Path $RootDir "docs\backups"
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# --- git meta
function _sh($args) {
  try { (& git -C $RootDir $args) 2>$null } catch { "" }
}
$hash    = (_sh "rev-parse --short HEAD"); if (-not $hash)   { $hash = "nohash" }
$branch  = (_sh "rev-parse --abbrev-ref HEAD"); if (-not $branch) { $branch = "unknown" }
$remote  = (_sh "remote get-url origin"); if (-not $remote)  { $remote = "none" }
$status  = (_sh "status -sb")
$ts      = Get-Date -Format "yyyy-MM-dd_HHmmss"

# --- temp staging
$TmpRoot = Join-Path $env:TEMP "afkminers-backup-$ts-$Label"
$Stage   = Join-Path $TmpRoot "repo"
New-Item -ItemType Directory -Force -Path $Stage | Out-Null

# --- copiar árvore (excluindo pastas transitórias)
# robocopy códigos 0..7 = sucesso
$xd = @(
  ".git",".github","node_modules",".next","dist","build","coverage",
  "tmp","temp",".cache",".turbo",".vscode",".idea",".vercel",
  "docs\releases","docs\backups"
)
$xo = @("*.zip","*.log")

# Robocopy exige destino como subpasta
$rcArgs = @(
  "`"$RootDir`"", "`"$Stage`"", "/MIR",
  "/NFL","/NDL","/NJH","/NJS","/NP", "/R:1","/W:1"
)
foreach ($x in $xd) { $rcArgs += @("/XD", "`"$(Join-Path $RootDir $x)`"") }
foreach ($x in $xo) { $rcArgs += @("/XF", $x) }

$rob = Start-Process -FilePath "robocopy.exe" -ArgumentList $rcArgs -PassThru -Wait -NoNewWindow
if ($rob.ExitCode -gt 7) {
  Write-Host "❌ Falha no robocopy (exit=$($rob.ExitCode))." -ForegroundColor Red
  Remove-Item $TmpRoot -Recurse -Force -ErrorAction SilentlyContinue
  exit 1
}

# --- metadata do backup
$meta = @()
$meta += "label: $Label"
$meta += "timestamp: $ts"
$meta += "branch: $branch"
$meta += "hash: $hash"
$meta += "remote: $remote"
$meta += ""
$meta += "status:"
$meta += $status
$metaPath = Join-Path $Stage "_backup-meta.txt"
$meta | Out-File -Encoding utf8 $metaPath

# --- zip
$zipName = "${ts}-${Label}-${branch}-${hash}.zip"
$zipPath = Join-Path $OutDir $zipName
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

try {
  Compress-Archive -Path (Join-Path $Stage "*") -DestinationPath $zipPath -Force
} catch {
  Write-Host "❌ Erro ao compactar: $($_.Exception.Message)" -ForegroundColor Red
  Remove-Item $TmpRoot -Recurse -Force -ErrorAction SilentlyContinue
  exit 1
}

# --- limpar temp
Remove-Item $TmpRoot -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "✅ Backup criado: $zipPath" -ForegroundColor Green
