-- 015_perf_indices.sql
-- Índices de suporte e verificação inicial de consistência (sem constraints ainda).

-- 1) player_heroes por player
CREATE INDEX IF NOT EXISTS idx_player_heroes_playerId ON player_heroes("playerId");

-- 2) hero_backpack_slots por hero
CREATE INDEX IF NOT EXISTS idx_backpack_hero ON hero_backpack_slots(hero_id);

-- 3) chat_messages já deve ter (scope,id DESC); reforço (id alone) se precisar cursor global
CREATE INDEX IF NOT EXISTS idx_chat_messages_id ON chat_messages(id);

-- 4) posição do player (caso cresça)
CREATE INDEX IF NOT EXISTS idx_player_last_pos_player ON player_last_pos(player_id);

-- 5) quick check de nulos (não falha; só logue manualmente depois)
-- (Executar manualmente para inspecionar)
-- SELECT COUNT(*) FROM player_heroes WHERE hp IS NULL OR max_hp IS NULL;