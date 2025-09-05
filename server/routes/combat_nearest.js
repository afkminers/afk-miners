// server/routes/combat_nearest.js
const express = require('express');
const router = express.Router();
const { get, all } = require('../models/db');

const DEBUG = String(process.env.COMBAT_DEBUG || '').trim() === '1';

// log simples para caminhos de combate
router.use((req, _res, next) => {
  if (req.path.startsWith('/api/combat')) {
    console.log('[combat]', req.method, req.originalUrl);
  }
  next();
});

/**
 * GET /api/combat/nearest?map=house&x=..&y=..&px=..&py=..
 *
 * Seleção robusta:
 * - Considera o RETÂNGULO do spawn (x,y,w,h).
 * - Se o clique (x,y) estiver DENTRO do retângulo, aceita (dist=0).
 * - Senão, usa a menor distância ponto→retângulo entre (x,y) e (px,py).
 * - Raio de seleção = 6 tiles (= 192 px). Ajuste MAX_PICK se quiser.
 *
 * 200 => { id, x, y, monsterKey, hp, maxHp }
 * 404 => { error: 'no-alive' | 'no-monster-in-radius', ...(DEBUG extra) }
 */
router.get('/api/combat/nearest', async (req, res) => {
  try {
    const mapKey = String(req.query.map || 'house');
    const x  = Number(req.query.x);
    const y  = Number(req.query.y);
    const px = Number(req.query.px);
    const py = Number(req.query.py);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return res.status(400).json({ error: 'bad-coords' });
    }

    // tolerância maior pra seleção no mundo (6 tiles com TILE=32)
    const MAX_PICK = 192; // px
    const MAX2 = MAX_PICK * MAX_PICK;

    // Busca TODAS instâncias ALIVE do mapa. Refinamos distância no JS.
    const rows = await all(
      `
      SELECT
        mi.id,
        mi.hp,
        mi.max_hp          AS "maxHp",
        mi.x               AS "ix",
        mi.y               AS "iy",
        s.x                AS "sx",
        s.y                AS "sy",
        COALESCE(NULLIF(s.w,0), 1) AS "sw",
        COALESCE(NULLIF(s.h,0), 1) AS "sh",
        s."monsterKey"     AS "monsterKey"
      FROM monster_instances mi
      JOIN spawns s ON s.id = mi.spawn_id
      WHERE mi.state = 'ALIVE'
        AND s."mapKey" = $1
      `,
      [mapKey]
    );

    if (!rows || rows.length === 0) {
      if (DEBUG) console.log('[combat/nearest] nenhum ALIVE no mapa', { mapKey });
      return res.status(404).json({ error: 'no-alive' });
    }

    // helpers: ponto→retângulo e “contém”
    function pointRectDist2(px0, py0, rx, ry, rw, rh) {
      const cx = Math.max(rx, Math.min(px0, rx + rw));
      const cy = Math.max(ry, Math.min(py0, ry + rh));
      const dx = px0 - cx;
      const dy = py0 - cy;
      return dx * dx + dy * dy;
    }
    function containsPoint(px0, py0, rx, ry, rw, rh) {
      return px0 >= rx && px0 <= rx + rw && py0 >= ry && py0 <= ry + rh;
    }

    // 1) instâncias cujo retângulo CONTÉM o clique (dist=0)
    const inside = [];
    for (const m of rows) {
      const rx = Number(m.sx) || 0;
      const ry = Number(m.sy) || 0;
      const rw = Number(m.sw) || 1;
      const rh = Number(m.sh) || 1;
      if (containsPoint(x, y, rx, ry, rw, rh)) inside.push(m);
    }

    let picked = null;
    let bestD2 = Infinity;

    if (inside.length > 0) {
      // vários contêm: escolhe o de menor distância ao “ponto ideal” (mi.x/mi.y ou centro do spawn)
      for (const m of inside) {
        const cx = Number.isFinite(m.ix) ? Number(m.ix) : (Number(m.sx) + Number(m.sw) / 2);
        const cy = Number.isFinite(m.iy) ? Number(m.iy) : (Number(m.sy) + Number(m.sh) / 2);
        const dx = x - cx;
        const dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; picked = m; }
      }
      // clique dentro → aceita sem checar raio (dist efetiva 0)
      bestD2 = 0;
    } else {
      // 2) ninguém contém: usa a menor distância do retângulo considerando
      //    tanto o clique (x,y) quanto a posição do player (px,py) se existir.
      for (const m of rows) {
        const rx = Number(m.sx) || 0;
        const ry = Number(m.sy) || 0;
        const rw = Number(m.sw) || 1;
        const rh = Number(m.sh) || 1;

        let d2 = pointRectDist2(x, y, rx, ry, rw, rh);
        if (Number.isFinite(px) && Number.isFinite(py)) {
          const d2Player = pointRectDist2(px, py, rx, ry, rw, rh);
          d2 = Math.min(d2, d2Player);
        }
        if (d2 < bestD2) { bestD2 = d2; picked = m; }
      }
    }

    if (!picked) {
      if (DEBUG) console.log('[combat/nearest] nenhum candidato viável');
      return res.status(404).json({ error: 'no-alive' });
    }

    if (bestD2 > MAX2) {
      if (DEBUG) {
        const rx = Number(picked.sx) || 0;
        const ry = Number(picked.sy) || 0;
        const rw = Number(picked.sw) || 1;
        const rh = Number(picked.sh) || 1;
        console.log('[combat/nearest] no-monster-in-radius', {
          click: { x, y }, player: { px, py },
          rect: { x: rx, y: ry, w: rw, h: rh },
          dist: Math.sqrt(bestD2)
        });
      }
      const debugPayload = { error: 'no-monster-in-radius' };
      if (DEBUG) {
        const rx = Number(picked.sx) || 0;
        const ry = Number(picked.sy) || 0;
        const rw = Number(picked.sw) || 1;
        const rh = Number(picked.sh) || 1;
        debugPayload.nearest = {
          id: picked.id,
          rect: { x: rx, y: ry, w: rw, h: rh },
          hp: Number(picked.hp) || 0,
          maxHp: Number(picked.maxHp) || 0,
          monsterKey: picked.monsterKey || null,
          dist: Math.sqrt(bestD2)
        };
      }
      return res.status(404).json(debugPayload);
    }

    // posição de retorno (para UI): mi.x/mi.y se existir, senão centro do spawn
    const retX = Number.isFinite(picked.ix)
      ? Number(picked.ix)
      : (Number(picked.sx) + Number(picked.sw) / 2);
    const retY = Number.isFinite(picked.iy)
      ? Number(picked.iy)
      : (Number(picked.sy) + Number(picked.sh) / 2);

    const payload = {
      id: picked.id,
      x: retX,
      y: retY,
      monsterKey: picked.monsterKey || null,
      hp: Number(picked.hp) || 0,
      maxHp: Number(picked.maxHp) || 0,
    };

    if (DEBUG) {
      const rx = Number(picked.sx) || 0;
      const ry = Number(picked.sy) || 0;
      const rw = Number(picked.sw) || 1;
      const rh = Number(picked.sh) || 1;
      console.log('[combat/nearest] OK', {
        pickedId: picked.id,
        click: { x, y }, player: { px, py },
        ret: { x: payload.x, y: payload.y },
        rect: { x: rx, y: ry, w: rw, h: rh },
        hp: payload.hp, maxHp: payload.maxHp
      });
    }

    return res.json(payload);
  } catch (e) {
    console.error('[combat/nearest] error:', e);
    return res.status(500).json({ error: 'nearest-failed' });
  }
});

module.exports = router;
