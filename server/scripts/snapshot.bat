:: server\scripts\snapshot.bat
@echo off
set NAME=%*
if "%NAME%"=="" (
  echo Uso: npm run ctx:snapshot:win -- ^<nome^>
  exit /b 1
)

for /f %%a in ('git rev-parse --short HEAD') do set HASH=%%a
for /f %%a in ('"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set DATE=%%a
set TAG=v-am-%DATE%-%NAME: =-%
set ROOT=%~dp0..\..

node scripts\gen-context.js > NUL

if not exist "%ROOT%docs\snapshots" mkdir "%ROOT%docs\snapshots"
if not exist "%ROOT%docs\context" mkdir "%ROOT%docs\context"

set SNAP=%ROOT%docs\snapshots\SNAPSHOT-%DATE%-%NAME: =-%.md
(
  echo # AFK Miners — Snapshot %DATE% — %NAME%
  echo Commit: %HASH%  ^|  Tag: %TAG%
  echo.
  echo ## Resumo
  echo - (Preencha com mudanças desse ciclo)
  echo.
  echo ## Referencias
  echo - docs/context/context-pack.txt (gerado)
  echo - docs/context/data-summary.json
  echo - docs/context/changes-since.txt
  echo.
  echo ## Observacoes
  echo - (Notas rápidas de deploy/variaveis)
) > "%SNAP%"

echo SNAPSHOT-%DATE%-%NAME: =-%.md (commit %HASH%)> "%ROOT%docs\SNAPSHOT_CURRENT.md"

git add "%ROOT%docs\SNAPSHOT_CURRENT.md" "%SNAP%" "%ROOT%docs\context\*" >NUL 2>&1

echo Criado "%SNAP%"

echo Criando tag %TAG%
git tag -a "%TAG%" -m "snapshot: %NAME%" >NUL 2>&1
