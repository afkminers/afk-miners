# AFK Miners — API

## Variáveis de ambiente

- `AI_MOBS_DEBUG`
- `AI_MOBS_IGNORE_COLLISION`
- `AI_MOBS_IGNORE_LOS`
- `APP_ORIGIN`
- `APP_ORIGINS` (defaults: http://localhost:3000, process.env.APP_ORIGIN)
- `ASSETS_CACHE_TTL_MS` (defaults: 300000)
- `CATALOG_CACHE_ENABLED`
- `CATALOG_CACHE_REFRESH_SEC` (defaults: 120)
- `CLICK_PICK_RADIUS_PX` (defaults: 192)
- `CLICK_REQUIRE_INTERSECT` (defaults: 1)
- `COMBAT_DEBUG` (defaults: )
- `CONTENT_PIPELINE` (defaults: off)
- `COOKIE_DOMAIN` (defaults: undefined)
- `COOKIE_NAME`
- `COOKIE_SAME_SITE` (defaults: Lax)
- `COOKIE_SECURE` (defaults: false)
- `CSRF_COOKIE` (defaults: csrf)
- `CTX_DEPTH` (defaults: 4)
- `CTX_IMPORTS`
- `CTX_SYMBOLS`
- `DATABASE_URL`
- `DB_IDLE_CLOSE_MINUTES` (defaults: 0)
- `DEBUG_CATALOG_CACHE`
- `DEBUG_HTTP_CACHE`
- `DEBUG_LOOT_CACHE`
- `ENDPOINT_METRICS_INTERVAL_MS` (defaults: 60000)
- `ENDPOINT_METRICS_PROD`
- `ENDPOINT_METRICS_TOP_N` (defaults: 10)
- `FLUSH_POS_INTERVAL_MS` (defaults: 30000)
- `GEN_CONTEXT_ON_START`
- `IDLE_SCHEDULER_CHECK_MS` (defaults: 30000)
- `JSON_LIMIT` (defaults: 64kb)
- `JWT_SECRET` (defaults: changeme, CHANGE_ME_DEV_ONLY)
- `LOOT_CACHE_ENABLED`
- `LOOT_CACHE_TTL_SEC` (defaults: 5)
- `LOOT_CLEANUP_EVERY_SECONDS` (defaults: 30)
- `LOOT_EXPIRE_SECONDS` (defaults: 120)
- `NODE_ENV` (defaults: development)
- `PG_DUMP_PATH`
- `PGSSLMODE`
- `PORT` (defaults: 3000)
- `REDIS_URL` (defaults: null)
- `RESPAWN_DEBUG` (defaults: )
- `RESPAWN_TICK_MS` (defaults: 5000)
- `SESSION_COOKIE_NAME` (defaults: process.env.COOKIE_NAME)
- `SKILL_TRY_PER_HIT` (defaults: 1)
- `SKIP_MIGRATIONS_ON_BOOT`
- `SYNC_SPAWNS_INTERVAL_MS` (defaults: 300000)

## Endpoints

### GET /

Arquivo: `server\index.js:626`

_Sem payload inferido_

### GET /:heroId

Arquivo: `server\routes\equipment.js:31`

**Payloads (exemplos inferidos):**
- params:
```json
{
  "heroId": 1
}
```
- body:
```json
{
  "const { heroId": 1,
  "slot": "value",
  "itemKey": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,equipment:rows }
```

**Erros conhecidos:**
- `HTTP 500` → {ok:false,error:'equipment-failed' }
- `HTTP 400` → {ok:false,error:'missing-params' }
- `HTTP 400` → {ok:false,error:'bad-slot' }
- `HTTP 404` → {ok:false,error:'hero-not-found' }
- `HTTP 404` → {ok:false,error:'no-such-item' }
- `HTTP 400` → {ok:false,error:'slot-mismatch' }
- `HTTP 400` → {ok:false,error:'no-stock' }
- `HTTP 500` → {ok:false,error:'equip-failed' }

### GET /:heroId/slots

Arquivo: `server\routes\backpack.js:8`

**Payloads (exemplos inferidos):**
- params:
```json
{
  "heroId": 1
}
```

**Resposta de sucesso (amostra):**
```json
{heroId,capacity:data.capacity,used:data.used,items:data.items,backpackKey:spec.key,}
```

**Erros conhecidos:**
- `HTTP 400` → {error:'heroId required' }
- `HTTP 500` → {error:'backpack-list-failed' }
- `HTTP 400` → {error:'bad-args' }
- `HTTP 500` → {error:'backpack-deposit-failed' }

### GET /_ping

Arquivo: `server\combat\routes.js:38`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "heroId": 1,
  "try {\n    const { heroId": 1,
  "targetInstanceId": 1
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,ts:Date.now() }
```

**Erros conhecidos:**
- `HTTP 400` → {ok:false,error:'missing-params' }
- `HTTP 400` → {ok:false,error:'mob-pos-missing' }
- `HTTP 400` → {ok:false,error:'hero-pos-missing' }
- `HTTP 500` → {ok:false,error:'start-failed' }
- `HTTP 404` → {ok:false,error:'hero-not-found' }
- `HTTP 500` → {ok:false,error:'stop-failed' }
- `HTTP 400` → {ok:false,error:'missing-id' }
- `HTTP 400` → {ok:false,error:'missing-hero-id' }
- `HTTP 400` → {ok:false,error:'mob-pos-missing' }
- `HTTP 400` → {ok:false,error:'hero-pos-missing' }

### GET /_routes

Arquivo: `server\combat\routes.js:39`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "heroId": 1,
  "try {\n    const { heroId": 1,
  "targetInstanceId": 1
}
```

**Resposta de sucesso (amostra):**
```json
{routes:list }
```

**Erros conhecidos:**
- `HTTP 400` → {ok:false,error:'missing-params' }
- `HTTP 400` → {ok:false,error:'mob-pos-missing' }
- `HTTP 400` → {ok:false,error:'hero-pos-missing' }
- `HTTP 500` → {ok:false,error:'start-failed' }
- `HTTP 404` → {ok:false,error:'hero-not-found' }
- `HTTP 500` → {ok:false,error:'stop-failed' }
- `HTTP 400` → {ok:false,error:'missing-id' }
- `HTTP 400` → {ok:false,error:'missing-hero-id' }
- `HTTP 400` → {ok:false,error:'mob-pos-missing' }
- `HTTP 400` → {ok:false,error:'hero-pos-missing' }

### GET /api/admin/content/map/:key/data

Arquivo: `server\index.js:584`

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

Arquivo: `server\index.js:559`

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

Arquivo: `server\index.js:571`

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

Arquivo: `server\index.js:548`

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

Arquivo: `server\index.js:492`

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

Arquivo: `server\index.js:503`

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

Arquivo: `server\index.js:525`

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

Arquivo: `server\index.js:1285`

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

### GET /api/combat/nearest

Arquivo: `server\routes\combat_nearest.js:30`

**Payloads (exemplos inferidos):**
- query:
```json
{
  "map": "value",
  "x": "value",
  "y": "value",
  "px": "value",
  "py": "value",
  "debug": "value"
}
```

**Erros conhecidos:**
- `HTTP 400` → {error:'bad-coords' }
- `HTTP 404` → {error:'no-alive' }
- `HTTP 404` → {error:'no-intersect' }
- `HTTP 404` → {error:'no-monster-in-radius' }

### GET /api/csrf

Arquivo: `server\index.js:166`

_Sem payload inferido_

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

### GET /cache/stats

Arquivo: `server\routes\loot.js:191`

_Sem payload inferido_

**Erros conhecidos:**
- `HTTP 500` → {error:'cache-stats-failed' }

### GET /class-rates

Arquivo: `server\skills\routes.js:40`

**Payloads (exemplos inferidos):**
- query:
```json
{
  "heroId": 1
}
```
- body:
```json
{
  "router.post('/gain/dev'": "value",
  "async (req": "value",
  "res) => {\n    try {\n      const { heroId": 1,
  "heroClass": "value",
  "skillType": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{skills:rows }
```

**Erros conhecidos:**
- `HTTP 500` → {error:'Falha ao listar rates' }
- `HTTP 400` → {error:'heroId é obrigatório' }
- `HTTP 404` → {error:'Herói não encontrado' }
- `HTTP 500` → {error:'Falha ao listar skills do herói' }
- `HTTP 400` → {error:'heroId é obrigatório' }
- `HTTP 404` → {error:'Herói não encontrado' }
- `HTTP 500` → {error:'Falha ao listar skills do herói' }
- `HTTP 400` → {error:'heroId e skillType são obrigatórios' }
- `HTTP 500` → {error:'Falha ao aplicar ganho' }

### GET /curves

Arquivo: `server\skills\routes.js:14`

**Payloads (exemplos inferidos):**
- query:
```json
{
  "skill": "value",
  "heroId": 1
}
```
- body:
```json
{
  "router.post('/gain/dev'": "value",
  "async (req": "value",
  "res) => {\n    try {\n      const { heroId": 1,
  "heroClass": "value",
  "skillType": "value"
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
- `HTTP 400` → {error:'heroId é obrigatório' }
- `HTTP 404` → {error:'Herói não encontrado' }
- `HTTP 500` → {error:'Falha ao listar skills do herói' }
- `HTTP 400` → {error:'heroId e skillType são obrigatórios' }
- `HTTP 500` → {error:'Falha ao aplicar ganho' }

### GET /hero/:id

Arquivo: `server\skills\routes.js:121`

**Payloads (exemplos inferidos):**
- params:
```json
{
  "id": 1
}
```
- body:
```json
{
  "router.post('/gain/dev'": "value",
  "async (req": "value",
  "res) => {\n    try {\n      const { heroId": 1,
  "heroClass": "value",
  "skillType": "value"
}
```

**Erros conhecidos:**
- `HTTP 400` → {error:'heroId é obrigatório' }
- `HTTP 404` → {error:'Herói não encontrado' }
- `HTTP 500` → {error:'Falha ao listar skills do herói' }
- `HTTP 400` → {error:'heroId e skillType são obrigatórios' }
- `HTTP 500` → {error:'Falha ao aplicar ganho' }

### GET /heroes/master

Arquivo: `server\routes\catalog.js:10`

_Sem payload inferido_

**Erros conhecidos:**
- `HTTP 500` → {error:'Falha ao listar heróis' }

### GET /list

Arquivo: `server\starter\routes.js:42`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "const playerId = req.user.id;\n\n    try {\n      const { heroKey": 1
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

### GET /map/:mapKey/loot

Arquivo: `server\routes\loot.js:73`

**Payloads (exemplos inferidos):**
- params:
```json
{
  "mapKey": "value"
}
```
- body:
```json
{
  "try {\n    const { heroId": 1,
  "lootId": 1
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,snapshot:{heroId:String(heroId),capacity:data.capacity,used:data.used,items:data.items,backpackKey:spec2.key },placed,leftover }
```

**Erros conhecidos:**
- `HTTP 500` → {error:'loot-list-failed' }
- `HTTP 400` → {error:'bad-args' }
- `HTTP 400` → {error:'no-backpack' }
- `HTTP 404` → {error:'loot-not-found' }
- `HTTP 404` → {error:'loot-not-found' }
- `HTTP 500` → {error:'loot-pickup-failed' }
- `HTTP 400` → {error:'bad-args' }
- `HTTP 400` → {error:'not-enough-qty' }
- `HTTP 500` → {error:'drop-failed' }
- `HTTP 500` → {error:'cache-stats-failed' }

### GET /me

Arquivo: `server\skills\routes.js:94`

**Payloads (exemplos inferidos):**
- query:
```json
{
  "heroId": 1
}
```
- body:
```json
{
  "router.post('/gain/dev'": "value",
  "async (req": "value",
  "res) => {\n    try {\n      const { heroId": 1,
  "heroClass": "value",
  "skillType": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{skills:rows }
```

**Erros conhecidos:**
- `HTTP 400` → {error:'heroId é obrigatório' }
- `HTTP 404` → {error:'Herói não encontrado' }
- `HTTP 500` → {error:'Falha ao listar skills do herói' }
- `HTTP 400` → {error:'heroId é obrigatório' }
- `HTTP 404` → {error:'Herói não encontrado' }
- `HTTP 500` → {error:'Falha ao listar skills do herói' }
- `HTTP 400` → {error:'heroId e skillType são obrigatórios' }
- `HTTP 500` → {error:'Falha ao aplicar ganho' }

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

Arquivo: `server\routes\player.old.js:12`

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

Arquivo: `server\starter\routes.js:86`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "const playerId = req.user.id;\n\n    try {\n      const { heroKey": 1
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

### GET /tick

Arquivo: `server\routes\game_tick.js:10`

**Payloads (exemplos inferidos):**
- query:
```json
{
  "sinceChatId": 1,
  "includeLoot": "value",
  "includeCombat": "value"
}
```

### POST /

Arquivo: `server\gacha\routes.js:179`

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

### POST /:heroId/deposit

Arquivo: `server\routes\backpack.js:30`

**Payloads (exemplos inferidos):**
- params:
```json
{
  "heroId": 1
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,placed }
```

**Erros conhecidos:**
- `HTTP 400` → {error:'bad-args' }
- `HTTP 500` → {error:'backpack-deposit-failed' }

### POST /api/admin/content/reload-map

Arquivo: `server\index.js:594`

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

Arquivo: `server\index.js:1308`

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

### POST /attack/start

Arquivo: `server\combat\routes.js:87`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "heroId": 1,
  "try {\n    const { heroId": 1,
  "targetInstanceId": 1
}
```

**Resposta de sucesso (amostra):**
```json
{ok:false,error:'no-weapon-equipped' }
```

**Erros conhecidos:**
- `HTTP 400` → {ok:false,error:'missing-params' }
- `HTTP 400` → {ok:false,error:'mob-pos-missing' }
- `HTTP 400` → {ok:false,error:'hero-pos-missing' }
- `HTTP 500` → {ok:false,error:'start-failed' }
- `HTTP 404` → {ok:false,error:'hero-not-found' }
- `HTTP 500` → {ok:false,error:'stop-failed' }
- `HTTP 400` → {ok:false,error:'missing-id' }
- `HTTP 400` → {ok:false,error:'missing-hero-id' }
- `HTTP 400` → {ok:false,error:'mob-pos-missing' }
- `HTTP 400` → {ok:false,error:'hero-pos-missing' }
- `HTTP 400` → {ok:false,error:result.message }
- `HTTP 500` → {ok:false,error:'hit-failed' }

### POST /attack/stop

Arquivo: `server\combat\routes.js:132`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "heroId": 1,
  "try {\n    const { heroId": 1
}
```

**Resposta de sucesso (amostra):**
```json
{
  "ok": true
}
```

**Erros conhecidos:**
- `HTTP 404` → {ok:false,error:'hero-not-found' }
- `HTTP 500` → {ok:false,error:'stop-failed' }
- `HTTP 400` → {ok:false,error:'missing-id' }
- `HTTP 400` → {ok:false,error:'missing-hero-id' }
- `HTTP 400` → {ok:false,error:'mob-pos-missing' }
- `HTTP 400` → {ok:false,error:'hero-pos-missing' }
- `HTTP 400` → {ok:false,error:result.message }
- `HTTP 500` → {ok:false,error:'hit-failed' }
- `HTTP 400` → {ok:false,error:'missing-hero-id' }
- `HTTP 404` → {ok:false,error:'hero-not-found' }
- `HTTP 409` → {ok:false,error:'hero-not-dead' }
- `HTTP 500` → {ok:false,error:'revive-failed' }

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

### POST /equip

Arquivo: `server\routes\equipment.js:50`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "const { heroId": 1,
  "slot": "value",
  "itemKey": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{
  "ok": true
}
```

**Erros conhecidos:**
- `HTTP 400` → {ok:false,error:'missing-params' }
- `HTTP 400` → {ok:false,error:'bad-slot' }
- `HTTP 404` → {ok:false,error:'hero-not-found' }
- `HTTP 404` → {ok:false,error:'no-such-item' }
- `HTTP 400` → {ok:false,error:'slot-mismatch' }
- `HTTP 400` → {ok:false,error:'no-stock' }
- `HTTP 500` → {ok:false,error:'equip-failed' }

### POST /gain/dev

Arquivo: `server\skills\routes.js:148`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "try {\n      const { heroId": 1,
  "heroClass": "value",
  "skillType": "value"
}
```

**Erros conhecidos:**
- `HTTP 400` → {error:'heroId e skillType são obrigatórios' }
- `HTTP 500` → {error:'Falha ao aplicar ganho' }

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

### POST /hit

Arquivo: `server\combat\routes.js:163`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "heroId": 1,
  "try {\n    const { heroId": 1
}
```

**Resposta de sucesso (amostra):**
```json
{ok:false,error:'no-weapon-equipped' }
```

**Erros conhecidos:**
- `HTTP 400` → {ok:false,error:'missing-id' }
- `HTTP 400` → {ok:false,error:'missing-hero-id' }
- `HTTP 400` → {ok:false,error:'mob-pos-missing' }
- `HTTP 400` → {ok:false,error:'hero-pos-missing' }
- `HTTP 400` → {ok:false,error:result.message }
- `HTTP 500` → {ok:false,error:'hit-failed' }
- `HTTP 400` → {ok:false,error:'missing-hero-id' }
- `HTTP 404` → {ok:false,error:'hero-not-found' }
- `HTTP 409` → {ok:false,error:'hero-not-dead' }
- `HTTP 500` → {ok:false,error:'revive-failed' }

### POST /login

Arquivo: `server\auth\routes.js:71`

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

Arquivo: `server\auth\routes.js:88`

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

### POST /loot/drop

Arquivo: `server\routes\loot.js:143`

_Sem payload inferido_

**Resposta de sucesso (amostra):**
```json
{ok:true,snapshot:{heroId,capacity:data.capacity,used:data.used,items:data.items,backpackKey:spec.key } }
```

**Erros conhecidos:**
- `HTTP 400` → {error:'bad-args' }
- `HTTP 400` → {error:'not-enough-qty' }
- `HTTP 500` → {error:'drop-failed' }
- `HTTP 500` → {error:'cache-stats-failed' }

### POST /loot/pickup

Arquivo: `server\routes\loot.js:85`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "try {\n    const { heroId": 1,
  "lootId": 1
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,snapshot:{heroId:String(heroId),capacity:data.capacity,used:data.used,items:data.items,backpackKey:spec2.key },placed,leftover }
```

**Erros conhecidos:**
- `HTTP 400` → {error:'bad-args' }
- `HTTP 400` → {error:'no-backpack' }
- `HTTP 404` → {error:'loot-not-found' }
- `HTTP 404` → {error:'loot-not-found' }
- `HTTP 500` → {error:'loot-pickup-failed' }
- `HTTP 400` → {error:'bad-args' }
- `HTTP 400` → {error:'not-enough-qty' }
- `HTTP 500` → {error:'drop-failed' }
- `HTTP 500` → {error:'cache-stats-failed' }

### POST /move

Arquivo: `server\routes\player.old.js:44`

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

Arquivo: `server\routes\player.old.js:23`

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

Arquivo: `server\auth\routes.js:35`

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

### POST /revive

Arquivo: `server\routes\revive.js:2`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "const { heroId": 1
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,heroId:hero.id,hp:hpOnRevive,map_key,x,y }
```

**Erros conhecidos:**
- `HTTP 400` → {ok:false,error:'missing-hero-id' }
- `HTTP 404` → {ok:false,error:'hero-not-found' }
- `HTTP 409` → {ok:false,error:'hero-not-dead' }

### POST /select

Arquivo: `server\starter\routes.js:104`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "const playerId = req.user.id;\n\n    try {\n      const { heroKey": 1
}
```

**Erros conhecidos:**
- `HTTP 400` → {error:'heroKey é obrigatório' }
- `HTTP 400` → {error:'starter já escolhido' }
- `HTTP 400` → {error:'heroKey inválido' }

## Tabela sintética de erros por rota

- **GET /**
  - HTTP 500: {ok:false,error:'inventory-failed',detail:String(e.message || e) }
- **GET /:heroId**
  - HTTP 500: {ok:false,error:'equipment-failed' }
  - HTTP 400: {ok:false,error:'missing-params' }
  - HTTP 400: {ok:false,error:'bad-slot' }
  - HTTP 404: {ok:false,error:'hero-not-found' }
  - HTTP 404: {ok:false,error:'no-such-item' }
  - HTTP 400: {ok:false,error:'slot-mismatch' }
  - HTTP 400: {ok:false,error:'no-stock' }
  - HTTP 500: {ok:false,error:'equip-failed' }
- **GET /:heroId/slots**
  - HTTP 400: {error:'heroId required' }
  - HTTP 500: {error:'backpack-list-failed' }
  - HTTP 400: {error:'bad-args' }
  - HTTP 500: {error:'backpack-deposit-failed' }
- **GET /_ping**
  - HTTP 400: {ok:false,error:'missing-params' }
  - HTTP 400: {ok:false,error:'mob-pos-missing' }
  - HTTP 400: {ok:false,error:'hero-pos-missing' }
  - HTTP 500: {ok:false,error:'start-failed' }
  - HTTP 404: {ok:false,error:'hero-not-found' }
  - HTTP 500: {ok:false,error:'stop-failed' }
  - HTTP 400: {ok:false,error:'missing-id' }
  - HTTP 400: {ok:false,error:'missing-hero-id' }
  - HTTP 400: {ok:false,error:'mob-pos-missing' }
  - HTTP 400: {ok:false,error:'hero-pos-missing' }
- **GET /_routes**
  - HTTP 400: {ok:false,error:'missing-params' }
  - HTTP 400: {ok:false,error:'mob-pos-missing' }
  - HTTP 400: {ok:false,error:'hero-pos-missing' }
  - HTTP 500: {ok:false,error:'start-failed' }
  - HTTP 404: {ok:false,error:'hero-not-found' }
  - HTTP 500: {ok:false,error:'stop-failed' }
  - HTTP 400: {ok:false,error:'missing-id' }
  - HTTP 400: {ok:false,error:'missing-hero-id' }
  - HTTP 400: {ok:false,error:'mob-pos-missing' }
  - HTTP 400: {ok:false,error:'hero-pos-missing' }
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
- **GET /api/combat/nearest**
  - HTTP 400: {error:'bad-coords' }
  - HTTP 404: {error:'no-alive' }
  - HTTP 404: {error:'no-intersect' }
  - HTTP 404: {error:'no-monster-in-radius' }
- **GET /api/csrf**
- **GET /assets/items**
  - HTTP 500: {error:"Falha ao listar items" }
- **GET /assets/sprites**
  - HTTP 500: {error:"Falha ao listar sprites" }
  - HTTP 500: {error:"Falha ao listar items" }
- **GET /cache/stats**
  - HTTP 500: {error:'cache-stats-failed' }
- **GET /class-rates**
  - HTTP 500: {error:'Falha ao listar rates' }
  - HTTP 400: {error:'heroId é obrigatório' }
  - HTTP 404: {error:'Herói não encontrado' }
  - HTTP 500: {error:'Falha ao listar skills do herói' }
  - HTTP 400: {error:'heroId é obrigatório' }
  - HTTP 404: {error:'Herói não encontrado' }
  - HTTP 500: {error:'Falha ao listar skills do herói' }
  - HTTP 400: {error:'heroId e skillType são obrigatórios' }
  - HTTP 500: {error:'Falha ao aplicar ganho' }
- **GET /curves**
  - HTTP 400: {error:'informe ?skill=SWORD|AXE|CLUB|DISTANCE|SHIELD|MAGIC',}
  - HTTP 500: {error:'Falha ao listar curvas' }
  - HTTP 500: {error:'Falha ao listar rates' }
  - HTTP 400: {error:'heroId é obrigatório' }
  - HTTP 404: {error:'Herói não encontrado' }
  - HTTP 500: {error:'Falha ao listar skills do herói' }
  - HTTP 400: {error:'heroId é obrigatório' }
  - HTTP 404: {error:'Herói não encontrado' }
  - HTTP 500: {error:'Falha ao listar skills do herói' }
  - HTTP 400: {error:'heroId e skillType são obrigatórios' }
  - HTTP 500: {error:'Falha ao aplicar ganho' }
- **GET /hero/:id**
  - HTTP 400: {error:'heroId é obrigatório' }
  - HTTP 404: {error:'Herói não encontrado' }
  - HTTP 500: {error:'Falha ao listar skills do herói' }
  - HTTP 400: {error:'heroId e skillType são obrigatórios' }
  - HTTP 500: {error:'Falha ao aplicar ganho' }
- **GET /heroes/master**
  - HTTP 500: {error:'Falha ao listar heróis' }
- **GET /list**
  - HTTP 500: {error:'erro ao listar starters' }
  - HTTP 500: {error:'erro ao checar status do starter' }
  - HTTP 400: {error:'heroKey é obrigatório' }
  - HTTP 400: {error:'starter já escolhido' }
  - HTTP 400: {error:'heroKey inválido' }
- **GET /map/:mapKey/loot**
  - HTTP 500: {error:'loot-list-failed' }
  - HTTP 400: {error:'bad-args' }
  - HTTP 400: {error:'no-backpack' }
  - HTTP 404: {error:'loot-not-found' }
  - HTTP 404: {error:'loot-not-found' }
  - HTTP 500: {error:'loot-pickup-failed' }
  - HTTP 400: {error:'bad-args' }
  - HTTP 400: {error:'not-enough-qty' }
  - HTTP 500: {error:'drop-failed' }
  - HTTP 500: {error:'cache-stats-failed' }
- **GET /me**
  - HTTP 400: {error:'heroId é obrigatório' }
  - HTTP 404: {error:'Herói não encontrado' }
  - HTTP 500: {error:'Falha ao listar skills do herói' }
  - HTTP 400: {error:'heroId é obrigatório' }
  - HTTP 404: {error:'Herói não encontrado' }
  - HTTP 500: {error:'Falha ao listar skills do herói' }
  - HTTP 400: {error:'heroId e skillType são obrigatórios' }
  - HTTP 500: {error:'Falha ao aplicar ganho' }
  - HTTP 500: {error:'me-failed' }
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
- **GET /tick**
- **POST /**
  - HTTP 400: {error:result.error,cost:SUMMON_COST_COINS }
  - HTTP 400: {error:r.error,cost:SUMMON_COST_COINS,pulls }
  - HTTP 500: {error:'Falha ao girar gacha' }
- **POST /:heroId/deposit**
  - HTTP 400: {error:'bad-args' }
  - HTTP 500: {error:'backpack-deposit-failed' }
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
- **POST /attack/start**
  - HTTP 400: {ok:false,error:'missing-params' }
  - HTTP 400: {ok:false,error:'mob-pos-missing' }
  - HTTP 400: {ok:false,error:'hero-pos-missing' }
  - HTTP 500: {ok:false,error:'start-failed' }
  - HTTP 404: {ok:false,error:'hero-not-found' }
  - HTTP 500: {ok:false,error:'stop-failed' }
  - HTTP 400: {ok:false,error:'missing-id' }
  - HTTP 400: {ok:false,error:'missing-hero-id' }
  - HTTP 400: {ok:false,error:'mob-pos-missing' }
  - HTTP 400: {ok:false,error:'hero-pos-missing' }
  - HTTP 400: {ok:false,error:result.message }
  - HTTP 500: {ok:false,error:'hit-failed' }
- **POST /attack/stop**
  - HTTP 404: {ok:false,error:'hero-not-found' }
  - HTTP 500: {ok:false,error:'stop-failed' }
  - HTTP 400: {ok:false,error:'missing-id' }
  - HTTP 400: {ok:false,error:'missing-hero-id' }
  - HTTP 400: {ok:false,error:'mob-pos-missing' }
  - HTTP 400: {ok:false,error:'hero-pos-missing' }
  - HTTP 400: {ok:false,error:result.message }
  - HTTP 500: {ok:false,error:'hit-failed' }
  - HTTP 400: {ok:false,error:'missing-hero-id' }
  - HTTP 404: {ok:false,error:'hero-not-found' }
  - HTTP 409: {ok:false,error:'hero-not-dead' }
  - HTTP 500: {ok:false,error:'revive-failed' }
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
- **POST /equip**
  - HTTP 400: {ok:false,error:'missing-params' }
  - HTTP 400: {ok:false,error:'bad-slot' }
  - HTTP 404: {ok:false,error:'hero-not-found' }
  - HTTP 404: {ok:false,error:'no-such-item' }
  - HTTP 400: {ok:false,error:'slot-mismatch' }
  - HTTP 400: {ok:false,error:'no-stock' }
  - HTTP 500: {ok:false,error:'equip-failed' }
- **POST /gain/dev**
  - HTTP 400: {error:'heroId e skillType são obrigatórios' }
  - HTTP 500: {error:'Falha ao aplicar ganho' }
- **POST /harvest**
  - HTTP 400: {error:'plot_id required' }
  - HTTP 404: {error:'plot_not_found' }
  - HTTP 400: {error:'empty_plot' }
  - HTTP 400: {error:'invalid_crop' }
  - HTTP 400: {error:'not_ripe',stage:s.stage,next_at:s.nextAt,progress_pct:s.progressPct }
  - HTTP 500: {error:'harvest_failed' }
  - HTTP 403: {error:'forbidden' }
  - HTTP 500: {error:'debug_grant_failed' }
- **POST /hit**
  - HTTP 400: {ok:false,error:'missing-id' }
  - HTTP 400: {ok:false,error:'missing-hero-id' }
  - HTTP 400: {ok:false,error:'mob-pos-missing' }
  - HTTP 400: {ok:false,error:'hero-pos-missing' }
  - HTTP 400: {ok:false,error:result.message }
  - HTTP 500: {ok:false,error:'hit-failed' }
  - HTTP 400: {ok:false,error:'missing-hero-id' }
  - HTTP 404: {ok:false,error:'hero-not-found' }
  - HTTP 409: {ok:false,error:'hero-not-dead' }
  - HTTP 500: {ok:false,error:'revive-failed' }
- **POST /login**
  - HTTP 401: {error:'Credenciais inválidas' }
  - HTTP 401: {error:'Credenciais inválidas' }
  - HTTP 500: {error:'Falha ao autenticar' }
  - HTTP 404: {error:'Jogador não encontrado' }
  - HTTP 500: {error:'Falha ao obter perfil' }
- **POST /logout**
  - HTTP 404: {error:'Jogador não encontrado' }
  - HTTP 500: {error:'Falha ao obter perfil' }
- **POST /loot/drop**
  - HTTP 400: {error:'bad-args' }
  - HTTP 400: {error:'not-enough-qty' }
  - HTTP 500: {error:'drop-failed' }
  - HTTP 500: {error:'cache-stats-failed' }
- **POST /loot/pickup**
  - HTTP 400: {error:'bad-args' }
  - HTTP 400: {error:'no-backpack' }
  - HTTP 404: {error:'loot-not-found' }
  - HTTP 404: {error:'loot-not-found' }
  - HTTP 500: {error:'loot-pickup-failed' }
  - HTTP 400: {error:'bad-args' }
  - HTTP 400: {error:'not-enough-qty' }
  - HTTP 500: {error:'drop-failed' }
  - HTTP 500: {error:'cache-stats-failed' }
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
- **POST /revive**
  - HTTP 400: {ok:false,error:'missing-hero-id' }
  - HTTP 404: {ok:false,error:'hero-not-found' }
  - HTTP 409: {ok:false,error:'hero-not-dead' }
  - HTTP 400: {ok:false,error:'missing-hero-id' }
  - HTTP 404: {ok:false,error:'hero-not-found' }
  - HTTP 409: {ok:false,error:'hero-not-dead' }
  - HTTP 500: {ok:false,error:'revive-failed' }
- **POST /select**
  - HTTP 400: {error:'heroKey é obrigatório' }
  - HTTP 400: {error:'starter já escolhido' }
  - HTTP 400: {error:'heroKey inválido' }
