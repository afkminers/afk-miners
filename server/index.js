require('dotenv').config();

const express = require('express');
const path = require('path');
const cors = require('cors');

const { migrate } = require('./models/migrate');
const { cookieParser, requireAuth, requireCsrf, csrfRoute } = require('./auth/middleware');

const authRoutes = require('./auth/routes');
const playerRoutes = require('./player/routes');
const gachaRoutes = require('./gacha/routes');
const catalogRoutes = require('./routes/catalog');

const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = Number(process.env.PORT || 3000);
const CLIENT_ROOT_DIR = path.join(__dirname, '..', 'client');

const app = express();

// middlewares
app.use(cookieParser());
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));
app.use(requireCsrf);

// estático
app.use(express.static(CLIENT_ROOT_DIR));

// CSRF token
app.get('/api/csrf', csrfRoute);

// rotas
app.use('/api/auth', authRoutes);
app.use('/api', catalogRoutes);
app.use('/api/player', requireAuth, playerRoutes);
app.use('/api/gacha', requireAuth, gachaRoutes);

// skill
app.use('/api/skills', require('./skills/routes'));

// SPA fallback
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(CLIENT_ROOT_DIR, 'index.html'));
});

// start
(async () => {
  await migrate();
  app.listen(PORT, () => console.log(`> ${NODE_ENV} | http://localhost:${PORT}`));
})();
