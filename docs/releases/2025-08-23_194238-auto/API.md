# AFK Miners — API

## Variáveis de ambiente

- `CONTENT_PIPELINE` (defaults: off)
- `COOKIE_DOMAIN` (defaults: undefined)
- `COOKIE_NAME` (defaults: sid)
- `COOKIE_SAME_SITE` (defaults: Lax)
- `COOKIE_SECURE` (defaults: false)
- `CSRF_COOKIE` (defaults: csrf)
- `CTX_DEPTH` (defaults: 4)
- `CTX_IMPORTS`
- `CTX_SYMBOLS`
- `JWT_SECRET` (defaults: CHANGE_ME_DEV_ONLY)
- `NODE_ENV` (defaults: development)
- `PORT` (defaults: 3000)
- `WORKER_TICK_SECONDS` (defaults: 3)

## Endpoints

### GET /api/admin/content/map/:key/data

Arquivo: `server\index.js:323`

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
- `HTTP 500` → {error:'invalid map json' }
- `HTTP 500` → {error:e.message }

### GET /api/admin/content/map/:key/objects

Arquivo: `server\index.js:300`

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
- `HTTP 500` → {error:err.message }
- `HTTP 404` → {error:'map not found' }
- `HTTP 500` → {error:'invalid map json' }
- `HTTP 500` → {error:e.message }

### GET /api/admin/content/map/:key/spawns

Arquivo: `server\index.js:311`

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
- `HTTP 500` → {error:'invalid map json' }
- `HTTP 500` → {error:e.message }

### GET /api/admin/content/maps

Arquivo: `server\index.js:293`

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
- `HTTP 500` → {error:'invalid map json' }
- `HTTP 500` → {error:e.message }

### GET /api/admin/content/monsters

Arquivo: `server\index.js:271`

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
- `HTTP 500` → {error:err.message }
- `HTTP 404` → {error:'map not found' }
- `HTTP 500` → {error:'invalid map json' }
- `HTTP 500` → {error:e.message }

### GET /api/assets/items

Arquivo: `server\index.js:278`

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
- `HTTP 500` → {error:'invalid map json' }
- `HTTP 500` → {error:e.message }

### GET /api/assets/sprites

Arquivo: `server\index.js:285`

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
- `HTTP 500` → {error:'invalid map json' }
- `HTTP 500` → {error:e.message }

### GET /api/csrf

Arquivo: `server\index.js:38`

**Payloads (exemplos inferidos):**
- body:
```json
{
  "try {\n    const { heroId": 1,
  "weaponOrSkill": "value",
  "heroClass": "value"
}
```

**Resposta de sucesso (amostra):**
```json
{ok:true,message:'Training started',heroId,skillType }
```

**Erros conhecidos:**
- `HTTP 400` → {error:'heroId,weaponOrSkill e heroClass são obrigatórios' }
- `HTTP 400` → {error:'weaponOrSkill inválido' }
- `HTTP 500` → {error:'erro ao iniciar treino' }
- `HTTP 400` → {error:'heroId é obrigatório' }

### GET /assets/items

Arquivo: `server\routes\assets.js:12`

_Sem payload inferido_

**Erros conhecidos:**
- `HTTP 500` → {error:e.message }

### GET /assets/sprites

Arquivo: `server\routes\assets.js:5`

_Sem payload inferido_

**Erros conhecidos:**
- `HTTP 500` → {error:e.message }
- `HTTP 500` → {error:e.message }

### GET /class-rates

Arquivo: `server\skills\routes.js:26`

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
- `HTTP 400` → {error:'informe ?skill=SWORD|AXE|CLUB|DISTANCE|SHIELD|MAGIC' }
- `HTTP 500` → {error:'Falha ao listar curvas' }
- `HTTP 500` → {error:'Falha ao listar rates' }
- `HTTP 400` → {error:'heroId é obrigatório' }
- `HTTP 404` → {error:'Herói não encontrado' }
- `HTTP 500` → {error:'Falha ao listar skills do herói' }

### GET /heroes/master

Arquivo: `server\routes\catalog.js:8`

_Sem payload inferido_

**Erros conhecidos:**
- `HTTP 500` → {error:'Falha ao listar heróis' }

### GET /list

Arquivo: `server\starter\routes.js:82`

_Sem payload inferido_

**Resposta de sucesso (amostra):**
```json
{canSelect:!row }
```

**Erros conhecidos:**
- `HTTP 500` → {error:"erro ao listar starters" }
- `HTTP 500` → {error:"erro ao checar status do starter" }
- `HTTP 400` → {error:"heroKey é obrigatório" }
- `HTTP 400` → {error:"starter já escolhido" }
- `HTTP 400` → {error:"heroKey inválido para starter" }
- `HTTP 404` → {error:"herói não encontrado no catálogo" }
- `HTTP 400` → {error:"starter já escolhido" }
- `HTTP 500` → {error:"erro ao selecionar starter" }

### GET /me

Arquivo: `server\skills\routes.js:37`

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

### GET /status

Arquivo: `server\starter\routes.js:93`

_Sem payload inferido_

**Resposta de sucesso (amostra):**
```json
{canSelect:!row }
```

**Erros conhecidos:**
- `HTTP 500` → {error:"erro ao checar status do starter" }
- `HTTP 400` → {error:"heroKey é obrigatório" }
- `HTTP 400` → {error:"starter já escolhido" }
- `HTTP 400` → {error:"heroKey inválido para starter" }
- `HTTP 404` → {error:"herói não encontrado no catálogo" }
- `HTTP 400` → {error:"starter já escolhido" }
- `HTTP 500` → {error:"erro ao selecionar starter" }

### POST /

Arquivo: `server\gacha\routes.js:148`

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

Arquivo: `server\index.js:336`

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

### POST /login

Arquivo: `server\auth\routes.js:78`

_Sem payload inferido_

**Resposta de sucesso (amostra):**
```json
{id:user.id,name:user.name,coins:user.coins,gems:user.gems }
```

**Erros conhecidos:**
- `HTTP 401` → {error:'Credenciais inválidas' }
- `HTTP 401` → {error:'Credenciais inválidas' }
- `HTTP 500` → {error:'Falha ao autenticar' }

### POST /logout

Arquivo: `server\auth\routes.js:101`

_Sem payload inferido_

**Resposta de sucesso (amostra):**
```json
{
  "ok": true
}
```

### POST /register

Arquivo: `server\auth\routes.js:45`

_Sem payload inferido_

**Resposta de sucesso (amostra):**
```json
{id,name:v.name,coins:500,gems:0,createdAt }
```

**Erros conhecidos:**
- `HTTP 400` → {error:v.msg }
- `HTTP 400` → {error:vp.msg }
- `HTTP 409` → {error:'Nome já está em uso.' }
- `HTTP 500` → {error:'Falha ao registrar' }
- `HTTP 401` → {error:'Credenciais inválidas' }
- `HTTP 401` → {error:'Credenciais inválidas' }
- `HTTP 500` → {error:'Falha ao autenticar' }

### POST /select

Arquivo: `server\starter\routes.js:108`

_Sem payload inferido_

**Resposta de sucesso (amostra):**
```json
{ok:true,heroKey,id }
```

**Erros conhecidos:**
- `HTTP 400` → {error:"heroKey é obrigatório" }
- `HTTP 400` → {error:"starter já escolhido" }
- `HTTP 400` → {error:"heroKey inválido para starter" }
- `HTTP 404` → {error:"herói não encontrado no catálogo" }
- `HTTP 400` → {error:"starter já escolhido" }
- `HTTP 500` → {error:"erro ao selecionar starter" }

## Tabela sintética de erros por rota

- **GET /api/admin/content/map/:key/data**
  - HTTP 500: {error:err.message }
  - HTTP 404: {error:'map not found' }
  - HTTP 500: {error:'invalid map json' }
  - HTTP 500: {error:e.message }
- **GET /api/admin/content/map/:key/objects**
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 404: {error:'map not found' }
  - HTTP 500: {error:'invalid map json' }
  - HTTP 500: {error:e.message }
- **GET /api/admin/content/map/:key/spawns**
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 404: {error:'map not found' }
  - HTTP 500: {error:'invalid map json' }
  - HTTP 500: {error:e.message }
- **GET /api/admin/content/maps**
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 404: {error:'map not found' }
  - HTTP 500: {error:'invalid map json' }
  - HTTP 500: {error:e.message }
- **GET /api/admin/content/monsters**
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 404: {error:'map not found' }
  - HTTP 500: {error:'invalid map json' }
  - HTTP 500: {error:e.message }
- **GET /api/assets/items**
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 404: {error:'map not found' }
  - HTTP 500: {error:'invalid map json' }
  - HTTP 500: {error:e.message }
- **GET /api/assets/sprites**
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 500: {error:err.message }
  - HTTP 404: {error:'map not found' }
  - HTTP 500: {error:'invalid map json' }
  - HTTP 500: {error:e.message }
- **GET /api/csrf**
  - HTTP 400: {error:'heroId,weaponOrSkill e heroClass são obrigatórios' }
  - HTTP 400: {error:'weaponOrSkill inválido' }
  - HTTP 500: {error:'erro ao iniciar treino' }
  - HTTP 400: {error:'heroId é obrigatório' }
- **GET /assets/items**
  - HTTP 500: {error:e.message }
- **GET /assets/sprites**
  - HTTP 500: {error:e.message }
  - HTTP 500: {error:e.message }
- **GET /class-rates**
  - HTTP 500: {error:'Falha ao listar rates' }
  - HTTP 400: {error:'heroId é obrigatório' }
  - HTTP 404: {error:'Herói não encontrado' }
  - HTTP 500: {error:'Falha ao listar skills do herói' }
- **GET /curves**
  - HTTP 400: {error:'informe ?skill=SWORD|AXE|CLUB|DISTANCE|SHIELD|MAGIC' }
  - HTTP 500: {error:'Falha ao listar curvas' }
  - HTTP 500: {error:'Falha ao listar rates' }
  - HTTP 400: {error:'heroId é obrigatório' }
  - HTTP 404: {error:'Herói não encontrado' }
  - HTTP 500: {error:'Falha ao listar skills do herói' }
- **GET /heroes/master**
  - HTTP 500: {error:'Falha ao listar heróis' }
- **GET /list**
  - HTTP 500: {error:"erro ao listar starters" }
  - HTTP 500: {error:"erro ao checar status do starter" }
  - HTTP 400: {error:"heroKey é obrigatório" }
  - HTTP 400: {error:"starter já escolhido" }
  - HTTP 400: {error:"heroKey inválido para starter" }
  - HTTP 404: {error:"herói não encontrado no catálogo" }
  - HTTP 400: {error:"starter já escolhido" }
  - HTTP 500: {error:"erro ao selecionar starter" }
- **GET /me**
  - HTTP 400: {error:'heroId é obrigatório' }
  - HTTP 404: {error:'Herói não encontrado' }
  - HTTP 500: {error:'Falha ao listar skills do herói' }
  - HTTP 404: {error:'Jogador não encontrado' }
  - HTTP 500: {error:'Falha ao obter dados do jogador' }
- **GET /status**
  - HTTP 500: {error:"erro ao checar status do starter" }
  - HTTP 400: {error:"heroKey é obrigatório" }
  - HTTP 400: {error:"starter já escolhido" }
  - HTTP 400: {error:"heroKey inválido para starter" }
  - HTTP 404: {error:"herói não encontrado no catálogo" }
  - HTTP 400: {error:"starter já escolhido" }
  - HTTP 500: {error:"erro ao selecionar starter" }
- **POST /**
  - HTTP 400: {error:result.error,cost:SUMMON_COST_COINS }
  - HTTP 400: {error:r.error,cost:SUMMON_COST_COINS,pulls }
  - HTTP 500: {error:'Falha ao girar gacha' }
- **POST /api/admin/content/reload-map**
  - HTTP 500: {error:e.message }
- **POST /login**
  - HTTP 401: {error:'Credenciais inválidas' }
  - HTTP 401: {error:'Credenciais inválidas' }
  - HTTP 500: {error:'Falha ao autenticar' }
- **POST /logout**
- **POST /register**
  - HTTP 400: {error:v.msg }
  - HTTP 400: {error:vp.msg }
  - HTTP 409: {error:'Nome já está em uso.' }
  - HTTP 500: {error:'Falha ao registrar' }
  - HTTP 401: {error:'Credenciais inválidas' }
  - HTTP 401: {error:'Credenciais inválidas' }
  - HTTP 500: {error:'Falha ao autenticar' }
- **POST /select**
  - HTTP 400: {error:"heroKey é obrigatório" }
  - HTTP 400: {error:"starter já escolhido" }
  - HTTP 400: {error:"heroKey inválido para starter" }
  - HTTP 404: {error:"herói não encontrado no catálogo" }
  - HTTP 400: {error:"starter já escolhido" }
  - HTTP 500: {error:"erro ao selecionar starter" }
