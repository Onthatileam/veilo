const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// ── PayPal ────────────────────────────────────────────────────────────────────
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
const PAYPAL_BASE = 'https://api-m.paypal.com';

async function getPayPalToken() {
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const data = await res.json();
  return data.access_token;
}

const PLANS = {
  starter: { name: 'Starter', price: 49,  workers: 5 },
  pro:     { name: 'Pro',     price: 149, workers: 25 },
  business:{ name: 'Business',price: 299, workers: 999 }
};

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
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views/landing.html')));

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'views/login.html')));
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const db = readDB();
  const user = db.users.find(u => u.email === email && u.password === password);
  if (!user) return res.redirect('/login?error=1');
  req.session.userId = user.id;
  res.redirect('/dashboard');
});

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

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.get('/dashboard', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'views/dashboard.html')));
app.get('/pricing', (req, res) => res.sendFile(path.join(__dirname, 'views/pricing.html')));
app.get('/checkout', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'views/checkout.html')));
app.get('/success', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'views/success.html')));

// ── API ───────────────────────────────────────────────────────────────────────
app.get('/api/me', requireAuth, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'Not found' });
  const workers = db.workers.filter(w => w.ownerId === user.id);
  res.json({ id: user.id, email: user.email, company: user.company, plan: user.plan, workers });
});

app.post('/api/workers', requireAuth, (req, res) => {
  const { name } = req.body;
  const db = readDB();
  const worker = {
    id: 'w' + Date.now(),
    ownerId: req.session.userId,
    name,
    trackingToken: Math.random().toString(36).slice(2, 10),
    active: false
  };
  db.workers.push(worker);
  writeDB(db);
  res.json(worker);
});

app.delete('/api/workers/:id', requireAuth, (req, res) => {
  const db = readDB();
  db.workers = db.workers.filter(w => !(w.id === req.params.id && w.ownerId === req.session.userId));
  writeDB(db);
  res.json({ ok: true });
});

app.get('/api/locations', requireAuth, (req, res) => {
  const db = readDB();
  const myWorkers = db.workers.filter(w => w.ownerId === req.session.userId).map(w => w.id);
  const locs = {};
  myWorkers.forEach(id => { if (db.locations[id]) locs[id] = db.locations[id]; });
  res.json(locs);
});

app.get('/track/:token', (req, res) => res.sendFile(path.join(__dirname, 'views/tracker.html')));

app.get('/api/track/:token', (req, res) => {
  const db = readDB();
  const worker = db.workers.find(w => w.trackingToken === req.params.token);
  if (!worker) return res.status(404).json({ error: 'Invalid link' });
  res.json({ workerId: worker.id, name: worker.name });
});

// ── PayPal: Create order ──────────────────────────────────────────────────────
app.post('/api/paypal/create-order', requireAuth, async (req, res) => {
  const { plan } = req.body;
  if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });
  try {
    const token = await getPayPalToken();
    const order = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: 'USD', value: PLANS[plan].price.toString() },
          description: `Veilo ${PLANS[plan].name} Plan - Monthly`
        }]
      })
    });
    const data = await order.json();
    res.json({ orderId: data.id });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'PayPal error' });
  }
});

// ── PayPal: Capture order ─────────────────────────────────────────────────────
app.post('/api/paypal/capture-order', requireAuth, async (req, res) => {
  const { orderId, plan } = req.body;
  if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });
  try {
    const token = await getPayPalToken();
    const capture = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    const data = await capture.json();
    if (data.status === 'COMPLETED') {
      const db = readDB();
      const user = db.users.find(u => u.id === req.session.userId);
      if (user) {
        user.plan = plan;
        user.paidAt = Date.now();
        user.orderId = orderId;
        writeDB(db);
      }
      res.json({ success: true, plan });
    } else {
      res.status(400).json({ error: 'Payment not completed', details: data });
    }
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Capture error' });
  }
});

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.on('worker:location', ({ workerId, lat, lng, token }) => {
    const db = readDB();
    const worker = db.workers.find(w => w.id === workerId && w.trackingToken === token);
    if (!worker) return;
    db.locations[workerId] = { lat, lng, name: worker.name, ts: Date.now() };
    writeDB(db);
    io.emit(`location:${worker.ownerId}`, { workerId, lat, lng, name: worker.name, ts: Date.now() });
  });

  socket.on('dashboard:join', ({ ownerId }) => {
    socket.join(`owner:${ownerId}`);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Veilo running at http://localhost:${PORT}`));
