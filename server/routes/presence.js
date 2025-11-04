// server/routes/presence.js
'use strict';
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../auth/middleware');
const { get, run } = require('../models/db');
const { broadcastPresenceUpdate } = require('../ws/presence');

const ALLOWED_STATUS = new Set(['ONLINE','AFK','BUSY','APPEAR_OFFLINE']);
const ALLOWED_ACTIVITY = new Set(['HOUSE','ADVENTURE','TRAINING','DUNGEON']);

router.use(requireAuth);

// GET /api/presence/me
router.get('/me', async (req, res) => {
  try {
    const me = req.user && req.user.id;
    const row = await get(
      `SELECT COALESCE(presence_status,'ONLINE') AS status,
              COALESCE(presence_activity,'HOUSE') AS activity,
              COALESCE(presence_updated_at, NOW()) AS updatedAt
         FROM players WHERE id=$1`,
      [me]
    );
    res.json({
      ok: true,
      status: row?.status || 'ONLINE',
      activity: row?.activity || 'HOUSE',
      updatedAt: row?.updatedAt || new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'PRESENCE_FETCH_FAILED' });
  }
});

// POST /api/presence  { status?, activity? }
router.post('/', async (req, res) => {
  const me = req.user && req.user.id;
  const { status, activity } = req.body || {};

  if (status != null && !ALLOWED_STATUS.has(String(status).toUpperCase())) {
    return res.status(400).json({ ok: false, error: 'INVALID_STATUS' });
  }
  if (activity != null && !ALLOWED_ACTIVITY.has(String(activity).toUpperCase())) {
    return res.status(400).json({ ok: false, error: 'INVALID_ACTIVITY' });
  }

  const nextStatus = status ? String(status).toUpperCase() : undefined;
  const nextActivity = activity ? String(activity).toUpperCase() : undefined;

  try {
    if (nextStatus != null && nextActivity != null) {
      await run(`UPDATE players SET presence_status=$1, presence_activity=$2, presence_updated_at=NOW() WHERE id=$3`, [nextStatus, nextActivity, me]);
    } else if (nextStatus != null) {
      await run(`UPDATE players SET presence_status=$1, presence_updated_at=NOW() WHERE id=$2`, [nextStatus, me]);
    } else if (nextActivity != null) {
      await run(`UPDATE players SET presence_activity=$1, presence_updated_at=NOW() WHERE id=$2`, [nextActivity, me]);
    }
    // broadcast to friends (visible presence)
    broadcastPresenceUpdate(me).catch(()=>{});

    const row = await get(`SELECT COALESCE(presence_status,'ONLINE') as status, COALESCE(presence_activity,'HOUSE') as activity FROM players WHERE id=$1`, [me]);
    res.json({ ok: true, status: row?.status || 'ONLINE', activity: row?.activity || 'HOUSE' });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'PRESENCE_UPDATE_FAILED' });
  }
});

module.exports = router;
