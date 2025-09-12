# AFK Miners — API

## Variáveis de ambiente

### Core Environment Variables

- `DATABASE_URL` — PostgreSQL connection string. **Use Neon `-pooler` endpoint** with `sslmode=require` and set `application_name` for metrics.
- `DB_IDLE_CLOSE_MINUTES` (defaults: 0) — When > 0, enables idle pool closer to allow Neon scale-to-zero on inactivity.
- `STATIC_CACHE_SECONDS` (defaults: 300–600 in prod) — TTL for in-memory HTTP cache on static/catalog endpoints.
- `SYNC_SPAWNS_INTERVAL_MS` (defaults: 300000 = 5 min) — Interval for spawn sync loop; must be idle-aware.
- `MIGRATE_ON_BOOT` (defaults: "1") — Set to "0" to skip migrations on boot (prod-friendly).
- `JWT_SECRET` — JWT signing secret (defaults: changeme, CHANGE_ME_DEV_ONLY)
- `SESSION_COOKIE_NAME` or `COOKIE_NAME` — Session cookie name
- `REDIS_URL` (optional) — Enables chat pub/sub between instances

### Optimization Variables

- `APP_ORIGIN`
- `APP_ORIGINS` (defaults: process.env.APP_ORIGIN)
- `CATALOG_CACHE_ENABLED`
- `CATALOG_CACHE_REFRESH_SEC` (defaults: 120)
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
- `DEBUG_CATALOG_CACHE`
- `ENDPOINT_METRICS_INTERVAL_MS` (defaults: 60000)
- `ENDPOINT_METRICS_PROD`
- `ENDPOINT_METRICS_TOP_N` (defaults: 10)
- `GEN_CONTEXT_ON_START`
- `LOOT_CLEANUP_EVERY_SECONDS` (defaults: 30)
- `LOOT_EXPIRE_SECONDS` (defaults: 120)
- `NODE_ENV` (defaults: development)
- `PG_DUMP_PATH`
- `PG_IDLE` (defaults: 30000)
- `PGDATABASE` (defaults: postgres)
- `PGHOST` (defaults: localhost)
- `PGPASSWORD` (defaults: )
- `PGPOOL_MAX` (defaults: 10)
- `PGPORT` (defaults: 5432)
- `PGSSL`
- `PGUSER` (defaults: postgres)
- `PORT` (defaults: 3000)
- `RESPAWN_DEBUG` (defaults: )
- `RESPAWN_TICK_MS` (defaults: 5000)
- `SKILL_TRY_PER_HIT` (defaults: 1)

## Operational Notes for Neon

### Database Connection
- Always use the **pooled endpoint** (`-pooler`) for better connection management
- Set `sslmode=require` and include `application_name=afk-miners` for monitoring
- Example: `postgresql://user:pass@ep-name-pooler.region.aws.neon.tech/db?sslmode=require&application_name=afk-miners`

### Scale-to-Zero Configuration
- Set `DB_IDLE_CLOSE_MINUTES=15` (or higher) to enable automatic pool closing
- Background loops (spawn sync, loot cleanup) are idle-aware and stop during inactivity
- Pool automatically reopens on first HTTP/WS request after idle period

### Performance Optimizations
- ETag/304 caching on `/api/assets/items` and `/api/assets/sprites`
- In-memory catalog cache with configurable TTL
- Endpoint metrics tracking for optimization insights

## Endpoints

### GET /

Arquivo: `server\index.js:491`

_Sem payload inferido_

### GET /:heroId

Arquivo: `server\routes\equipment.js:11`

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
- query:
```json
{
  "map": "value",
  "x": "value",
  "y": "value",
  "px": "value",
  "py": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,ts:Date.now() }
```

**Erros conhecidos:**
- `HTTP 200` → {ok:false,error:'too-far-click' }

### GET /_routes

Arquivo: `server\combat\routes.js:39`

**Payloads (exemplos inferidos):**
- query:
```json
{
  "map": "value",
  "x": "value",
  "y": "value",
  "px": "value",
  "py": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{routes:list }
```

**Erros conhecidos:**
- `HTTP 200` → {ok:false,error:'too-far-click' }

### GET /api/admin/content/map/:key/data

Arquivo: `server\index.js:460`

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

Arquivo: `server\index.js:435`

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

Arquivo: `server\index.js:447`

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

Arquivo: `server\index.js:424`

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

Arquivo: `server\index.js:394`

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

Arquivo: `server\index.js:405`

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

Arquivo: `server\index.js:414`

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

Arquivo: `server\index.js:768`

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

Arquivo: `server\routes\combat_nearest.js:28`

**Payloads (exemplos inferidos):**
- query:
```json
{
  "map": "value",
  "x": "value",
  "y": "value",
  "px": "value",
  "py": "value"
}
```

**Erros conhecidos:**
- `HTTP 400` → {error:'bad-coords' }
- `HTTP 404` → {error:'no-alive' }
- `HTTP 404` → {error:'no-alive' }

### GET /api/csrf

Arquivo: `server\index.js:81`

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

Arquivo: `server\starter\routes.js:56`

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

Arquivo: `server\routes\loot.js:62`

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

### GET /nearest

Arquivo: `server\combat\routes.js:184`

**Payloads (exemplos inferidos):**
- query:
```json
{
  "map": "value",
  "x": "value",
  "y": "value",
  "px": "value",
  "py": "value"
}
```
- body:
```json
{
  "heroId": 1,
  "weaponType": "value",
  "try {\n    const { heroId": 1,
  "targetInstanceId": 1
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,id:String(row.id),x:mx,y:my,hp:Number(row.hp),maxHp:Number(row.max_hp),monsterKey:row.monsterKey }
```

**Erros conhecidos:**
- `HTTP 200` → {ok:false,error:'too-far-click' }
- `HTTP 404` → {ok:false,error:'no-monster' }
- `HTTP 404` → {ok:false,error:'no-monster-in-radius' }
- `HTTP 500` → {ok:false,error:'nearest-failed' }
- `HTTP 400` → {ok:false,error:'missing-params' }
- `HTTP 400` → {ok:false,error:'mob-pos-missing' }
- `HTTP 400` → {ok:false,error:'hero-pos-missing' }
- `HTTP 500` → {ok:false,error:'start-failed' }
- `HTTP 500` → {ok:false,error:'stop-failed' }
- `HTTP 400` → {ok:false,error:'missing-id' }

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

Arquivo: `server\starter\routes.js:101`

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

Arquivo: `server\index.js:470`

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

Arquivo: `server\index.js:791`

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

Arquivo: `server\combat\routes.js:246`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "heroId": 1,
  "weaponType": "value",
  "damage": "value",
  "try {\n    const { heroId": 1,
  "targetInstanceId": 1
}
```

**Resposta de sucesso (amostra):**
```json
{ok:false,error:'map-diff' }
```

**Erros conhecidos:**
- `HTTP 400` → {ok:false,error:'missing-params' }
- `HTTP 400` → {ok:false,error:'mob-pos-missing' }
- `HTTP 400` → {ok:false,error:'hero-pos-missing' }
- `HTTP 500` → {ok:false,error:'start-failed' }
- `HTTP 500` → {ok:false,error:'stop-failed' }
- `HTTP 400` → {ok:false,error:'missing-id' }
- `HTTP 400` → {ok:false,error:'bad-id' }
- `HTTP 404` → {ok:false,error:'no-such-alive' }

### POST /attack/stop

Arquivo: `server\combat\routes.js:281`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "heroId": 1,
  "weaponType": "value",
  "damage": "value",
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
- `HTTP 500` → {ok:false,error:'stop-failed' }
- `HTTP 400` → {ok:false,error:'missing-id' }
- `HTTP 400` → {ok:false,error:'bad-id' }
- `HTTP 404` → {ok:false,error:'no-such-alive' }

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

Arquivo: `server\routes\equipment.js:30`

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

Arquivo: `server\combat\routes.js:321`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "heroId": 1,
  "weaponType": "value",
  "damage": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,id:mi.id,dmg:DMG,hp,maxHp:Number(mi.max_hp)||0,dead }
```

**Erros conhecidos:**
- `HTTP 400` → {ok:false,error:'missing-id' }
- `HTTP 400` → {ok:false,error:'bad-id' }
- `HTTP 404` → {ok:false,error:'no-such-alive' }
- `HTTP 500` → {ok:false,error:'hit-failed' }

### POST /login

Arquivo: `server\auth\routes.js:70`

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

Arquivo: `server\auth\routes.js:87`

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

Arquivo: `server\routes\loot.js:123`

_Sem payload inferido_

**Resposta de sucesso (amostra):**
```json
{ok:true,snapshot:{heroId,capacity:data.capacity,used:data.used,items:data.items,backpackKey:spec.key } }
```

**Erros conhecidos:**
- `HTTP 400` → {error:'bad-args' }
- `HTTP 400` → {error:'not-enough-qty' }
- `HTTP 500` → {error:'drop-failed' }

### POST /loot/pickup

Arquivo: `server\routes\loot.js:74`

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

Arquivo: `server\auth\routes.js:34`

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

Arquivo: `server\starter\routes.js:120`

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
  - HTTP 200: {ok:false,error:'too-far-click' }
- **GET /_routes**
  - HTTP 200: {ok:false,error:'too-far-click' }
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
  - HTTP 404: {error:'no-alive' }
- **GET /api/csrf**
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
- **GET /nearest**
  - HTTP 200: {ok:false,error:'too-far-click' }
  - HTTP 404: {ok:false,error:'no-monster' }
  - HTTP 404: {ok:false,error:'no-monster-in-radius' }
  - HTTP 500: {ok:false,error:'nearest-failed' }
  - HTTP 400: {ok:false,error:'missing-params' }
  - HTTP 400: {ok:false,error:'mob-pos-missing' }
  - HTTP 400: {ok:false,error:'hero-pos-missing' }
  - HTTP 500: {ok:false,error:'start-failed' }
  - HTTP 500: {ok:false,error:'stop-failed' }
  - HTTP 400: {ok:false,error:'missing-id' }
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
  - HTTP 500: {ok:false,error:'stop-failed' }
  - HTTP 400: {ok:false,error:'missing-id' }
  - HTTP 400: {ok:false,error:'bad-id' }
  - HTTP 404: {ok:false,error:'no-such-alive' }
- **POST /attack/stop**
  - HTTP 500: {ok:false,error:'stop-failed' }
  - HTTP 400: {ok:false,error:'missing-id' }
  - HTTP 400: {ok:false,error:'bad-id' }
  - HTTP 404: {ok:false,error:'no-such-alive' }
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
  - HTTP 400: {ok:false,error:'bad-id' }
  - HTTP 404: {ok:false,error:'no-such-alive' }
  - HTTP 500: {ok:false,error:'hit-failed' }
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
- **POST /loot/pickup**
  - HTTP 400: {error:'bad-args' }
  - HTTP 400: {error:'no-backpack' }
  - HTTP 404: {error:'loot-not-found' }
  - HTTP 404: {error:'loot-not-found' }
  - HTTP 500: {error:'loot-pickup-failed' }
  - HTTP 400: {error:'bad-args' }
  - HTTP 400: {error:'not-enough-qty' }
  - HTTP 500: {error:'drop-failed' }
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
