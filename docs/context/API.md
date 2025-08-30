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

### GET /api/admin/content/map/:key/objects

Arquivo: `server\index.js:367`

**Payloads (exemplos inferidos):**
- params:
```json
{
  "key": "value"
}
```

### GET /api/admin/content/map/:key/spawns

Arquivo: `server\index.js:379`

**Payloads (exemplos inferidos):**
- params:
```json
{
  "key": "value"
}
```

### GET /api/admin/content/maps

Arquivo: `server\index.js:356`

_Sem payload inferido_

### GET /api/admin/content/monsters

Arquivo: `server\index.js:326`

_Sem payload inferido_

### GET /api/assets/items

Arquivo: `server\index.js:337`

_Sem payload inferido_

### GET /api/assets/sprites

Arquivo: `server\index.js:346`

_Sem payload inferido_

### GET /api/chat/global

Arquivo: `server\index.js:631`

_Sem payload inferido_

### GET /api/csrf

Arquivo: `server\index.js:43`

_Sem payload inferido_

### GET /assets/items

Arquivo: `server\routes\assets.js:29`

_Sem payload inferido_

### GET /assets/sprites

Arquivo: `server\routes\assets.js:8`

_Sem payload inferido_

### GET /class-rates

Arquivo: `server\skills\routes.js:33`

_Sem payload inferido_

### GET /curves

Arquivo: `server\skills\routes.js:10`

_Sem payload inferido_

### GET /heroes/master

Arquivo: `server\routes\catalog.js:10`

_Sem payload inferido_

### GET /list

Arquivo: `server\starter\routes.js:29`

_Sem payload inferido_

### GET /me

Arquivo: `server\skills\routes.js:48`

_Sem payload inferido_

### GET /ping

Arquivo: `server\routes\afk.js:7`

_Sem payload inferido_

### GET /pos

Arquivo: `server\routes\player.js:12`

_Sem payload inferido_

### GET /state

Arquivo: `server\routes\farm.js:71`

_Sem payload inferido_

### GET /status

Arquivo: `server\starter\routes.js:74`

_Sem payload inferido_

### POST /

Arquivo: `server\gacha\routes.js:144`

_Sem payload inferido_

### POST /api/admin/content/reload-map

Arquivo: `server\index.js:402`

_Sem payload inferido_

### POST /api/chat/global

Arquivo: `server\index.js:654`

_Sem payload inferido_

### POST /assign

Arquivo: `server\routes\afk.js:65`

_Sem payload inferido_

### POST /collect

Arquivo: `server\routes\afk.js:88`

_Sem payload inferido_

### POST /create-worker

Arquivo: `server\routes\afk.js:42`

_Sem payload inferido_

### POST /debug/grant-seed

Arquivo: `server\routes\farm.js:240`

_Sem payload inferido_

### POST /harvest

Arquivo: `server\routes\farm.js:181`

_Sem payload inferido_

### POST /login

Arquivo: `server\auth\routes.js:93`

_Sem payload inferido_

### POST /logout

Arquivo: `server\auth\routes.js:121`

_Sem payload inferido_

### POST /move

Arquivo: `server\routes\player.js:44`

_Sem payload inferido_

### POST /plant

Arquivo: `server\routes\farm.js:122`

_Sem payload inferido_

### POST /plot/create

Arquivo: `server\routes\farm.js:101`

_Sem payload inferido_

### POST /pos

Arquivo: `server\routes\player.js:23`

_Sem payload inferido_

### POST /register

Arquivo: `server\auth\routes.js:50`

_Sem payload inferido_

### POST /select

Arquivo: `server\starter\routes.js:92`

_Sem payload inferido_

## Tabela sintética de erros por rota

- **GET /**
- **GET /api/admin/content/map/:key/data**
- **GET /api/admin/content/map/:key/objects**
- **GET /api/admin/content/map/:key/spawns**
- **GET /api/admin/content/maps**
- **GET /api/admin/content/monsters**
- **GET /api/assets/items**
- **GET /api/assets/sprites**
- **GET /api/chat/global**
- **GET /api/csrf**
- **GET /assets/items**
- **GET /assets/sprites**
- **GET /class-rates**
- **GET /curves**
- **GET /heroes/master**
- **GET /list**
- **GET /me**
- **GET /ping**
- **GET /pos**
- **GET /state**
- **GET /status**
- **POST /**
- **POST /api/admin/content/reload-map**
- **POST /api/chat/global**
- **POST /assign**
- **POST /collect**
- **POST /create-worker**
- **POST /debug/grant-seed**
- **POST /harvest**
- **POST /login**
- **POST /logout**
- **POST /move**
- **POST /plant**
- **POST /plot/create**
- **POST /pos**
- **POST /register**
- **POST /select**
