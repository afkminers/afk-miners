# AFK Miners — API

## Variáveis de ambiente

- `AI_MOBS_DEBUG`
- `AI_MOBS_IGNORE_COLLISION`
- `AI_MOBS_IGNORE_LOS`
- `APP_ORIGIN`
- `APP_ORIGINS` (defaults: process.env.APP_ORIGIN)
- `ASSETS_CACHE_TTL_MS` (defaults: 300000)
- `BATTLE_COMBAT_TTL_MS` (defaults: 15000)
- `BATTLE_SAFE_GRACE_MS` (defaults: 5000)
- `CATALOG_CACHE_ENABLED`
- `CATALOG_CACHE_REFRESH_SEC` (defaults: 120)
- `CLICK_PICK_RADIUS_PX` (defaults: 192)
- `CLICK_REQUIRE_INTERSECT` (defaults: 1)
- `COMBAT_DEBUG` (defaults: )
- `COMBAT_HERO_POS_MAX_AGE_MS`
- `CONTENT_PIPELINE` (defaults: off)
- `COOKIE_DOMAIN` (defaults: )
- `COOKIE_NAME`
- `COOKIE_SAME_SITE`
- `COOKIE_SECURE`
- `CSRF_COOKIE` (defaults: csrf)
- `CSRF_DEBUG` (defaults: 0)
- `CTX_DEPTH` (defaults: 4)
- `CTX_IMPORTS`
- `CTX_SYMBOLS`
- `DATABASE_URL`
- `DB_IDLE_CLOSE_MINUTES` (defaults: 0)
- `DB_MIGRATE_DEBUG`
- `DB_SCHEMA`
- `DEBUG_CATALOG_CACHE`
- `DEBUG_COMBAT`
- `DEBUG_HTTP_CACHE`
- `DEBUG_LOOT_CACHE`
- `DM_NUDGE_COOLDOWN_MS` (defaults: 15_000)
- `DM_NUDGE_RATE_LIMIT` (defaults: 6)
- `DM_NUDGE_RATE_WINDOW_MS` (defaults: 60_000)
- `ENDPOINT_METRICS_INTERVAL_MS` (defaults: 60000)
- `ENDPOINT_METRICS_PROD`
- `ENDPOINT_METRICS_TOP_N` (defaults: 10)
- `FLUSH_POS_INTERVAL_MS` (defaults: 1000)
- `GEN_CONTEXT_ON_START`
- `IDLE_SCHEDULER_CHECK_MS` (defaults: 30000)
- `JSON_LIMIT` (defaults: 64kb)
- `JWT_SECRET` (defaults: changeme, CHANGE_ME_DEV_ONLY)
- `LIVE_POS_GC_MS` (defaults: STALE_MS)
- `LIVE_POS_STALE_MS` (defaults: (TTL_MS)
- `LIVE_POS_TTL_MS` (defaults: 1500)
- `LOOT_CACHE_ENABLED`
- `LOOT_CACHE_TTL_SEC` (defaults: 5)
- `LOOT_CLEANUP_EVERY_SECONDS` (defaults: 30)
- `LOOT_EXPIRE_SECONDS` (defaults: 120)
- `MONSTER_AGGRO_LOSS_MS` (defaults: 6000)
- `MONSTER_AGGRO_PERSIST_BONUS` (defaults: 1.5)
- `MONSTER_AGGRO_SWITCH_DELTA` (defaults: 2)
- `MONSTER_ATK_COOLDOWN_MS` (defaults: 900)
- `MONSTER_ATK_MODE` (defaults: )
- `MONSTER_ATK_TICK_MS` (defaults: 150)
- `MONSTER_BASE_DMG_MAX` (defaults: 12)
- `MONSTER_BASE_DMG_MIN` (defaults: 6)
- `MONSTER_CHASE_INSIDE_SPAWN_ONLY` (defaults: 0)
- `MONSTER_CHASE_MAX_TILES` (defaults: 25)
- `MONSTER_DETECTION_RADIUS_TILES` (defaults: 8)
- `MONSTER_HERO_PREDICTION_MAX_TILES` (defaults: 2)
- `MONSTER_MAX_PER_TICK` (defaults: 40)
- `MONSTER_OVERLAP_PX_EPS` (defaults: Math.round(TILE)
- `MONSTER_PATROL_INTERVAL_MS` (defaults: 4500)
- `MONSTER_PATROL_RADIUS_TILES` (defaults: 6)
- `MONSTER_PATROL_STEP_MS` (defaults: 950)
- `MONSTER_PATROL_TARGET_TTL_MS` (defaults: 12000)
- `MONSTER_PERSIST_POS_MS` (defaults: 1000)
- `MONSTER_RANGE_PX_TOLERANCE` (defaults: Math.round(TILE)
- `MONSTER_STACK_RESOLVE_DEPTH` (defaults: 6)
- `MONSTER_STEP_BACKTRACK_PENALTY` (defaults: 2)
- `MONSTER_STEP_MS` (defaults: 150)
- `MONSTER_STEP_SEARCH_DEPTH` (defaults: 4)
- `NODE_ENV` (defaults: development)
- `OPENAI_API_KEY`
- `PG_DUMP_PATH`
- `PGSSLMODE`
- `PORT` (defaults: 3000)
- `PRESENCE_GRACE_MS` (defaults: 5000)
- `PRESENCE_TTL_SECONDS` (defaults: 60)
- `PRESENCE_UPDATE_INTERVAL_MS` (defaults: 30000)
- `REDIS_URL` (defaults: null)
- `RESPAWN_DEBUG` (defaults: )
- `RESPAWN_RETRY_DELAY_MS` (defaults: 1000)
- `RESPAWN_TICK_MS` (defaults: 5000)
- `RESPAWN_TILE_SEARCH_RADIUS` (defaults: 6)
- `SESSION_COOKIE_NAME` (defaults: process.env.COOKIE_NAME)
- `SKIP_MIGRATIONS_ON_BOOT`
- `START_MAP_KEY` (defaults: house)
- `START_POS_X`
- `START_POS_Y`
- `STEP_LAG_TOLERANCE_MS` (defaults: 90)
- `STEP_MIN_RATIO`
- `SYNC_SPAWNS_INTERVAL_MS` (defaults: 300000)

## Endpoints

### DELETE /:friendId

Arquivo: `server\routes\friends.js:312`

**Payloads (exemplos inferidos):**
- params:
```json
{
  "friendId": 1
}
```
- query:
```json
{
  "limit": 1,
  "before": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{
  "ok": true
}
```

**Erros conhecidos:**
- `HTTP 500` → {error:'FRIEND_REMOVE_FAILED' }
- `HTTP 500` → {error:'FRIEND_BLOCK_FAILED' }
- `HTTP 500` → {error:'FRIEND_UNBLOCK_FAILED' }
- `HTTP 500` → {error:'DM_HISTORY_FAILED' }

### GET /

Arquivo: `server\index.js:786`

_Sem payload inferido_

### GET /:friendId/dms

Arquivo: `server\routes\friends.js:387`

**Payloads (exemplos inferidos):**
- params:
```json
{
  "friendId": 1
}
```
- query:
```json
{
  "limit": 1,
  "before": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,messages,nextCursor,unreadCount }
```

**Erros conhecidos:**
- `HTTP 500` → {error:'DM_HISTORY_FAILED' }

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

Arquivo: `server\combat\routes.js:137`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "try {\n    const { heroId": 1,
  "targetInstanceId": 1,
  "const { heroId": 1
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
- `HTTP 400` → {ok:false,error:'missing-params',message:'Herói e monstro são obrigatórios.' }
- `HTTP 404` → {ok:false,error:'monster-not-found',message:'Monstro não encontrado.' }

### GET /_routes

Arquivo: `server\combat\routes.js:138`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "try {\n    const { heroId": 1,
  "targetInstanceId": 1,
  "const { heroId": 1
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
- `HTTP 400` → {ok:false,error:'missing-params',message:'Herói e monstro são obrigatórios.' }
- `HTTP 404` → {ok:false,error:'monster-not-found',message:'Monstro não encontrado.' }

### GET /admin

Arquivo: `server\index.js:800`

_Sem payload inferido_

### GET /api/admin/content/map/:key/data

Arquivo: `server\index.js:723`

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

Arquivo: `server\index.js:698`

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

Arquivo: `server\index.js:710`

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

Arquivo: `server\index.js:687`

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

Arquivo: `server\index.js:579`

**Payloads (exemplos inferidos):**
- query:
```json
{
  "map": "value"
}
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

### GET /api/assets/items

Arquivo: `server\index.js:590`

**Payloads (exemplos inferidos):**
- query:
```json
{
  "map": "value"
}
```

**Erros conhecidos:**
- `HTTP 500` → {error:err.message }
- `HTTP 500` → {error:err.message }
- `HTTP 500` → {error:err.message }
- `HTTP 500` → {error:err.message }
- `HTTP 500` → {error:err.message }
- `HTTP 404` → {error:'map not found' }
- `HTTP 500` → {error:err.message }

### GET /api/assets/sprites

Arquivo: `server\index.js:612`

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

Arquivo: `server\index.js:1562`

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
  "mapKey": "value",
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

Arquivo: `server\index.js:222`

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

### GET /health

Arquivo: `server\routes\leaderboard.js:55`

**Payloads (exemplos inferidos):**
- query:
```json
{
  "limit": 1,
  "offset": 1,
  "query": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{
  "ok": true
}
```

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

### GET /heroes

Arquivo: `server\routes\leaderboard.js:220`

**Payloads (exemplos inferidos):**
- query:
```json
{
  "limit": 1,
  "offset": 1,
  "query": "value",
  "skill": "value"
}
```

**Erros conhecidos:**
- `HTTP 500` → {error:'unable to load heroes leaderboard' }
- `HTTP 400` → {error:'skill not available' }
- `HTTP 500` → {error:'unable to load skills leaderboard' }

### GET /heroes/master

Arquivo: `server\routes\catalog.js:10`

_Sem payload inferido_

**Erros conhecidos:**
- `HTTP 500` → {error:'Falha ao listar heróis' }

### GET /leaderboard

Arquivo: `server\index.js:782`

_Sem payload inferido_

### GET /list

Arquivo: `server\starter\routes.js:43`

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

### GET /overview

Arquivo: `server\index.js:770`

_Sem payload inferido_

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

### GET /players

Arquivo: `server\routes\leaderboard.js:139`

**Payloads (exemplos inferidos):**
- query:
```json
{
  "limit": 1,
  "offset": 1,
  "query": "value",
  "skill": "value"
}
```

**Erros conhecidos:**
- `HTTP 500` → {error:'unable to load players leaderboard' }
- `HTTP 500` → {error:'unable to load heroes leaderboard' }
- `HTTP 400` → {error:'skill not available' }

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

### GET /roadmap

Arquivo: `server\index.js:774`

_Sem payload inferido_

### GET /skills

Arquivo: `server\routes\leaderboard.js:275`

**Payloads (exemplos inferidos):**
- query:
```json
{
  "limit": 1,
  "offset": 1,
  "query": "value",
  "skill": "value"
}
```

**Erros conhecidos:**
- `HTTP 400` → {error:'skill not available' }
- `HTTP 500` → {error:'unable to load skills leaderboard' }

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

Arquivo: `server\starter\routes.js:87`

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

### GET /support

Arquivo: `server\index.js:778`

_Sem payload inferido_

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

Arquivo: `server\routes\presence.js:37`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "const me = req.user && req.user.id;\n  const { status": 1,
  "activity": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,status:row?.status || 'ONLINE',activity:row?.activity || 'HOUSE' }
```

**Erros conhecidos:**
- `HTTP 400` → {ok:false,error:'INVALID_STATUS' }
- `HTTP 400` → {ok:false,error:'INVALID_ACTIVITY' }
- `HTTP 500` → {ok:false,error:'PRESENCE_UPDATE_FAILED' }

### POST /:friendId/accept

Arquivo: `server\routes\friends.js:257`

**Payloads (exemplos inferidos):**
- params:
```json
{
  "friendId": 1
}
```
- query:
```json
{
  "limit": 1,
  "before": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,friendship }
```

**Erros conhecidos:**
- `HTTP 500` → {error:'FRIEND_ACCEPT_FAILED' }
- `HTTP 500` → {error:'FRIEND_REJECT_FAILED' }
- `HTTP 500` → {error:'FRIEND_REMOVE_FAILED' }
- `HTTP 500` → {error:'FRIEND_BLOCK_FAILED' }
- `HTTP 500` → {error:'FRIEND_UNBLOCK_FAILED' }

### POST /:friendId/block

Arquivo: `server\routes\friends.js:331`

**Payloads (exemplos inferidos):**
- params:
```json
{
  "friendId": 1
}
```
- query:
```json
{
  "limit": 1,
  "before": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,friendship }
```

**Erros conhecidos:**
- `HTTP 500` → {error:'FRIEND_BLOCK_FAILED' }
- `HTTP 500` → {error:'FRIEND_UNBLOCK_FAILED' }
- `HTTP 500` → {error:'DM_HISTORY_FAILED' }

### POST /:friendId/reject

Arquivo: `server\routes\friends.js:290`

**Payloads (exemplos inferidos):**
- params:
```json
{
  "friendId": 1
}
```
- query:
```json
{
  "limit": 1,
  "before": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{
  "ok": true
}
```

**Erros conhecidos:**
- `HTTP 500` → {error:'FRIEND_REJECT_FAILED' }
- `HTTP 500` → {error:'FRIEND_REMOVE_FAILED' }
- `HTTP 500` → {error:'FRIEND_BLOCK_FAILED' }
- `HTTP 500` → {error:'FRIEND_UNBLOCK_FAILED' }
- `HTTP 500` → {error:'DM_HISTORY_FAILED' }

### POST /:friendId/unblock

Arquivo: `server\routes\friends.js:365`

**Payloads (exemplos inferidos):**
- params:
```json
{
  "friendId": 1
}
```
- query:
```json
{
  "limit": 1,
  "before": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{
  "ok": true
}
```

**Erros conhecidos:**
- `HTTP 500` → {error:'FRIEND_UNBLOCK_FAILED' }
- `HTTP 500` → {error:'DM_HISTORY_FAILED' }

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

Arquivo: `server\index.js:733`

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

Arquivo: `server\index.js:1585`

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

Arquivo: `server\combat\routes.js:181`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "toTileX": "value",
  "toTileY": "value",
  "try {\n    const { heroId": 1,
  "targetInstanceId": 1,
  "const { heroId": 1
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
- `HTTP 400` → {ok:false,error:'missing-params',message:'Herói e monstro são obrigatórios.' }
- `HTTP 404` → {ok:false,error:'monster-not-found',message:'Monstro não encontrado.' }
- `HTTP 409` → {ok:false,error:'monster-dead',message:'O monstro não está ativo.' }
- `HTTP 400` → {ok:false,error:'hero-pos-missing',message:'Posição do herói indisponível.' }
- `HTTP 400` → {ok:false,error:'map-diff',message:'Você está em outro mapa.' }
- `HTTP 409` → {ok:false,error:'hero-too-far',message:'Você está longe demais do monstro.' }

### POST /attack/stop

Arquivo: `server\combat\routes.js:463`

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

Arquivo: `server\combat\routes.js:482`

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

### POST /push

Arquivo: `server\combat\routes.js:269`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "toTileX": "value",
  "toTileY": "value",
  "const { heroId": 1,
  "targetInstanceId": 1
}
```

**Resposta de sucesso (amostra):**
```json
{ok:false,error:'monster-not-pushable',message:'Este monstro não pode ser empurrado.' }
```

**Erros conhecidos:**
- `HTTP 400` → {ok:false,error:'missing-params',message:'Herói e monstro são obrigatórios.' }
- `HTTP 404` → {ok:false,error:'monster-not-found',message:'Monstro não encontrado.' }
- `HTTP 409` → {ok:false,error:'monster-dead',message:'O monstro não está ativo.' }
- `HTTP 400` → {ok:false,error:'hero-pos-missing',message:'Posição do herói indisponível.' }
- `HTTP 400` → {ok:false,error:'map-diff',message:'Você está em outro mapa.' }
- `HTTP 409` → {ok:false,error:'hero-too-far',message:'Você está longe demais do monstro.' }
- `HTTP 400` → {ok:false,error:'invalid-target',message:'Destino inválido para o empurrão.' }
- `HTTP 400` → {ok:false,error:'invalid-target',message:'Escolha um SQM adjacente.' }
- `HTTP 409` → {ok:false,error:'same-tile',message:'O monstro já está nesse local.' }
- `HTTP 409` → {ok:false,error:'tile-occupied-hero',message:'Você está bloqueando esse SQM.' }
- `HTTP 409` → {ok:false,error:'tile-out-of-bounds',message:'Destino fora do mapa.' }
- `HTTP 409` → {ok:false,error:'tile-solid',message:'Esse SQM está bloqueado.' }
- `HTTP 409` → {ok:false,error:'tile-occupied-monster',message:'Outro monstro bloqueia esse SQM.' }

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

### POST /request

Arquivo: `server\routes\friends.js:215`

_Sem payload inferido_

**Resposta de sucesso (amostra):**
```json
{ok:true,friendship }
```

**Erros conhecidos:**
- `HTTP 500` → {error:'FRIEND_REQUEST_FAILED' }
- `HTTP 500` → {error:'FRIEND_ACCEPT_FAILED' }
- `HTTP 500` → {error:'FRIEND_REJECT_FAILED' }
- `HTTP 500` → {error:'FRIEND_REMOVE_FAILED' }
- `HTTP 500` → {error:'FRIEND_BLOCK_FAILED' }

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

Arquivo: `server\starter\routes.js:105`

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

### POST /ticket

Arquivo: `server\routes\support.js:25`

_Sem payload inferido_

**Resposta de sucesso (amostra):**
```json
{ok:true,ticketId:id }
```

**Erros conhecidos:**
- `HTTP 400` → {error:'missing-fields' }
- `HTTP 422` → {error:'invalid-email' }
- `HTTP 500` → {error:'ticket-create-failed' }

## Tabela sintética de erros por rota

- **DELETE /:friendId**
  - HTTP 500: {error:'FRIEND_REMOVE_FAILED' }
  - HTTP 500: {error:'FRIEND_BLOCK_FAILED' }
  - HTTP 500: {error:'FRIEND_UNBLOCK_FAILED' }
  - HTTP 500: {error:'DM_HISTORY_FAILED' }
- **GET /**
  - HTTP 500: {ok:false,error:'inventory-failed',detail:String(e.message || e) }
  - HTTP 500: {error:'FRIEND_LIST_FAILED' }
  - HTTP 500: {error:'FRIEND_REQUEST_FAILED' }
  - HTTP 500: {error:'FRIEND_ACCEPT_FAILED' }
  - HTTP 500: {error:'FRIEND_REJECT_FAILED' }
  - HTTP 500: {error:'FRIEND_REMOVE_FAILED' }
- **GET /:friendId/dms**
  - HTTP 500: {error:'DM_HISTORY_FAILED' }
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
  - HTTP 400: {ok:false,error:'missing-params',message:'Herói e monstro são obrigatórios.' }
  - HTTP 404: {ok:false,error:'monster-not-found',message:'Monstro não encontrado.' }
- **GET /_routes**
  - HTTP 400: {ok:false,error:'missing-params' }
  - HTTP 400: {ok:false,error:'mob-pos-missing' }
  - HTTP 400: {ok:false,error:'hero-pos-missing' }
  - HTTP 500: {ok:false,error:'start-failed' }
  - HTTP 400: {ok:false,error:'missing-params',message:'Herói e monstro são obrigatórios.' }
  - HTTP 404: {ok:false,error:'monster-not-found',message:'Monstro não encontrado.' }
- **GET /admin**
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
- **GET /api/assets/items**
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 404: {error:'map not found' }
  - HTTP 500: {error:err.message }
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
- **GET /health**
- **GET /hero/:id**
  - HTTP 400: {error:'heroId é obrigatório' }
  - HTTP 404: {error:'Herói não encontrado' }
  - HTTP 500: {error:'Falha ao listar skills do herói' }
  - HTTP 400: {error:'heroId e skillType são obrigatórios' }
  - HTTP 500: {error:'Falha ao aplicar ganho' }
- **GET /heroes**
  - HTTP 500: {error:'unable to load heroes leaderboard' }
  - HTTP 400: {error:'skill not available' }
  - HTTP 500: {error:'unable to load skills leaderboard' }
- **GET /heroes/master**
  - HTTP 500: {error:'Falha ao listar heróis' }
- **GET /leaderboard**
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
  - HTTP 500: {ok:false,error:'PRESENCE_FETCH_FAILED' }
  - HTTP 400: {ok:false,error:'INVALID_STATUS' }
  - HTTP 400: {ok:false,error:'INVALID_ACTIVITY' }
  - HTTP 500: {ok:false,error:'PRESENCE_UPDATE_FAILED' }
  - HTTP 500: {error:'me-failed' }
  - HTTP 404: {error:'Jogador não encontrado' }
  - HTTP 500: {error:'Falha ao obter perfil' }
- **GET /overview**
- **GET /ping**
  - HTTP 500: {error:'afk_state_failed' }
  - HTTP 400: {error:'produce_type required' }
  - HTTP 500: {error:'create_worker_failed' }
  - HTTP 400: {error:'worker_id required' }
  - HTTP 404: {error:'worker_not_found' }
  - HTTP 404: {error:'box_not_found' }
  - HTTP 500: {error:'assign_failed' }
  - HTTP 500: {error:'collect_failed' }
- **GET /players**
  - HTTP 500: {error:'unable to load players leaderboard' }
  - HTTP 500: {error:'unable to load heroes leaderboard' }
  - HTTP 400: {error:'skill not available' }
- **GET /pos**
  - HTTP 400: {error:'coords inválidas' }
  - HTTP 409: {error:'old-seq' }
  - HTTP 400: {error:'too-fast' }
- **GET /roadmap**
- **GET /skills**
  - HTTP 400: {error:'skill not available' }
  - HTTP 500: {error:'unable to load skills leaderboard' }
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
- **GET /support**
- **GET /tick**
- **POST /**
  - HTTP 400: {ok:false,error:'INVALID_STATUS' }
  - HTTP 400: {ok:false,error:'INVALID_ACTIVITY' }
  - HTTP 500: {ok:false,error:'PRESENCE_UPDATE_FAILED' }
  - HTTP 400: {error:result.error,cost:SUMMON_COST_COINS }
  - HTTP 400: {error:r.error,cost:SUMMON_COST_COINS,pulls }
  - HTTP 500: {error:'Falha ao girar gacha' }
- **POST /:friendId/accept**
  - HTTP 500: {error:'FRIEND_ACCEPT_FAILED' }
  - HTTP 500: {error:'FRIEND_REJECT_FAILED' }
  - HTTP 500: {error:'FRIEND_REMOVE_FAILED' }
  - HTTP 500: {error:'FRIEND_BLOCK_FAILED' }
  - HTTP 500: {error:'FRIEND_UNBLOCK_FAILED' }
- **POST /:friendId/block**
  - HTTP 500: {error:'FRIEND_BLOCK_FAILED' }
  - HTTP 500: {error:'FRIEND_UNBLOCK_FAILED' }
  - HTTP 500: {error:'DM_HISTORY_FAILED' }
- **POST /:friendId/reject**
  - HTTP 500: {error:'FRIEND_REJECT_FAILED' }
  - HTTP 500: {error:'FRIEND_REMOVE_FAILED' }
  - HTTP 500: {error:'FRIEND_BLOCK_FAILED' }
  - HTTP 500: {error:'FRIEND_UNBLOCK_FAILED' }
  - HTTP 500: {error:'DM_HISTORY_FAILED' }
- **POST /:friendId/unblock**
  - HTTP 500: {error:'FRIEND_UNBLOCK_FAILED' }
  - HTTP 500: {error:'DM_HISTORY_FAILED' }
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
  - HTTP 400: {ok:false,error:'missing-params',message:'Herói e monstro são obrigatórios.' }
  - HTTP 404: {ok:false,error:'monster-not-found',message:'Monstro não encontrado.' }
  - HTTP 409: {ok:false,error:'monster-dead',message:'O monstro não está ativo.' }
  - HTTP 400: {ok:false,error:'hero-pos-missing',message:'Posição do herói indisponível.' }
  - HTTP 400: {ok:false,error:'map-diff',message:'Você está em outro mapa.' }
  - HTTP 409: {ok:false,error:'hero-too-far',message:'Você está longe demais do monstro.' }
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
- **POST /push**
  - HTTP 400: {ok:false,error:'missing-params',message:'Herói e monstro são obrigatórios.' }
  - HTTP 404: {ok:false,error:'monster-not-found',message:'Monstro não encontrado.' }
  - HTTP 409: {ok:false,error:'monster-dead',message:'O monstro não está ativo.' }
  - HTTP 400: {ok:false,error:'hero-pos-missing',message:'Posição do herói indisponível.' }
  - HTTP 400: {ok:false,error:'map-diff',message:'Você está em outro mapa.' }
  - HTTP 409: {ok:false,error:'hero-too-far',message:'Você está longe demais do monstro.' }
  - HTTP 400: {ok:false,error:'invalid-target',message:'Destino inválido para o empurrão.' }
  - HTTP 400: {ok:false,error:'invalid-target',message:'Escolha um SQM adjacente.' }
  - HTTP 409: {ok:false,error:'same-tile',message:'O monstro já está nesse local.' }
  - HTTP 409: {ok:false,error:'tile-occupied-hero',message:'Você está bloqueando esse SQM.' }
  - HTTP 409: {ok:false,error:'tile-out-of-bounds',message:'Destino fora do mapa.' }
  - HTTP 409: {ok:false,error:'tile-solid',message:'Esse SQM está bloqueado.' }
  - HTTP 409: {ok:false,error:'tile-occupied-monster',message:'Outro monstro bloqueia esse SQM.' }
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
- **POST /request**
  - HTTP 500: {error:'FRIEND_REQUEST_FAILED' }
  - HTTP 500: {error:'FRIEND_ACCEPT_FAILED' }
  - HTTP 500: {error:'FRIEND_REJECT_FAILED' }
  - HTTP 500: {error:'FRIEND_REMOVE_FAILED' }
  - HTTP 500: {error:'FRIEND_BLOCK_FAILED' }
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
- **POST /ticket**
  - HTTP 400: {error:'missing-fields' }
  - HTTP 422: {error:'invalid-email' }
  - HTTP 500: {error:'ticket-create-failed' }
