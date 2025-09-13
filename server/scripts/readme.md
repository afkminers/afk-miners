# Scripts de teste de backend

Pré-requisitos:
- PowerShell 5+ (funciona) e idealmente PowerShell 7+ (pwsh).
- Node.js (apenas para o teste de WS) e pacote `ws`: `npm i ws`.

## test-http.ps1
Roda uma bateria de testes:
- Login com CSRF (cookie `sid`).
- CORS (permitido e bloqueado).
- GZIP (mostra `Content-Encoding`).
- ETag/304 (If-None-Match).
- Rate limit (sequencial) em GET `/api/game/tick` e POST `/api/player/pos`.
- Body limit 413 em POST `/api/chat/global`.
- Opcional: teste WS de max payload (envia 40KB).

Como usar:
```powershell
pwsh scripts/test-http.ps1 -BASE http://localhost:3000 -ORIGIN http://localhost:3000 -NAME seuUsuario -PASSWORD suaSenha -RunWsTest
```

## blast-tick.ps1
Dispara várias requisições em paralelo para demonstrar 429 em GET `/api/game/tick`.

Como usar:
```powershell
# 40 requests concorrentes
pwsh scripts/blast-tick.ps1 -BASE http://localhost:3000 -ORIGIN http://localhost:3000 -NAME seuUsuario -PASSWORD suaSenha -Count 40
```

Saída esperada: mistura de `200` e `429` com `RateLimit-Remaining` decrescendo.

## Teste de WebSocket
O `test-http.ps1` pode chamar o script Node, mas você também pode rodar diretamente:
```bash
node scripts/ws-payload-test.js --url ws://localhost:3000/ws --origin http://localhost:3000 --bytes 40960
```
Espera fechar com código `1009` (“message too big”).

## Habilitar GZIP (opcional)
Para ver `Content-Encoding: gzip`, adicione `compression` ao servidor Express:

```bash
npm i compression
```

No `server/index.js`:
```js
const compression = require('compression');
app.use(compression({ threshold: 1024 })); // antes das rotas
```