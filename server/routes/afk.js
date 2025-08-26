const express = require('express');
const router = express.Router();

// Reuse o MESMO DB central do projeto (evita 2ª conexão e SQLITE_BUSY)
const db = require('../models/db');

// Reuse teu auth existente
const { requireAuth, requireCsrf } = require('../auth/middleware');

// Helper seguro de transaction (SQLite)
async function tx(fn){
  await db.run('BEGIN');
  try{ const r = await fn(); await db.run('COMMIT'); return r; }
  catch(e){ await db.run('ROLLBACK'); throw e; }
}

// Resolve playerId do middleware atual
function getPlayerId(req){
  return req.user?.id || req.player?.id || req.auth?.id || null;
}

// Todas rotas AFK exigem auth (cookies/JWT do teu projeto)
router.use(requireAuth);

// STATE — retorna workers, boxes e inventário do jogador
router.get('/afk/state', async (req,res)=>{
  const playerId = getPlayerId(req);
  if(!playerId) return res.status(401).json({ error:'auth required' });

  try{
    const workers = await db.all('SELECT * FROM afk_workers WHERE player_id = ?', [playerId]);
    const boxes   = await db.all('SELECT * FROM afk_boxes   WHERE player_id = ?', [playerId]);
    const inv     = await db.all('SELECT item_type, amount FROM afk_inventories WHERE player_id = ?', [playerId]);
    res.json({ workers, boxes, inventory: inv });
  }catch(e){ res.status(500).json({ error:String(e) }); }
});

// CREATE WORKER — cria 1 worker (usaremos no tutorial)
router.post('/afk/create-worker', requireCsrf, express.json(), async (req,res)=>{
  const playerId = getPlayerId(req);
  if(!playerId) return res.status(401).json({ error:'auth required' });

  const { name, produce_type='iron', rate_sec=10, produce_amount=1 } = req.body||{};
  const id = `wk_${Date.now()}_${Math.floor(Math.random()*1000)}`;

  try{
    await db.run(
      'INSERT INTO afk_workers (id, player_id, name, produce_type, produce_amount, rate_sec) VALUES (?,?,?,?,?,?)',
      [id, playerId, name || 'Worker', produce_type, produce_amount, rate_sec]
    );
    const w = await db.get('SELECT * FROM afk_workers WHERE id = ?', [id]);
    res.json({ ok:true, worker:w });
  }catch(e){ res.status(500).json({ error:String(e) }); }
});

// ASSIGN — atribui worker a um box (futuro, aqui só persiste o vínculo)
router.post('/afk/assign', requireCsrf, express.json(), async (req,res)=>{
  const playerId = getPlayerId(req);
  if(!playerId) return res.status(401).json({ error:'auth required' });
  const { workerId, boxId } = req.body||{};
  if(!workerId) return res.status(400).json({ error:'workerId required' });

  try{
    await db.run('UPDATE afk_workers SET assigned_box = ? WHERE id = ? AND player_id = ?', [boxId||null, workerId, playerId]);
    const w = await db.get('SELECT * FROM afk_workers WHERE id = ?', [workerId]);
    res.json({ ok:true, worker:w });
  }catch(e){ res.status(500).json({ error:String(e) }); }
});

// COLLECT — calcula produção pelo tempo desde last_collected e credita no inventário
router.post('/afk/collect', requireCsrf, express.json(), async (req,res)=>{
  const playerId = getPlayerId(req);
  if(!playerId) return res.status(401).json({ error:'auth required' });

  const { workerIds } = req.body||{};
  const now = Date.now();
  const OFFLINE_CAP_SEC = 24*3600; // 24h de cap (ajustável)

  try{
    const gains = {};
    await tx(async ()=>{
      let workers;
      if (Array.isArray(workerIds) && workerIds.length){
        const qs = workerIds.map(()=>'?').join(',');
        workers = await db.all(`SELECT * FROM afk_workers WHERE player_id = ? AND id IN (${qs})`, [playerId,...workerIds]);
      }else{
        workers = await db.all('SELECT * FROM afk_workers WHERE player_id = ?', [playerId]);
      }

      for(const w of workers){
        const last = new Date(w.last_collected || Date.now()).getTime();
        const rate = Math.max(1, w.rate_sec || 10);
        const secs = Math.floor((now - last)/1000);

        if (secs < rate) continue;

        const maxTicks = Math.floor(OFFLINE_CAP_SEC / rate);
        let ticks = Math.floor(secs / rate);
        if (ticks > maxTicks) ticks = maxTicks;

        const produced = ticks * (w.produce_amount || 1);
        if (produced <= 0) continue;

        gains[w.produce_type] = (gains[w.produce_type] || 0) + produced;

        const newLast = new Date(last + ticks*rate*1000).toISOString();
        await db.run('UPDATE afk_workers SET last_collected = ? WHERE id = ?', [newLast, w.id]);
      }

      for(const [type, amt] of Object.entries(gains)){
        await db.run(
          `INSERT INTO afk_inventories(player_id,item_type,amount) VALUES(?,?,?)
           ON CONFLICT(player_id,item_type) DO UPDATE SET amount = afk_inventories.amount + excluded.amount`,
          [playerId, type, amt]
        );
      }
    });

    const inv = await db.all('SELECT item_type, amount FROM afk_inventories WHERE player_id = ?', [playerId]);
    res.json({ ok:true, gains, inventory: inv });
  }catch(e){ res.status(500).json({ error:String(e) }); }
});

module.exports = router;
