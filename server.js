const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'veilo-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// ── Simple file-based DB ──────────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, 'data/db.json');
function readDB() {
  if (!fs.existsSync(DB_PATH)) return { users: [], workers: [], locations: {} };
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}
function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Init DB with demo account
if (!fs.existsSync(DB_PATH)) {
  writeDB({
    users: [{ id: 'u1', email: 'demo@veilo.app', password: 'demo1234', company: 'Demo Co', plan: 'pro', workers: [] }],
    workers: [],
    locations: {}
  });
}

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session.userId) return next();
  res.redirect('/login');
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Landing page
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views/landing.html')));

// Login
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'views/login.html')));
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const db = readDB();
  const user = db.users.find(u => u.email === email && u.password === password);
  if (!user) return res.redirect('/login?error=1');
  req.session.userId = user.id;
  res.redirect('/dashboard');
});

// Register
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'views/register.html')));
app.post('/register', (req, res) => {
  const { email, password, company } = req.body;
  const db = readDB();
  if (db.users.find(u => u.email === email)) return res.redirect('/register?error=exists');
  const user = { id: 'u' + Date.now(), email, password, company, plan: 'trial', workers: [] };
  db.users.push(user);
  writeDB(db);
  req.session.userId = user.id;
  res.redirect('/dashboard');
});

// Logout
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// Dashboard
app.get('/dashboard', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'views/dashboard.html')));

// API: get current user info
app.get('/api/me', requireAuth, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'Not found' });
  const workers = db.workers.filter(w => w.ownerId === user.id);
  res.json({ id: user.id, email: user.email, company: user.company, plan: user.plan, workers });
});

// API: add worker
app.post('/api/workers', requireAuth, (req, res) => {
  const { name, phone } = req.body;
  const db = readDB();
  const worker = {
    id: 'w' + Date.now(),
    ownerId: req.session.userId,
    name,
    phone,
    trackingToken: Math.random().toString(36).slice(2, 10),
    active: false
  };
  db.workers.push(worker);
  writeDB(db);
  res.json(worker);
});

// API: delete worker
app.delete('/api/workers/:id', requireAuth, (req, res) => {
  const db = readDB();
  db.workers = db.workers.filter(w => !(w.id === req.params.id && w.ownerId === req.session.userId));
  writeDB(db);
  res.json({ ok: true });
});

// API: get worker locations
app.get('/api/locations', requireAuth, (req, res) => {
  const db = readDB();
  const myWorkers = db.workers.filter(w => w.ownerId === req.session.userId).map(w => w.id);
  const locs = {};
  myWorkers.forEach(id => { if (db.locations[id]) locs[id] = db.locations[id]; });
  res.json(locs);
});

// Worker tracking page (no auth needed — shareable link)
app.get('/track/:token', (req, res) => res.sendFile(path.join(__dirname, 'views/tracker.html')));

// API: validate tracking token
app.get('/api/track/:token', (req, res) => {
  const db = readDB();
  const worker = db.workers.find(w => w.trackingToken === req.params.token);
  if (!worker) return res.status(404).json({ error: 'Invalid link' });
  res.json({ workerId: worker.id, name: worker.name });
});

// Pricing page
app.get('/pricing', (req, res) => res.sendFile(path.join(__dirname, 'views/pricing.html')));

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  // Worker sends location update
  socket.on('worker:location', ({ workerId, lat, lng, token }) => {
    const db = readDB();
    const worker = db.workers.find(w => w.id === workerId && w.trackingToken === token);
    if (!worker) return;

    db.locations[workerId] = { lat, lng, name: worker.name, ts: Date.now() };
    writeDB(db);

    // Broadcast to all dashboard watchers of this owner
    io.emit(`location:${worker.ownerId}`, { workerId, lat, lng, name: worker.name, ts: Date.now() });
  });

  // Dashboard joins room for their owner id
  socket.on('dashboard:join', ({ ownerId }) => {
    socket.join(`owner:${ownerId}`);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Veilo running at http://localhost:${PORT}`));
