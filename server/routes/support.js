// server/routes/support.js
const express = require('express');
const { randomUUID } = require('crypto');

const { run } = require('../models/db');
const makeLimiter = require('../middleware/limiter');

const router = express.Router();

const ticketLimiter = makeLimiter({
  windowMs: 60_000,
  max: 5,
  message: { error: 'too-many-support-tickets' },
});

function sanitizeText(value, max) {
  const text = String(value || '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').toLowerCase());
}

router.post('/ticket', ticketLimiter, async (req, res) => {
  try {
    const name = sanitizeText(req.body?.name, 120);
    const email = sanitizeText(req.body?.email, 190);
    const subject = sanitizeText(req.body?.subject, 200);
    const message = sanitizeText(req.body?.message, 2000);

    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: 'missing-fields' });
    }

    if (!isValidEmail(email)) {
      return res.status(422).json({ error: 'invalid-email' });
    }

    const id = randomUUID();
    await run(
      `
      INSERT INTO support_tickets (id, name, email, subject, message, status)
      VALUES ($1, $2, $3, $4, $5, 'open')
      `,
      [id, name, email, subject, message]
    );

    res.json({ ok: true, ticketId: id });
  } catch (err) {
    console.error('[support] ticket creation failed:', err?.message || err);
    res.status(500).json({ error: 'ticket-create-failed' });
  }
});

module.exports = router;
