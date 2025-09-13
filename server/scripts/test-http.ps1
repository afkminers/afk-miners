param(
  [string]$BASE      = 'http://localhost:3000',
  [string]$ORIGIN    = 'http://localhost:3000',
  [string]$NAME      = 'player',
  [string]$PASSWORD  = 'password',
  [switch]$RunWsTest = $false
)

function New-Session { New-Object Microsoft.PowerShell.Commands.WebRequestSession }

function Get-CookieValue {
  param([Microsoft.PowerShell.Commands.WebRequestSession]$Session, [string]$Name, [string]$Base)
  $Session.Cookies.GetCookies($Base) | Where-Object { $_.Name -eq $Name } | Select-Object -First 1 -ExpandProperty Value
}

function Get-Csrf {
  param([Microsoft.PowerShell.Commands.WebRequestSession]$Session, [string]$Base, [string]$Origin)
  $r = Invoke-WebRequest -Uri "$Base/api/csrf" -Headers @{ Origin=$Origin } -WebSession $Session -SkipHttpErrorCheck
  $tok = $null
  try { $tok = ($r.Content | ConvertFrom-Json).csrfToken } catch {}
  if (-not $tok) { try { $tok = ($r.Content | ConvertFrom-Json).token } catch {} }
  if (-not $tok) { throw "Não consegui ler o csrfToken do /api/csrf" }
  return $tok
}

function Login {
  param([Microsoft.PowerShell.Commands.WebRequestSession]$Session, [string]$Base, [string]$Origin, [string]$Name, [string]$Password)
  $csrfTok = Get-Csrf -Session $Session -Base $Base -Origin $Origin
  $body = @{ name=$Name; password=$Password } | ConvertTo-Json
  $r = Invoke-WebRequest -Uri "$Base/api/auth/login" -Method POST -ContentType 'application/json' `
        -Headers @{ Origin=$Origin; 'x-csrf-token'=$csrfTok } -Body $body -WebSession $Session -SkipHttpErrorCheck
  $sid = Get-CookieValue -Session $Session -Name 'sid' -Base $Base
  if (-not $sid) { throw "Login não retornou cookie 'sid' (body: $($r.Content))" }
  return @{ Session=$Session; Csrf=$csrfTok; Sid=$sid }
}

function Test-Cors {
  param([Microsoft.PowerShell.Commands.WebRequestSession]$Session, [string]$Base, [string]$Origin)
  Write-Host "== CORS =="
  $r1 = Invoke-WebRequest -Uri "$Base/api/assets/items" -Headers @{ Origin=$Origin } -WebSession $Session -SkipHttpErrorCheck
  "Permitida - ACAO: {0}" -f ($r1.Headers['Access-Control-Allow-Origin'] | Select-Object -First 1) | Write-Host
  $r2 = Invoke-WebRequest -Uri "$Base/api/assets/items" -Headers @{ Origin='http://malicious.site' } -WebSession $Session -SkipHttpErrorCheck
  "Bloqueada - ACAO: {0}" -f ($r2.Headers['Access-Control-Allow-Origin'] | Select-Object -First 1) | Write-Host
}

function Test-Gzip {
  param([Microsoft.PowerShell.Commands.WebRequestSession]$Session, [string]$Base, [string]$Origin)
  Write-Host "== GZIP =="
  $r = Invoke-WebRequest -Uri "$Base/api/assets/items" -Headers @{ 'Accept-Encoding'='gzip'; Origin=$Origin } -WebSession $Session -SkipHttpErrorCheck
  "Content-Encoding: {0}" -f ($r.Headers['Content-Encoding'] | Select-Object -First 1) | Write-Host
}

function Test-Etag {
  param([Microsoft.PowerShell.Commands.WebRequestSession]$Session, [string]$Base, [string]$Origin)
  Write-Host "== ETag/304 =="
  $r1 = Invoke-WebRequest -Uri "$Base/api/assets/items" -Headers @{ Origin=$Origin } -WebSession $Session -SkipHttpErrorCheck
  $etag = $r1.Headers['ETag'] | Select-Object -First 1
  "ETag: $etag" | Write-Host
  $r2 = Invoke-WebRequest -Uri "$Base/api/assets/items" -Headers @{ Origin=$Origin; 'If-None-Match'=$etag } -WebSession $Session -SkipHttpErrorCheck
  "Status esperado 304, recebido: {0}" -f $r2.StatusCode | Write-Host
}

function Test-RateLimit-Sequential {
  param([Microsoft.PowerShell.Commands.WebRequestSession]$Session, [string]$Base, [string]$Origin, [string]$Csrf)
  Write-Host "== Rate Limits (sequencial) =="
  "GET /api/game/tick (20 reqs)" | Write-Host
  1..20 | ForEach-Object {
    try {
      $r = Invoke-WebRequest -Uri "$Base/api/game/tick" -Headers @{ Origin=$Origin } -WebSession $Session -SkipHttpErrorCheck -ErrorAction Stop
      "{0}: {1} RL-Remaining={2}" -f $_, $r.StatusCode, ($r.Headers['RateLimit-Remaining'] | Select-Object -First 1)
    } catch {
      $resp = $_.Exception.Response
      "{0}: {1} RL-Remaining={2}" -f $_, $resp.StatusCode.value__, ($resp.Headers['RateLimit-Remaining'] | Select-Object -First 1)
    }
  } | Write-Host

  "POST /api/player/pos (20 reqs)" | Write-Host
  $headers = @{ Origin=$Origin; 'Content-Type'='application/json'; 'x-csrf-token'=$Csrf }
  1..20 | ForEach-Object {
    try {
      $r = Invoke-WebRequest -Method POST -Uri "$Base/api/player/pos" -WebSession $Session -Headers $headers -Body '{}' -SkipHttpErrorCheck -ErrorAction Stop
      "{0}: {1} RL-Remaining={2}" -f $_, $r.StatusCode, ($r.Headers['RateLimit-Remaining'] | Select-Object -First 1)
    } catch {
      $resp = $_.Exception.Response
      "{0}: {1} RL-Remaining={2}" -f $_, $resp.StatusCode.value__, ($resp.Headers['RateLimit-Remaining'] | Select-Object -First 1)
    }
  } | Write-Host
}

function Test-BodyLimit {
  param([Microsoft.PowerShell.Commands.WebRequestSession]$Session, [string]$Base, [string]$Origin, [string]$Csrf)
  Write-Host "== Body limit (413) =="
  $big = 'x' * 70000
  $headers = @{ Origin=$Origin; 'Content-Type'='application/json'; 'x-csrf-token'=$Csrf }
  $r = Invoke-WebRequest -Uri "$Base/api/chat/global" -Method POST -Headers $headers -Body (@{ text=$big } | ConvertTo-Json) -WebSession $Session -SkipHttpErrorCheck
  "Status esperado 413, recebido: {0}" -f $r.StatusCode | Write-Host
}

function Main {
  param([string]$Base, [string]$Origin, [string]$Name, [string]$Password, [switch]$RunWsTest)
  $sess = New-Session
  $auth = Login -Session $sess -Base $Base -Origin $Origin -Name $Name -Password $Password
  "Login OK. sid: {0}..." -f ($auth.Sid.Substring(0,12)) | Write-Host
  "CSRF token: {0}" -f $auth.Csrf | Write-Host

  Test-Cors -Session $sess -Base $Base -Origin $Origin
  Test-Gzip  -Session $sess -Base $Base -Origin $Origin
  Test-Etag  -Session $sess -Base $Base -Origin $Origin
  Test-RateLimit-Sequential -Session $sess -Base $Base -Origin $Origin -Csrf $auth.Csrf
  Test-BodyLimit -Session $sess -Base $Base -Origin $Origin -Csrf $auth.Csrf

  if ($RunWsTest) {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
      Write-Warning "Node não encontrado. Instale Node.js e o pacote 'ws' para testar WebSocket (npm i ws)."
    } else {
      Write-Host "== WS maxPayload (envia 40KB e espera fechamento) =="
      node "$PSScriptRoot/ws-payload-test.js" --origin $Origin --url "$Base/ws"
    }
  }

  Write-Host "`nDicas:"
  Write-Host "- Para forçar 429 em GET /api/game/tick, rode scripts/blast-tick.ps1 (jobs em paralelo)."
  Write-Host "- Para habilitar gzip no servidor, adicione 'compression' no Express."
}

Main -Base $BASE -Origin $ORIGIN -Name $NAME -Password $PASSWORD -RunWsTest:$RunWsTest