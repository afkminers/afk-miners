param(
  [string]$Base = "http://localhost:3000",
  [string]$LoginName = "tigasfarm30",
  [string]$LoginPass = "901315",
  [string]$Map = "house",
  [string]$HeroId = "",   # deixe vazio para resolver automaticamente pelo /api/player/me
  [int]$X = 30,
  [int]$Y = 30
)

$ProgressPreference = 'SilentlyContinue'

function New-SessionAndLogin {
  param($Base, $LoginName, $LoginPass)
  $sess = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $null = Invoke-WebRequest -Uri "$Base/api/csrf" -Method GET -WebSession $sess -Headers @{ Accept="application/json" }
  $csrf = ($sess.Cookies.GetCookies($Base) | Where-Object { $_.Name -eq "csrf" }).Value
  if (-not $csrf) { throw "CSRF cookie ausente" }
  $headers = @{
    "Accept"       = "application/json"
    "Content-Type" = "application/json"
    "X-CSRF-Token" = $csrf
    "Origin"       = $Base
    "Referer"      = "$Base/"
  }
  $loginBody = @{ name=$LoginName; password=$LoginPass } | ConvertTo-Json
  $loginResp = Invoke-RestMethod -Uri "$Base/api/auth/login" -Method POST -WebSession $sess -Headers $headers -Body $loginBody
  Write-Host ("Login resp: " + ($loginResp | ConvertTo-Json -Depth 6))
  return @{ Sess=$sess; Headers=$headers }
}

function Resolve-HeroId {
  param($Base, $Sess, $MaybeHeroId)
  # Se não vier heroId, ou vier numérico/curto, tenta resolver pelo /api/player/me (pega o starter ou o primeiro)
  if ([string]::IsNullOrWhiteSpace($MaybeHeroId) -or $MaybeHeroId -match '^\d+$' -or $MaybeHeroId.Length -lt 30) {
    $me = Invoke-RestMethod -Uri "$Base/api/player/me" -Method GET -WebSession $Sess
    $starter = $me.heroes | Where-Object { $_.isStarter -eq 1 -or $_.isStarter -eq $true } | Select-Object -First 1
    if ($starter) { return [string]$starter.id }
    $first = $me.heroes | Select-Object -First 1
    if ($first)   { return [string]$first.id }
    throw "Nenhum herói encontrado no perfil do jogador."
  }
  return [string]$MaybeHeroId
}

function Get-Backpack {
  param($Base, $Sess, $HeroId)
  return Invoke-RestMethod -Uri "$Base/api/backpack/$HeroId/slots" -Method GET -WebSession $Sess
}

# MAIN
$auth    = New-SessionAndLogin -Base $Base -LoginName $LoginName -LoginPass $LoginPass
$sess    = $auth.Sess
$headers = $auth.Headers

$HeroId  = Resolve-HeroId -Base $Base -Sess $sess -MaybeHeroId $HeroId
Write-Host "Usando HeroId: $HeroId"

$bp = Get-Backpack -Base $Base -Sess $sess -HeroId $HeroId
$bp | ConvertTo-Json -Depth 8 | Write-Host

# Se não há backpack equipada, não adianta tentar pickup.
if (([int]$bp.capacity) -le 0) {
  Write-Warning "Backpack com capacidade 0. Equipe um item no slot BACK (ex.: bag_brown) e rode novamente."
  exit 0
}

# Seleciona um item com quantidade > 0 (usa itemKey, com cast numérico seguro)
$item = $null
if ($bp -and $bp.items) {
  $item = $bp.items |
    Where-Object { ([int]($_.qty)) -gt 0 -and [string]::IsNullOrWhiteSpace($_.itemKey) -eq $false } |
    Select-Object -First 1
}

if (-not $item) {
  Write-Warning "Nenhum item com qty>0 na mochila para o fallback de drop/pickup. Pulando o fallback."
  exit 0
}

# itemKey normalizado
$itemKey = [string]$item.itemKey
if ([string]::IsNullOrWhiteSpace($itemKey)) {
  Write-Warning "Não consegui inferir itemKey do item selecionado."
  exit 0
}

Write-Host "Tentando drop: itemKey=$itemKey qty=1 em $Map @ ($X,$Y)"

$dropBody = @{ heroId = "$HeroId"; itemKey = "$itemKey"; qty = 1; mapKey = "$Map"; x = $X; y = $Y } | ConvertTo-Json
$dropResp = Invoke-RestMethod -Uri "$Base/api/loot/drop" -Method POST -WebSession $sess -Headers $headers -Body $dropBody -ContentType "application/json"
$dropResp | ConvertTo-Json -Depth 8 | Write-Host

Start-Sleep -Milliseconds 350

# Lista loots e tenta achar o que acabou de ser dropado (mesma key, mais perto das coords)
$loots = Invoke-RestMethod -Uri "$Base/api/map/$Map/loot" -Method GET -WebSession $sess

# Seleciona o loot contendo o itemKey e mais próximo de (X,Y)
$loot = $null
if ($loots) {
  $loot = $loots |
    Where-Object { $_.items -and ($_.items | Where-Object { ($_.key -eq $itemKey) -and ([int]$_.amount) -ge 1 }) } |
    Sort-Object { [int]([Math]::Abs($_.x - $X) + [Math]::Abs($_.y - $Y)) } |
    Select-Object -First 1
}

if (-not $loot) {
  Write-Warning "Drop feito, mas não achei loot correspondente (TTL curto ou corrida com outro loot). Tente novamente."
  $loots | ConvertTo-Json -Depth 6 | Write-Host
  exit 0
}

$lootId = [string]$loot.id
Write-Host "LootId selecionado = $lootId"

$pickBody = @{ heroId = "$HeroId"; lootId = "$lootId" } | ConvertTo-Json
$pickResp = Invoke-RestMethod -Uri "$Base/api/loot/pickup" -Method POST -WebSession $sess -Headers $headers -Body $pickBody -ContentType "application/json"
$pickResp | ConvertTo-Json -Depth 8 | Write-Host

# Estado final
Write-Host "Backpack após pickup:"
Invoke-RestMethod -Uri "$Base/api/backpack/$HeroId/slots" -Method GET -WebSession $sess | ConvertTo-Json -Depth 6 | Write-Host

Write-Host "Loots restantes no mapa:"
Invoke-RestMethod -Uri "$Base/api/map/$Map/loot" -Method GET -WebSession $sess | ConvertTo-Json -Depth 6 | Write-Host