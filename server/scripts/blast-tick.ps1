param(
  [string]$BASE     = 'http://localhost:3000',
  [string]$ORIGIN   = 'http://localhost:3000',
  [string]$NAME     = 'player',
  [string]$PASSWORD = 'password',
  [int]$Count       = 40
)

function New-Session { New-Object Microsoft.PowerShell.Commands.WebRequestSession }
function Get-CookieValue { param($Session,$Name,$Base) $Session.Cookies.GetCookies($Base) | ? { $_.Name -eq $Name } | Select-Object -First 1 -ExpandProperty Value }
function Get-Csrf { param($Session,$Base,$Origin) ($null = $true); $r = Invoke-WebRequest -Uri "$Base/api/csrf" -Headers @{ Origin=$Origin } -WebSession $Session -SkipHttpErrorCheck; try { ($r.Content | ConvertFrom-Json).csrfToken } catch { throw "Não consegui csrfToken" } }
function Login {
  param($Base,$Origin,$Name,$Password)
  $sess = New-Session
  $csrf = Get-Csrf -Session $sess -Base $Base -Origin $Origin
  $body = @{ name=$Name; password=$Password } | ConvertTo-Json
  $r = Invoke-WebRequest -Uri "$Base/api/auth/login" -Method POST -ContentType 'application/json' -Headers @{ Origin=$Origin; 'x-csrf-token'=$csrf } -Body $body -WebSession $sess -SkipHttpErrorCheck
  $sid = Get-CookieValue -Session $sess -Name 'sid' -Base $Base
  if (-not $sid) { throw "Login não retornou cookie 'sid' (body: $($r.Content))" }
  return @{ Session=$sess; Sid=$sid }
}

$auth = Login -Base $BASE -Origin $ORIGIN -Name $NAME -Password $PASSWORD
"sid: {0}..." -f ($auth.Sid.Substring(0,12)) | Write-Host

$jobs = @()
1..$Count | ForEach-Object {
  $i = $_
  $jobs += Start-Job -ScriptBlock {
    param($i, $BASE, $ORIGIN, $SID)
    try {
      $r = Invoke-WebRequest -Uri "$BASE/api/game/tick" -Headers @{ Origin=$ORIGIN; Cookie="sid=$SID" } -SkipHttpErrorCheck -ErrorAction Stop
      "{0}: {1} RL-Remaining={2}" -f $i, $r.StatusCode, ($r.Headers['RateLimit-Remaining'] | Select-Object -First 1)
    } catch {
      $resp = $_.Exception.Response
      "{0}: {1} RL-Remaining={2}" -f $i, $resp.StatusCode.value__, ($resp.Headers['RateLimit-Remaining'] | Select-Object -First 1)
    }
  } -ArgumentList $i, $BASE, $ORIGIN, $auth.Sid
}

Receive-Job -Wait -AutoRemoveJob $jobs