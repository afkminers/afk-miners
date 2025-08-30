# AFK Miners — API

## Variáveis de ambiente

- `APP_ORIGIN` (defaults: http://localhost:3000)
- `CONTENT_PIPELINE` (defaults: off)
- `COOKIE_DOMAIN` (defaults: undefined)
- `COOKIE_NAME` (defaults: sid)
- `COOKIE_SAME_SITE` (defaults: Lax)
- `COOKIE_SECURE` (defaults: false)
- `CSRF_COOKIE` (defaults: csrf)
- `CTX_DEPTH` (defaults: 4)
- `CTX_IMPORTS`
- `CTX_SYMBOLS`
- `DATABASE_URL`
- `JWT_SECRET` (defaults: changeme, CHANGE_ME_DEV_ONLY)
- `NODE_ENV` (defaults: development)
- `PORT` (defaults: 3000)
- `REDIS_URL` (defaults: null)
- `SESSION_COOKIE_NAME` (defaults: process.env.COOKIE_NAME, token)
- `WORKER_TICK_SECONDS` (defaults: 3)

## Endpoints

### GET /

Arquivo: `server\index.js:419`

_Sem payload inferido_

### GET /api/admin/content/map/:key/data

Arquivo: `server\index.js:392`

**Payloads (exemplos inferidos):**
- params:
```json
{
  "key": "value"
}
```
- query:
```json
{
  "map": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,reloaded:mapKey }
```

**Erros conhecidos:**
- `HTTP 404` → {error:'map not found' }
- `HTTP 500` → {error:err.message }
- `HTTP 500` → {error:e.message }

### GET /api/admin/content/map/:key/objects

Arquivo: `server\index.js:367`

**Payloads (exemplos inferidos):**
- params:
```json
{
  "key": "value"
}
```
- query:
```json
{
  "map": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,reloaded:mapKey }
```

**Erros conhecidos:**
- `HTTP 500` → {error:err.message }
- `HTTP 500` → {error:err.message }
- `HTTP 404` → {error:'map not found' }
- `HTTP 500` → {error:err.message }
- `HTTP 500` → {error:e.message }

### GET /api/admin/content/map/:key/spawns

Arquivo: `server\index.js:379`

**Payloads (exemplos inferidos):**
- params:
```json
{
  "key": "value"
}
```
- query:
```json
{
  "map": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,reloaded:mapKey }
```

**Erros conhecidos:**
- `HTTP 500` → {error:err.message }
- `HTTP 404` → {error:'map not found' }
- `HTTP 500` → {error:err.message }
- `HTTP 500` → {error:e.message }

### GET /api/admin/content/maps

Arquivo: `server\index.js:356`

**Payloads (exemplos inferidos):**
- query:
```json
{
  "map": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,reloaded:mapKey }
```

**Erros conhecidos:**
- `HTTP 500` → {error:err.message }
- `HTTP 500` → {error:err.message }
- `HTTP 500` → {error:err.message }
- `HTTP 404` → {error:'map not found' }
- `HTTP 500` → {error:err.message }
- `HTTP 500` → {error:e.message }

### GET /api/admin/content/monsters

Arquivo: `server\index.js:326`

**Payloads (exemplos inferidos):**
- query:
```json
{
  "map": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,reloaded:mapKey }
```

**Erros conhecidos:**
- `HTTP 500` → {error:err.message }
- `HTTP 500` → {error:err.message }
- `HTTP 500` → {error:err.message }
- `HTTP 500` → {error:err.message }
- `HTTP 500` → {error:err.message }
- `HTTP 500` → {error:err.message }
- `HTTP 404` → {error:'map not found' }
- `HTTP 500` → {error:err.message }
- `HTTP 500` → {error:e.message }

### GET /api/assets/items

Arquivo: `server\index.js:337`

**Payloads (exemplos inferidos):**
- query:
```json
{
  "map": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,reloaded:mapKey }
```

**Erros conhecidos:**
- `HTTP 500` → {error:err.message }
- `HTTP 500` → {error:err.message }
- `HTTP 500` → {error:err.message }
- `HTTP 500` → {error:err.message }
- `HTTP 500` → {error:err.message }
- `HTTP 404` → {error:'map not found' }
- `HTTP 500` → {error:err.message }
- `HTTP 500` → {error:e.message }

### GET /api/assets/sprites

Arquivo: `server\index.js:346`

**Payloads (exemplos inferidos):**
- query:
```json
{
  "map": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,reloaded:mapKey }
```

**Erros conhecidos:**
- `HTTP 500` → {error:err.message }
- `HTTP 500` → {error:err.message }
- `HTTP 500` → {error:err.message }
- `HTTP 500` → {error:err.message }
- `HTTP 404` → {error:'map not found' }
- `HTTP 500` → {error:err.message }
- `HTTP 500` → {error:e.message }

### GET /api/chat/global

Arquivo: `server\index.js:631`

**Payloads (exemplos inferidos):**
- query:
```json
{
  "limit": 1
}
```

**Resposta de sucesso (amostra):**
```json
{
  "ok": true
}
```

**Erros conhecidos:**
- `HTTP 500` → {error:err.message }
- `HTTP 400` → {error:'Mensagem vazia' }
- `HTTP 500` → {error:err.message }

### GET /api/csrf

Arquivo: `server\index.js:43`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "try {\n    const { heroId": 1,
  "weaponOrSkill": "value",
  "heroClass": "value"
}
```

**Erros conhecidos:**
- `HTTP 400` → {error:'heroId,weaponOrSkill e heroClass são obrigatórios' }

### GET /assets/items

Arquivo: `server\routes\assets.js:29`

_Sem payload inferido_

**Erros conhecidos:**
- `HTTP 500` → {error:"Falha ao listar items" }

### GET /assets/sprites

Arquivo: `server\routes\assets.js:8`

_Sem payload inferido_

**Erros conhecidos:**
- `HTTP 500` → {error:"Falha ao listar sprites" }
- `HTTP 500` → {error:"Falha ao listar items" }

### GET /class-rates

Arquivo: `server\skills\routes.js:33`

**Payloads (exemplos inferidos):**
- query:
```json
{
  "heroId": 1
}
```

**Erros conhecidos:**
- `HTTP 500` → {error:'Falha ao listar rates' }
- `HTTP 400` → {error:'heroId é obrigatório' }
- `HTTP 404` → {error:'Herói não encontrado' }
- `HTTP 500` → {error:'Falha ao listar skills do herói' }

### GET /curves

Arquivo: `server\skills\routes.js:10`

**Payloads (exemplos inferidos):**
- query:
```json
{
  "skill": "value",
  "heroId": 1
}
```

**Resposta de sucesso (amostra):**
```json
{skill_type:skill,rows }
```

**Erros conhecidos:**
- `HTTP 400` → {error:'informe ?skill=SWORD|AXE|CLUB|DISTANCE|SHIELD|MAGIC',}
- `HTTP 500` → {error:'Falha ao listar curvas' }
- `HTTP 500` → {error:'Falha ao listar rates' }
- `HTTP 400` → {error:'heroId é obrigatório' }
- `HTTP 404` → {error:'Herói não encontrado' }
- `HTTP 500` → {error:'Falha ao listar skills do herói' }

### GET /heroes/master

Arquivo: `server\routes\catalog.js:10`

_Sem payload inferido_

**Erros conhecidos:**
- `HTTP 500` → {error:'Falha ao listar heróis' }

### GET /list

Arquivo: `server\starter\routes.js:29`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "try {\n      const playerId = req.user.id;\n      const { heroKey": 1
}
```

**Resposta de sucesso (amostra):**
```json
{canSelect:!row }
```

**Erros conhecidos:**
- `HTTP 500` → {error:'erro ao listar starters' }
- `HTTP 500` → {error:'erro ao checar status do starter' }
- `HTTP 400` → {error:'heroKey é obrigatório' }
- `HTTP 400` → {error:'starter já escolhido' }
- `HTTP 400` → {error:'heroKey inválido' }
- `HTTP 400` → {error:'starter já escolhido' }
- `HTTP 400` → {error:'schema indica heroKey gerada — tente novamente; já ajustamos para não inserir nela.' }
- `HTTP 500` → {error:'erro ao selecionar starter' }

### GET /me

Arquivo: `server\skills\routes.js:48`

**Payloads (exemplos inferidos):**
- query:
```json
{
  "heroId": 1
}
```

**Erros conhecidos:**
- `HTTP 400` → {error:'heroId é obrigatório' }
- `HTTP 404` → {error:'Herói não encontrado' }
- `HTTP 500` → {error:'Falha ao listar skills do herói' }

### GET /ping

Arquivo: `server\routes\afk.js:7`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "try {\n    const playerId = String(req.user.id || req.user.playerId || req.user.userId || '');\n    const { name": 1,
  "produce_type": "value",
  "produce_amount = 1": 1,
  "rate_sec = 10": "value",
  "assigned_box = null": "value",
  "try {\n    const playerId = String(req.user.id || req.user.playerId || req.user.userId || '');\n    const { worker_id": 1,
  "box_id": 1
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,ts:Date.now() }
```

**Erros conhecidos:**
- `HTTP 500` → {error:'afk_state_failed' }
- `HTTP 400` → {error:'produce_type required' }
- `HTTP 500` → {error:'create_worker_failed' }
- `HTTP 400` → {error:'worker_id required' }
- `HTTP 404` → {error:'worker_not_found' }
- `HTTP 404` → {error:'box_not_found' }
- `HTTP 500` → {error:'assign_failed' }
- `HTTP 500` → {error:'collect_failed' }

### GET /pos

Arquivo: `server\routes\player.js:12`

**Payloads (exemplos inferidos):**
- query:
```json
{
  "map": "value"
}
```
- body:
```json
{
  "const { mapKey": "value",
  "x": "value",
  "y": "value",
  "const { seq": "value",
  "type": "value",
  "tx": "value",
  "ty": "value",
  "mapKey": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{x:row.x,y:row.y }
```

**Erros conhecidos:**
- `HTTP 400` → {error:'coords inválidas' }
- `HTTP 409` → {error:'old-seq' }
- `HTTP 400` → {error:'too-fast' }

### GET /state

Arquivo: `server\routes\farm.js:71`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "try {\n    const playerId = String(req.user.id || req.user.playerId || '');\n    const { x = 0": 1,
  "y = 0": "value",
  "try {\n    const playerId = String(req.user.id || req.user.playerId || '');\n    const { plot_id": 1,
  "crop_key": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{plots:enhanced,crops:Object.keys(CROPS) }
```

**Erros conhecidos:**
- `HTTP 500` → {error:'farm_state_failed' }
- `HTTP 500` → {error:'plot_create_failed' }
- `HTTP 400` → {error:'plot_id and crop_key required' }
- `HTTP 404` → {error:'plot_not_found' }
- `HTTP 400` → {error:'plot_not_empty' }
- `HTTP 400` → {error:'invalid_crop' }
- `HTTP 400` → {error:'no_seed' }
- `HTTP 500` → {error:'plant_failed' }
- `HTTP 400` → {error:'plot_id required' }
- `HTTP 404` → {error:'plot_not_found' }
- `HTTP 400` → {error:'empty_plot' }
- `HTTP 400` → {error:'invalid_crop' }
- `HTTP 400` → {error:'not_ripe',stage:s.stage,next_at:s.nextAt,progress_pct:s.progressPct }

### GET /status

Arquivo: `server\starter\routes.js:74`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "try {\n      const playerId = req.user.id;\n      const { heroKey": 1
}
```

**Resposta de sucesso (amostra):**
```json
{canSelect:!row }
```

**Erros conhecidos:**
- `HTTP 500` → {error:'erro ao checar status do starter' }
- `HTTP 400` → {error:'heroKey é obrigatório' }
- `HTTP 400` → {error:'starter já escolhido' }
- `HTTP 400` → {error:'heroKey inválido' }
- `HTTP 400` → {error:'starter já escolhido' }
- `HTTP 400` → {error:'schema indica heroKey gerada — tente novamente; já ajustamos para não inserir nela.' }
- `HTTP 500` → {error:'erro ao selecionar starter' }

### POST /

Arquivo: `server\gacha\routes.js:144`

**Payloads (exemplos inferidos):**
- query:
```json
{
  "count": 1
}
```

**Resposta de sucesso (amostra):**
```json
{cost:SUMMON_COST_COINS,pulls,newBalance:updated }
```

**Erros conhecidos:**
- `HTTP 400` → {error:result.error,cost:SUMMON_COST_COINS }
- `HTTP 400` → {error:r.error,cost:SUMMON_COST_COINS,pulls }
- `HTTP 500` → {error:'Falha ao girar gacha' }

### POST /api/admin/content/reload-map

Arquivo: `server\index.js:402`

**Payloads (exemplos inferidos):**
- query:
```json
{
  "map": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,reloaded:mapKey }
```

**Erros conhecidos:**
- `HTTP 500` → {error:e.message }

### POST /api/chat/global

Arquivo: `server\index.js:654`

_Sem payload inferido_

**Resposta de sucesso (amostra):**
```json
{
  "ok": true
}
```

**Erros conhecidos:**
- `HTTP 400` → {error:'Mensagem vazia' }
- `HTTP 500` → {error:err.message }

### POST /assign

Arquivo: `server\routes\afk.js:65`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "try {\n    const playerId = String(req.user.id || req.user.playerId || req.user.userId || '');\n    const { worker_id": 1,
  "box_id": 1
}
```

**Resposta de sucesso (amostra):**
```json
{
  "ok": true
}
```

**Erros conhecidos:**
- `HTTP 400` → {error:'worker_id required' }
- `HTTP 404` → {error:'worker_not_found' }
- `HTTP 404` → {error:'box_not_found' }
- `HTTP 500` → {error:'assign_failed' }
- `HTTP 500` → {error:'collect_failed' }

### POST /collect

Arquivo: `server\routes\afk.js:88`

_Sem payload inferido_

**Resposta de sucesso (amostra):**
```json
{ok:true,added:total }
```

**Erros conhecidos:**
- `HTTP 500` → {error:'collect_failed' }

### POST /create-worker

Arquivo: `server\routes\afk.js:42`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "try {\n    const playerId = String(req.user.id || req.user.playerId || req.user.userId || '');\n    const { name": 1,
  "produce_type": "value",
  "produce_amount = 1": 1,
  "rate_sec = 10": "value",
  "assigned_box = null": "value",
  "try {\n    const playerId = String(req.user.id || req.user.playerId || req.user.userId || '');\n    const { worker_id": 1,
  "box_id": 1
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,id }
```

**Erros conhecidos:**
- `HTTP 400` → {error:'produce_type required' }
- `HTTP 500` → {error:'create_worker_failed' }
- `HTTP 400` → {error:'worker_id required' }
- `HTTP 404` → {error:'worker_not_found' }
- `HTTP 404` → {error:'box_not_found' }
- `HTTP 500` → {error:'assign_failed' }
- `HTTP 500` → {error:'collect_failed' }

### POST /debug/grant-seed

Arquivo: `server\routes\farm.js:240`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "item_type = 'seed_wheat'": "value",
  "amount = 5": 1
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,item_type,amount:Number(amount) || 0 }
```

**Erros conhecidos:**
- `HTTP 403` → {error:'forbidden' }
- `HTTP 500` → {error:'debug_grant_failed' }

### POST /harvest

Arquivo: `server\routes\farm.js:181`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "try {\n    const playerId = String(req.user.id || req.user.playerId || '');\n    const { plot_id": 1,
  "item_type = 'seed_wheat'": "value",
  "amount = 5": 1
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,yield_item:cfg.yield_item,amount:cfg.yield_qty }
```

**Erros conhecidos:**
- `HTTP 400` → {error:'plot_id required' }
- `HTTP 404` → {error:'plot_not_found' }
- `HTTP 400` → {error:'empty_plot' }
- `HTTP 400` → {error:'invalid_crop' }
- `HTTP 400` → {error:'not_ripe',stage:s.stage,next_at:s.nextAt,progress_pct:s.progressPct }
- `HTTP 500` → {error:'harvest_failed' }
- `HTTP 403` → {error:'forbidden' }
- `HTTP 500` → {error:'debug_grant_failed' }

### POST /login

Arquivo: `server\auth\routes.js:93`

_Sem payload inferido_

**Resposta de sucesso (amostra):**
```json
{
  "ok": true
}
```

**Erros conhecidos:**
- `HTTP 401` → {error:'Credenciais inválidas' }
- `HTTP 401` → {error:'Credenciais inválidas' }
- `HTTP 500` → {error:'Falha ao autenticar' }
- `HTTP 404` → {error:'Jogador não encontrado' }
- `HTTP 500` → {error:'Falha ao obter perfil' }

### POST /logout

Arquivo: `server\auth\routes.js:121`

_Sem payload inferido_

**Resposta de sucesso (amostra):**
```json
{
  "ok": true
}
```

**Erros conhecidos:**
- `HTTP 404` → {error:'Jogador não encontrado' }
- `HTTP 500` → {error:'Falha ao obter perfil' }

### POST /move

Arquivo: `server\routes\player.js:44`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "const { seq": "value",
  "type": "value",
  "tx": "value",
  "ty": "value",
  "mapKey": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,x,y,seq }
```

**Erros conhecidos:**
- `HTTP 409` → {error:'old-seq' }
- `HTTP 400` → {error:'too-fast' }

### POST /plant

Arquivo: `server\routes\farm.js:122`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "try {\n    const playerId = String(req.user.id || req.user.playerId || '');\n    const { plot_id": 1,
  "crop_key": "value",
  "item_type = 'seed_wheat'": "value",
  "amount = 5": 1
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,plot_id,crop_key,stage:1,planted_at:new Date(plantedAtSec * 1000).toISOString(),next_at:new Date(nextAtSec * 1000).toISOString() }
```

**Erros conhecidos:**
- `HTTP 400` → {error:'plot_id and crop_key required' }
- `HTTP 404` → {error:'plot_not_found' }
- `HTTP 400` → {error:'plot_not_empty' }
- `HTTP 400` → {error:'invalid_crop' }
- `HTTP 400` → {error:'no_seed' }
- `HTTP 500` → {error:'plant_failed' }
- `HTTP 400` → {error:'plot_id required' }
- `HTTP 404` → {error:'plot_not_found' }
- `HTTP 400` → {error:'empty_plot' }
- `HTTP 400` → {error:'invalid_crop' }
- `HTTP 400` → {error:'not_ripe',stage:s.stage,next_at:s.nextAt,progress_pct:s.progressPct }
- `HTTP 500` → {error:'harvest_failed' }
- `HTTP 403` → {error:'forbidden' }
- `HTTP 500` → {error:'debug_grant_failed' }

### POST /plot/create

Arquivo: `server\routes\farm.js:101`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "try {\n    const playerId = String(req.user.id || req.user.playerId || '');\n    const { x = 0": 1,
  "y = 0": "value",
  "try {\n    const playerId = String(req.user.id || req.user.playerId || '');\n    const { plot_id": 1,
  "crop_key": "value",
  "item_type = 'seed_wheat'": "value",
  "amount = 5": 1
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,id }
```

**Erros conhecidos:**
- `HTTP 500` → {error:'plot_create_failed' }
- `HTTP 400` → {error:'plot_id and crop_key required' }
- `HTTP 404` → {error:'plot_not_found' }
- `HTTP 400` → {error:'plot_not_empty' }
- `HTTP 400` → {error:'invalid_crop' }
- `HTTP 400` → {error:'no_seed' }
- `HTTP 500` → {error:'plant_failed' }
- `HTTP 400` → {error:'plot_id required' }
- `HTTP 404` → {error:'plot_not_found' }
- `HTTP 400` → {error:'empty_plot' }
- `HTTP 400` → {error:'invalid_crop' }
- `HTTP 400` → {error:'not_ripe',stage:s.stage,next_at:s.nextAt,progress_pct:s.progressPct }
- `HTTP 500` → {error:'harvest_failed' }
- `HTTP 403` → {error:'forbidden' }

### POST /pos

Arquivo: `server\routes\player.js:23`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "const { mapKey": "value",
  "x": "value",
  "y": "value",
  "const { seq": "value",
  "type": "value",
  "tx": "value",
  "ty": "value",
  "mapKey": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{
  "ok": true
}
```

**Erros conhecidos:**
- `HTTP 400` → {error:'coords inválidas' }
- `HTTP 409` → {error:'old-seq' }
- `HTTP 400` → {error:'too-fast' }

### POST /register

Arquivo: `server\auth\routes.js:50`

_Sem payload inferido_

**Resposta de sucesso (amostra):**
```json
{
  "ok": true
}
```

**Erros conhecidos:**
- `HTTP 400` → {error:v.msg }
- `HTTP 400` → {error:vp.msg }
- `HTTP 409` → {error:'Nome já está em uso.' }
- `HTTP 409` → {error:'Nome já está em uso.' }
- `HTTP 500` → {error:'Falha ao registrar' }
- `HTTP 401` → {error:'Credenciais inválidas' }
- `HTTP 401` → {error:'Credenciais inválidas' }
- `HTTP 500` → {error:'Falha ao autenticar' }
- `HTTP 404` → {error:'Jogador não encontrado' }
- `HTTP 500` → {error:'Falha ao obter perfil' }

### POST /select

Arquivo: `server\starter\routes.js:92`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "try {\n      const playerId = req.user.id;\n      const { heroKey": 1
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,id,heroKey }
```

**Erros conhecidos:**
- `HTTP 400` → {error:'heroKey é obrigatório' }
- `HTTP 400` → {error:'starter já escolhido' }
- `HTTP 400` → {error:'heroKey inválido' }
- `HTTP 400` → {error:'starter já escolhido' }
- `HTTP 400` → {error:'schema indica heroKey gerada — tente novamente; já ajustamos para não inserir nela.' }
- `HTTP 500` → {error:'erro ao selecionar starter' }

## Tabela sintética de erros por rota

- **GET /**
- **GET /api/admin/content/map/:key/data**
  - HTTP 404: {error:'map not found' }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:e.message }
- **GET /api/admin/content/map/:key/objects**
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 404: {error:'map not found' }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:e.message }
- **GET /api/admin/content/map/:key/spawns**
  - HTTP 500: {error:err.message }
  - HTTP 404: {error:'map not found' }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:e.message }
- **GET /api/admin/content/maps**
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 404: {error:'map not found' }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:e.message }
- **GET /api/admin/content/monsters**
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 404: {error:'map not found' }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:e.message }
- **GET /api/assets/items**
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 404: {error:'map not found' }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:e.message }
- **GET /api/assets/sprites**
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 404: {error:'map not found' }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:e.message }
- **GET /api/chat/global**
  - HTTP 500: {error:err.message }
  - HTTP 400: {error:'Mensagem vazia' }
  - HTTP 500: {error:err.message }
- **GET /api/csrf**
  - HTTP 400: {error:'heroId,weaponOrSkill e heroClass são obrigatórios' }
- **GET /assets/items**
  - HTTP 500: {error:"Falha ao listar items" }
- **GET /assets/sprites**
  - HTTP 500: {error:"Falha ao listar sprites" }
  - HTTP 500: {error:"Falha ao listar items" }
- **GET /class-rates**
  - HTTP 500: {error:'Falha ao listar rates' }
  - HTTP 400: {error:'heroId é obrigatório' }
  - HTTP 404: {error:'Herói não encontrado' }
  - HTTP 500: {error:'Falha ao listar skills do herói' }
- **GET /curves**
  - HTTP 400: {error:'informe ?skill=SWORD|AXE|CLUB|DISTANCE|SHIELD|MAGIC',}
  - HTTP 500: {error:'Falha ao listar curvas' }
  - HTTP 500: {error:'Falha ao listar rates' }
  - HTTP 400: {error:'heroId é obrigatório' }
  - HTTP 404: {error:'Herói não encontrado' }
  - HTTP 500: {error:'Falha ao listar skills do herói' }
- **GET /heroes/master**
  - HTTP 500: {error:'Falha ao listar heróis' }
- **GET /list**
  - HTTP 500: {error:'erro ao listar starters' }
  - HTTP 500: {error:'erro ao checar status do starter' }
  - HTTP 400: {error:'heroKey é obrigatório' }
  - HTTP 400: {error:'starter já escolhido' }
  - HTTP 400: {error:'heroKey inválido' }
  - HTTP 400: {error:'starter já escolhido' }
  - HTTP 400: {error:'schema indica heroKey gerada — tente novamente; já ajustamos para não inserir nela.' }
  - HTTP 500: {error:'erro ao selecionar starter' }
- **GET /me**
  - HTTP 400: {error:'heroId é obrigatório' }
  - HTTP 404: {error:'Herói não encontrado' }
  - HTTP 500: {error:'Falha ao listar skills do herói' }
  - HTTP 500: {error:'pos-read-failed' }
  - HTTP 429: {error:'rate-limited' }
  - HTTP 400: {error:'invalid-pos' }
  - HTTP 400: {error:'out-of-bounds' }
  - HTTP 400: {error:'inside-solid' }
  - HTTP 409: {error:'stale-seq' }
  - HTTP 202: {ok:false,reason:'too-fast' }
  - HTTP 500: {error:'pos-write-failed' }
  - HTTP 404: {error:'Jogador não encontrado' }
  - HTTP 500: {error:'Falha ao obter perfil' }
- **GET /ping**
  - HTTP 500: {error:'afk_state_failed' }
  - HTTP 400: {error:'produce_type required' }
  - HTTP 500: {error:'create_worker_failed' }
  - HTTP 400: {error:'worker_id required' }
  - HTTP 404: {error:'worker_not_found' }
  - HTTP 404: {error:'box_not_found' }
  - HTTP 500: {error:'assign_failed' }
  - HTTP 500: {error:'collect_failed' }
- **GET /pos**
  - HTTP 400: {error:'coords inválidas' }
  - HTTP 409: {error:'old-seq' }
  - HTTP 400: {error:'too-fast' }
  - HTTP 500: {error:'pos-read-failed' }
  - HTTP 429: {error:'rate-limited' }
  - HTTP 400: {error:'invalid-pos' }
  - HTTP 400: {error:'out-of-bounds' }
  - HTTP 400: {error:'inside-solid' }
  - HTTP 409: {error:'stale-seq' }
  - HTTP 202: {ok:false,reason:'too-fast' }
  - HTTP 500: {error:'pos-write-failed' }
- **GET /state**
  - HTTP 500: {error:'farm_state_failed' }
  - HTTP 500: {error:'plot_create_failed' }
  - HTTP 400: {error:'plot_id and crop_key required' }
  - HTTP 404: {error:'plot_not_found' }
  - HTTP 400: {error:'plot_not_empty' }
  - HTTP 400: {error:'invalid_crop' }
  - HTTP 400: {error:'no_seed' }
  - HTTP 500: {error:'plant_failed' }
  - HTTP 400: {error:'plot_id required' }
  - HTTP 404: {error:'plot_not_found' }
  - HTTP 400: {error:'empty_plot' }
  - HTTP 400: {error:'invalid_crop' }
  - HTTP 400: {error:'not_ripe',stage:s.stage,next_at:s.nextAt,progress_pct:s.progressPct }
  - HTTP 500: {error:'afk_state_failed' }
  - HTTP 400: {error:'produce_type required' }
  - HTTP 500: {error:'create_worker_failed' }
  - HTTP 400: {error:'worker_id required' }
  - HTTP 404: {error:'worker_not_found' }
  - HTTP 404: {error:'box_not_found' }
  - HTTP 500: {error:'assign_failed' }
  - HTTP 500: {error:'collect_failed' }
- **GET /status**
  - HTTP 500: {error:'erro ao checar status do starter' }
  - HTTP 400: {error:'heroKey é obrigatório' }
  - HTTP 400: {error:'starter já escolhido' }
  - HTTP 400: {error:'heroKey inválido' }
  - HTTP 400: {error:'starter já escolhido' }
  - HTTP 400: {error:'schema indica heroKey gerada — tente novamente; já ajustamos para não inserir nela.' }
  - HTTP 500: {error:'erro ao selecionar starter' }
- **POST /**
  - HTTP 400: {error:result.error,cost:SUMMON_COST_COINS }
  - HTTP 400: {error:r.error,cost:SUMMON_COST_COINS,pulls }
  - HTTP 500: {error:'Falha ao girar gacha' }
- **POST /api/admin/content/reload-map**
  - HTTP 500: {error:e.message }
- **POST /api/chat/global**
  - HTTP 400: {error:'Mensagem vazia' }
  - HTTP 500: {error:err.message }
- **POST /assign**
  - HTTP 400: {error:'worker_id required' }
  - HTTP 404: {error:'worker_not_found' }
  - HTTP 404: {error:'box_not_found' }
  - HTTP 500: {error:'assign_failed' }
  - HTTP 500: {error:'collect_failed' }
- **POST /collect**
  - HTTP 500: {error:'collect_failed' }
- **POST /create-worker**
  - HTTP 400: {error:'produce_type required' }
  - HTTP 500: {error:'create_worker_failed' }
  - HTTP 400: {error:'worker_id required' }
  - HTTP 404: {error:'worker_not_found' }
  - HTTP 404: {error:'box_not_found' }
  - HTTP 500: {error:'assign_failed' }
  - HTTP 500: {error:'collect_failed' }
- **POST /debug/grant-seed**
  - HTTP 403: {error:'forbidden' }
  - HTTP 500: {error:'debug_grant_failed' }
- **POST /harvest**
  - HTTP 400: {error:'plot_id required' }
  - HTTP 404: {error:'plot_not_found' }
  - HTTP 400: {error:'empty_plot' }
  - HTTP 400: {error:'invalid_crop' }
  - HTTP 400: {error:'not_ripe',stage:s.stage,next_at:s.nextAt,progress_pct:s.progressPct }
  - HTTP 500: {error:'harvest_failed' }
  - HTTP 403: {error:'forbidden' }
  - HTTP 500: {error:'debug_grant_failed' }
- **POST /login**
  - HTTP 401: {error:'Credenciais inválidas' }
  - HTTP 401: {error:'Credenciais inválidas' }
  - HTTP 500: {error:'Falha ao autenticar' }
  - HTTP 404: {error:'Jogador não encontrado' }
  - HTTP 500: {error:'Falha ao obter perfil' }
- **POST /logout**
  - HTTP 404: {error:'Jogador não encontrado' }
  - HTTP 500: {error:'Falha ao obter perfil' }
- **POST /move**
  - HTTP 409: {error:'old-seq' }
  - HTTP 400: {error:'too-fast' }
- **POST /plant**
  - HTTP 400: {error:'plot_id and crop_key required' }
  - HTTP 404: {error:'plot_not_found' }
  - HTTP 400: {error:'plot_not_empty' }
  - HTTP 400: {error:'invalid_crop' }
  - HTTP 400: {error:'no_seed' }
  - HTTP 500: {error:'plant_failed' }
  - HTTP 400: {error:'plot_id required' }
  - HTTP 404: {error:'plot_not_found' }
  - HTTP 400: {error:'empty_plot' }
  - HTTP 400: {error:'invalid_crop' }
  - HTTP 400: {error:'not_ripe',stage:s.stage,next_at:s.nextAt,progress_pct:s.progressPct }
  - HTTP 500: {error:'harvest_failed' }
  - HTTP 403: {error:'forbidden' }
  - HTTP 500: {error:'debug_grant_failed' }
- **POST /plot/create**
  - HTTP 500: {error:'plot_create_failed' }
  - HTTP 400: {error:'plot_id and crop_key required' }
  - HTTP 404: {error:'plot_not_found' }
  - HTTP 400: {error:'plot_not_empty' }
  - HTTP 400: {error:'invalid_crop' }
  - HTTP 400: {error:'no_seed' }
  - HTTP 500: {error:'plant_failed' }
  - HTTP 400: {error:'plot_id required' }
  - HTTP 404: {error:'plot_not_found' }
  - HTTP 400: {error:'empty_plot' }
  - HTTP 400: {error:'invalid_crop' }
  - HTTP 400: {error:'not_ripe',stage:s.stage,next_at:s.nextAt,progress_pct:s.progressPct }
  - HTTP 500: {error:'harvest_failed' }
  - HTTP 403: {error:'forbidden' }
- **POST /pos**
  - HTTP 400: {error:'coords inválidas' }
  - HTTP 409: {error:'old-seq' }
  - HTTP 400: {error:'too-fast' }
  - HTTP 429: {error:'rate-limited' }
  - HTTP 400: {error:'invalid-pos' }
  - HTTP 400: {error:'out-of-bounds' }
  - HTTP 400: {error:'inside-solid' }
  - HTTP 409: {error:'stale-seq' }
  - HTTP 202: {ok:false,reason:'too-fast' }
  - HTTP 500: {error:'pos-write-failed' }
- **POST /register**
  - HTTP 400: {error:v.msg }
  - HTTP 400: {error:vp.msg }
  - HTTP 409: {error:'Nome já está em uso.' }
  - HTTP 409: {error:'Nome já está em uso.' }
  - HTTP 500: {error:'Falha ao registrar' }
  - HTTP 401: {error:'Credenciais inválidas' }
  - HTTP 401: {error:'Credenciais inválidas' }
  - HTTP 500: {error:'Falha ao autenticar' }
  - HTTP 404: {error:'Jogador não encontrado' }
  - HTTP 500: {error:'Falha ao obter perfil' }
- **POST /select**
  - HTTP 400: {error:'heroKey é obrigatório' }
  - HTTP 400: {error:'starter já escolhido' }
  - HTTP 400: {error:'heroKey inválido' }
  - HTTP 400: {error:'starter já escolhido' }
  - HTTP 400: {error:'schema indica heroKey gerada — tente novamente; já ajustamos para não inserir nela.' }
  - HTTP 500: {error:'erro ao selecionar starter' }
