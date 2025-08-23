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

### GET /api/admin/content/map/:key/objects

Arquivo: `server\index.js:294`

**Payloads (exemplos inferidos):**
- params:
```json
{
  "key": "value"
}
```

### GET /api/admin/content/map/:key/spawns

Arquivo: `server\index.js:305`

**Payloads (exemplos inferidos):**
- params:
```json
{
  "key": "value"
}
```

### GET /api/admin/content/maps

Arquivo: `server\index.js:287`

_Sem payload inferido_

### GET /api/admin/content/monsters

Arquivo: `server\index.js:265`

_Sem payload inferido_

### GET /api/assets/items

Arquivo: `server\index.js:272`

_Sem payload inferido_

### GET /api/assets/sprites

Arquivo: `server\index.js:279`

_Sem payload inferido_

### GET /api/csrf

Arquivo: `server\index.js:37`

_Sem payload inferido_

### GET /assets/items

Arquivo: `server\routes\assets.js:12`

_Sem payload inferido_

### GET /assets/sprites

Arquivo: `server\routes\assets.js:5`

_Sem payload inferido_

### GET /class-rates

Arquivo: `server\skills\routes.js:26`

_Sem payload inferido_

### GET /curves

Arquivo: `server\skills\routes.js:10`

_Sem payload inferido_

### GET /heroes/master

Arquivo: `server\routes\catalog.js:8`

_Sem payload inferido_

### GET /me

Arquivo: `server\skills\routes.js:37`

_Sem payload inferido_

### POST /

Arquivo: `server\gacha\routes.js:148`

_Sem payload inferido_

### POST /api/admin/content/reload-map

Arquivo: `server\index.js:317`

_Sem payload inferido_

### POST /login

Arquivo: `server\auth\routes.js:78`

_Sem payload inferido_

### POST /logout

Arquivo: `server\auth\routes.js:101`

_Sem payload inferido_

### POST /register

Arquivo: `server\auth\routes.js:45`

_Sem payload inferido_

## Histórico por rota

- GET /api/admin/content/map/:key/objects → no-tag
- GET /api/admin/content/map/:key/spawns → no-tag
- GET /api/admin/content/maps → no-tag
- GET /api/admin/content/monsters → no-tag
- GET /api/assets/items → no-tag
- GET /api/assets/sprites → no-tag
- GET /api/csrf → no-tag
- GET /assets/items → no-tag
- GET /assets/sprites → no-tag
- GET /class-rates → no-tag
- GET /curves → no-tag
- GET /heroes/master → no-tag
- GET /me → no-tag
- POST / → no-tag
- POST /api/admin/content/reload-map → no-tag
- POST /login → no-tag
- POST /logout → no-tag
- POST /register → no-tag

## Tabela sintética de erros por rota

- **GET /api/admin/content/map/:key/objects**
- **GET /api/admin/content/map/:key/spawns**
- **GET /api/admin/content/maps**
- **GET /api/admin/content/monsters**
- **GET /api/assets/items**
- **GET /api/assets/sprites**
- **GET /api/csrf**
- **GET /assets/items**
- **GET /assets/sprites**
- **GET /class-rates**
- **GET /curves**
- **GET /heroes/master**
- **GET /me**
- **POST /**
- **POST /api/admin/content/reload-map**
- **POST /login**
- **POST /logout**
- **POST /register**

## TODO / FIXME

- server\scripts\gen-context.js:366 — TODO: /FIXME scanner
- server\scripts\gen-context.js:508 — TODO: /FIXME
- server\scripts\gen-context.js:509 — TODO: / FIXME');
