# server/scripts/backup-repo.ps1 (v7-PLUS r2 — robusto contra exit=16, PG-ready)
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet("pre","post","manual","nightly","weekly","release")]
  [string] $Label,
  [string] $OutDir = "",
  [switch] $PgDump
)

# -----------------------------
# Helpers
# -----------------------------
function _sh([string[]]$gitArgs) {
  try { (git @gitArgs) 2>$null } catch { "" }
}
function Sanitize([string]$s) {
  if (-not $s) { return $s }
  $invalid = [IO.Path]::GetInvalidFileNameChars() + [IO.Path]::GetInvalidPathChars()
  $r = $s
  foreach ($c in $invalid) { $r = $r.Replace("$c","-") }
  $r = $r -replace '[\\/:\*\?"<>\|]','-'
  $r.Trim()
}
function _section($t){ Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function _ensureDir($p){ if (-not (Test-Path $p)) { New-Item -ItemType Directory -Force -Path $p | Out-Null } }
function _long([string]$p) {  # prefixo \\?\ para caminhos longos (Robocopy)
  try {
    $rp = Resolve-Path -LiteralPath $p -ErrorAction Stop
    if ($rp.Path -like '\\?\*') { return $rp.Path }
    return '\\?\{0}' -f $rp.Path
  } catch {
    # se ainda não existe (ex.: stage), retorna bruto com \\?\
    if ($p -like '\\?\*') { return $p }
    if ($p -match '^[A-Za-z]:\\') { return "\\?\$p" }
    return $p
  }
}

# -----------------------------
# Paths base
# -----------------------------
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path      # ...\server\scripts
$ServerDir = Split-Path -Parent $ScriptDir                        # ...\server
$RootDir   = Split-Path -Parent $ServerDir                        # repo raiz

if (-not $OutDir) { $OutDir = Join-Path $RootDir "docs\backups" }
_ensureDir $OutDir

# -----------------------------
# Git meta
# -----------------------------
$hash    = _sh @("-C",$RootDir,"rev-parse","--short","HEAD"); if (-not $hash) { $hash = "nohash" }
$branch  = _sh @("-C",$RootDir,"rev-parse","--abbrev-ref","HEAD"); if (-not $branch) { $branch = "unknown" }
$remote  = _sh @("-C",$RootDir,"remote","get-url","origin"); if (-not $remote) { $remote = "none" }
$status  = _sh @("-C",$RootDir,"status","-sb")
$ts      = Get-Date -Format "yyyy-MM-dd_HHmmss"

$branchSafe = Sanitize $branch
$hashSafe   = Sanitize $hash

# -----------------------------
# Staging
# -----------------------------
$TmpRoot = Join-Path $env:TEMP ("afkminers-backup-" + $ts + "-" + $Label)
$Stage   = Join-Path $TmpRoot "repo"
_ensureDir $Stage

# -----------------------------
# Exclusões
# -----------------------------
$excludeDirsRel = @(
  ".git",".github","node_modules",".pnpm-store",
  ".next","dist","build","out","coverage",".nyc_output",
  "tmp","temp",".cache",".turbo",".astro",
  ".vscode",".idea",".vercel",
  "docs\releases","docs\backups"
)
$excludeFilesRel = @("*.zip","npm-debug.log*","yarn-error.log*","pnpm-debug.log*","*.log")

# Constrói listas absolutas e filtra só os que existem (para /XD)
$excludeDirsAbs = @()
foreach($rel in $excludeDirsRel){
  $abs = Join-Path $RootDir $rel
  if (Test-Path $abs) { $excludeDirsAbs += $abs }
}

# -----------------------------
# Copiar com Robocopy (tentativas)
# -----------------------------
_section "Copiando repositório (robocopy)"
$srcL = _long $RootDir
$dstL = _long $Stage

# TENTATIVA A — /MIR (rápido) com proteções
$rcArgsA = @($srcL, $dstL, "/MIR","/NFL","/NDL","/NJH","/NJS","/NP","/R:1","/W:1","/MT:16","/SL","/XJ","/XJD","/XJF","/COPY:DAT","/DCOPY:DAT")
foreach ($x in $excludeDirsAbs) { $rcArgsA += @("/XD", (_long $x)) }
foreach ($x in $excludeFilesRel) { $rcArgsA += @("/XF", $x) }

$rob = Start-Process -FilePath "robocopy.exe" -ArgumentList $rcArgsA -PassThru -Wait
$exitA = $rob.ExitCode
Write-Host ("Robocopy A (MIR) exit={0}" -f $exitA) -ForegroundColor DarkGray

if ($exitA -gt 7) {
  # TENTATIVA B — /E sem /MIR (mais permissivo)
  _section "Robocopy fallback (/E sem espelho)"
  $rcArgsB = @($srcL, $dstL, "/E","/NFL","/NDL","/NJH","/NJS","/NP","/R:1","/W:1","/MT:8","/SL","/XJ","/XJD","/XJF","/COPY:DAT","/DCOPY:DAT")
  foreach ($x in $excludeDirsAbs) { $rcArgsB += @("/XD", (_long $x)) }
  foreach ($x in $excludeFilesRel) { $rcArgsB += @("/XF", $x) }
  $rob = Start-Process -FilePath "robocopy.exe" -ArgumentList $rcArgsB -PassThru -Wait
  $exitB = $rob.ExitCode
  Write-Host ("Robocopy B (E) exit={0}" -f $exitB) -ForegroundColor DarkGray

  if ($exitB -gt 7) {
    # TENTATIVA C — fallback Copy-Item (último recurso)
    _section "Fallback Copy-Item (semelhante)"
    try {
      $items = Get-ChildItem -LiteralPath $RootDir -Force -ErrorAction Stop
      foreach ($it in $items) {
        # pula exclusões conhecidas
        $rel = $it.FullName.Substring($RootDir.Length).TrimStart('\','/')
        if ($excludeDirsRel -contains $rel) { continue }
        if ($excludeDirsRel | Where-Object { $rel -like ($_ + "\*") }) { continue }
        Copy-Item -LiteralPath $it.FullName -Destination $Stage -Recurse -Force -ErrorAction SilentlyContinue
      }
    } catch {
      Write-Host "❌ Falha no Copy-Item: $($_.Exception.Message)" -ForegroundColor Red
      Remove-Item $TmpRoot -Recurse -Force -ErrorAction SilentlyContinue
      exit 1
    }
  }
}

# Se após as tentativas ainda está vazio, falha
try {
  $count = (Get-ChildItem -LiteralPath $Stage -Recurse -Force | Measure-Object).Count
  if ($count -eq 0) {
    Write-Host "❌ Staging vazio após tentativas — abortando." -ForegroundColor Red
    Remove-Item $TmpRoot -Recurse -Force -ErrorAction SilentlyContinue
    exit 1
  }
} catch {
  Write-Host "❌ Erro verificando staging: $($_.Exception.Message)" -ForegroundColor Red
  Remove-Item $TmpRoot -Recurse -Force -ErrorAction SilentlyContinue
  exit 1
}

# -----------------------------
# Bonus: pg_dump opcional
# -----------------------------
if ($PgDump) {
  _section "pg_dump opcional"
  $pgDump = Get-Command "pg_dump" -ErrorAction SilentlyContinue
  if ($pgDump -and $env:DATABASE_URL) {
    $dumpPath = Join-Path $Stage "docs\context\db-dump.sql"
    _ensureDir (Split-Path -Parent $dumpPath)
    Write-Host "Executando pg_dump → $dumpPath"
    & $pgDump.Source " --no-owner --no-privileges --format=plain --file `"$dumpPath`" `"$env:DATABASE_URL`"" | Out-Null
  } else {
    if (-not $pgDump) { Write-Host "⚠️  pg_dump não encontrado no PATH." -ForegroundColor Yellow }
    if (-not $env:DATABASE_URL) { Write-Host "⚠️  DATABASE_URL ausente." -ForegroundColor Yellow }
  }
}

# -----------------------------
# Metadados e ZIP
# -----------------------------
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

$zipName = "${ts}-${Label}-${branchSafe}-${hashSafe}.zip"
$zipPath = Join-Path $OutDir $zipName
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $Stage "*") -DestinationPath $zipPath

# -----------------------------
# Limpeza
# -----------------------------
Remove-Item $TmpRoot -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "✅ Backup criado: $zipPath" -ForegroundColor Green
