# Deploy Checklist

## Rotação de Segredos

- **Rotacionar segredos**: gerar novos JWT_SECRET e CSRF_SECRET; atualizar variáveis em produção.
- **Neon**: trocar senha do usuário do banco ou criar novo usuário com senha nova; atualizar DATABASE_URL (usar endpoint -pooler e sslmode=require).

## Configuração de Produção

- **Produção**: definir SKIP_MIGRATIONS_ON_BOOT=1; DB_IDLE_CLOSE_MINUTES=10..15; SYNC_SPAWNS_INTERVAL_MS=300000; IDLE_SCHEDULER_CHECK_MS=30000; ASSETS_CACHE_TTL_MS=300000..600000.
- **Nunca commitar server/.env**; usar server/.env.example como referência.
- **Verificar Redis** (opcional) e APP_ORIGINS.

## Validação Pós-Deploy

Após deploy, validar:
1. **1º acesso a /api/assets/*** retorna 200 + ETag
2. **subsequentes com If-None-Match** retornam 304
3. **idle gating** fecha o pool após período ocioso e reabre no primeiro request

## Segurança

⚠️ **IMPORTANTE**: Os segredos anteriores (JWT_SECRET, CSRF_SECRET) e credenciais do banco de dados foram expostos no histórico do git. Estes devem ser rotacionados imediatamente após o deploy desta correção.