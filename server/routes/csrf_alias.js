// server/routes/csrf_alias.js
// Alias de compatibilidade: clientes que chamarem /api/auth/csrf
// serão redirecionados (307) para /api/csrf, preservando o método.

const express = require('express');
const router = express.Router();

router.all('/auth/csrf', (req, res) => {
  res.redirect(307, '/api/csrf');
});

module.exports = router;