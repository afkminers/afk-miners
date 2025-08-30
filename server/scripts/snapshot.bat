:: server\scripts\snapshot.bat (v7 — PG-only, parrudo)
@echo off
setlocal ENABLEDELAYEDEXPANSION

:: -----------------------------
:: Uso:
::   npm run ctx:snapshot:win -- <nome>
::   (opcionais via env:)
::     PUSH_TAG=1            -> faz git push da tag criada
::     SNAPSHOT_NOTE="..."   -> adiciona nota no snapshot
::     DATABASE_URL=postgres://...  -> se definido e pg_dump estiver no PATH, gera db-dump.sql
::
:: Saída:
::   docs\snapshots\SNAPSHOT-YYYY-MM-DD-<nome>.md
::   docs\SNAPSHOT_CURRENT.md
::   (gera/atualiza docs\context\* via gen-context.js e tenta verificar com verify-context.mjs)
::   (bônus PG: db-dump.sql se possível)

:: -----------------------------
:: Nome do snapshot
set NAME=%*
if "%NAME%"=="" (
  echo Uso: npm run ctx:snapshot:win -- ^<nome^>
  exit /b 1
)

:: -----------------------------
:: Caminhos
set SCRIPT_DIR=%~dp0
set ROOT=%~dp0..\..
for %%A in ("%ROOT%") do set ROOT=%%~fA

:: -----------------------------
:: Git + Data
for /f %%a in ('git -C "%ROOT%" rev-parse --short HEAD') do set HASH=%%a
for /f %%a in ('"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set DATE=%%a
for /f %%a in ('git -C "%ROOT%" rev-parse --abbrev-ref HEAD') do set BRANCH=%%a
for /f %%a in ('git -C "%ROOT%" describe --tags --abbrev^=7 --always 2^>NUL') do set DESCRIBE=%%a
for /f %%a in ('git -C "%ROOT%" describe --tags --abbrev^=0 2^>NUL') do set LASTTAG=%%a

if "%DESCRIBE%"=="" set DESCRIBE=%HASH%
if "%LASTTAG%"=="" set LASTTAG=n/a

set TAG=v-am-%DATE%-%NAME: =-%

echo === Snapshot (v7) ===
echo Root    : %ROOT%
echo Branch  : %BRANCH%
echo Commit  : %HASH%
echo Describe: %DESCRIBE%
echo LastTag : %LASTTAG%
echo Nome    : %NAME%
echo Tag     : %TAG%
echo.

:: -----------------------------
:: 1) Gerar context pack (PG-aware)
echo [1/4] Gerando context (node scripts\gen-context.js)...
pushd "%ROOT%\server"
node scripts\gen-context.js > NUL 2>&1
if errorlevel 1 (
  echo AVISO: gen-context.js retornou codigo de erro. Verifique manualmente.
)
popd

:: -----------------------------
:: 2) Verificar artefatos (se existir verify-context.mjs)
if exist "%ROOT%\server\scripts\verify-context.mjs" (
  echo [2/4] Verificando artefatos (verify-context.mjs)...
  pushd "%ROOT%\server"
  node "scripts\verify-context.mjs"
  if errorlevel 1 (
    echo ERRO: verify-context falhou. Abortando snapshot.
    popd
    exit /b 1
  )
  popd
) else (
  echo [2/4] verify-context.mjs nao encontrado — seguindo sem verificacao.
)

:: -----------------------------
:: 3) Bonus PG: tentar pg_dump se DATABASE_URL estiver setado
if defined DATABASE_URL (
  where pg_dump >NUL 2>&1
  if %ERRORLEVEL%==0 (
    echo [3/4] Executando pg_dump...
    pg_dump --no-owner --no-privileges --format=plain --file "%ROOT%\docs\context\db-dump.sql" "%DATABASE_URL%" >NUL 2>&1
    if exist "%ROOT%\docs\context\db-dump.sql" (
      echo OK: docs\context\db-dump.sql gerado.
    ) else (
      echo AVISO: pg_dump nao gerou arquivo (credenciais/SSL?).
    )
  ) else (
    echo [3/4] AVISO: pg_dump nao encontrado no PATH — pulando dump do banco.
  )
) else (
  echo [3/4] DATABASE_URL nao definido — pulando pg_dump.
)

:: -----------------------------
:: 4) Garantir pastas de saida
if not exist "%ROOT%\docs\snapshots" mkdir "%ROOT%\docs\snapshots" >NUL 2>&1
if not exist "%ROOT%\docs\context"   mkdir "%ROOT%\docs\context"   >NUL 2>&1

set SNAP=%ROOT%\docs\snapshots\SNAPSHOT-%DATE%-%NAME: =-%.md
set CURR=%ROOT%\docs\SNAPSHOT_CURRENT.md

:: -----------------------------
:: 5) Criar arquivo de snapshot (MD) — rico em referencias PG
> "%SNAP%" (
  echo # AFK Miners — Snapshot %DATE% — %NAME%
  echo Commit: %HASH%  ^|  Branch: %BRANCH%  ^|  Tag: %TAG%
  echo Describe: %DESCRIBE%  ^|  LastTag: %LASTTAG%
  echo.
  echo ## Resumo
  if defined SNAPSHOT_NOTE (
    echo %SNAPSHOT_NOTE%
  ) else (
    echo - (Preencha com mudancas desse ciclo)
  )
  echo.
  echo ## Referencias de Contexto
  echo - docs/context/context-pack.txt
  echo - docs/context/API.md
  echo - docs/context/endpoints-contracts.json
  echo - docs/context/responses-sample.json
  echo - docs/context/error-map.json
  echo - docs/context/env-usage.json
  echo - docs/context/function-signatures.json
  echo - docs/context/deps-graph.json
  echo - docs/context/route-history.json
  echo - docs/context/todos.json
  echo - docs/context/openapi.json
  echo - docs/context/changes-since.txt
  echo.
  echo ## Artefatos Postgres (se gerados)
  echo - docs/context/db-schema.sql
  echo - docs/context/db-tables.json
  echo - docs/context/db-indexes.json
  echo - docs/context/db-views.json
  echo - docs/context/db-enums.json
  echo - docs/context/db-extensions.json
  echo - docs/context/db-stats.json
  echo - docs/context/db-counts.txt
  echo - docs/context/db-dump.sql  ^(se DATABASE_URL e pg_dump estiverem OK^)
  echo.
  echo ## Observacoes
  echo - Variaveis: JWT_SECRET, CSRF_SECRET, DATABASE_URL, WORKER_TICK_SECONDS, TRIES_PER_MINUTE_BASE, NODE_ENV
  echo - ^(Notas de deploy / migrations / flags de feature^)
)

> "%CURR%" (
  echo SNAPSHOT-%DATE%-%NAME: =-%.md (commit %HASH%)
)

:: -----------------------------
:: 6) Git add e tag
git -C "%ROOT%" add "%CURR%" "%SNAP%" "%ROOT%\docs\context\*" >NUL 2>&1

echo Criado "%SNAP%"
echo Criando tag %TAG%
git -C "%ROOT%" tag -a "%TAG%" -m "snapshot: %NAME%" >NUL 2>&1

if "%PUSH_TAG%"=="1" (
  echo Fazendo push da tag %TAG%...
  git -C "%ROOT%" push origin "%TAG%" >NUL 2>&1
)

echo.
echo ✅ Snapshot pronto.
endlocal
