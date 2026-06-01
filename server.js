require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const https   = require('https');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || process.env.CHAT_PORT || 3001;

const BOT_TOKEN    = process.env.BOT_TOKEN    || '';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '';
const ADMIN_PASS   = process.env.ADMIN_PASSWORD || 'admin123';

const ADMIN_IDS = [
  ...(ADMIN_CHAT_ID ? [ADMIN_CHAT_ID] : []),
  '733589995',
].filter((v, i, a) => a.indexOf(v) === i);

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '2mb' }));

// ── Serve admin panel ──────────────────────────────────────────
app.use(express.static(__dirname));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// ══════════════════════════════════════════════════════════════
//  DATA  (in-memory + JSON files for persistence)
// ══════════════════════════════════════════════════════════════
const DATA = path.join(__dirname, 'data');
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA);

function load(file, def) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8')); }
  catch { return def; }
}
function save(file, val) {
  try { fs.writeFileSync(path.join(DATA, file), JSON.stringify(val, null, 2)); }
  catch (_) {}
}

const DEFAULT_PRODUCTS = [
  { id:1,  name:'Ніжна Принцеса',  origin:'Троянди · Еквадор',      price:890,  photo:'https://images.unsplash.com/photo-1562690868-60bbe7293e94?w=600&auto=format&fit=crop&q=80', cat:'Троянди', badge:'Хіт',   bt:'bdg-hit',  big:true  },
  { id:2,  name:'Місячний Піон',   origin:'Піони · Нідерланди',      price:1200, photo:'https://images.unsplash.com/photo-1557800636-894a64c1696f?w=600&auto=format&fit=crop&q=80', cat:'Піони',   badge:'Новинка',bt:'bdg-new',  big:false },
  { id:3,  name:'Пурпурна Орхідея',origin:'Орхідеї · Таїланд',       price:1650, photo:'https://images.unsplash.com/photo-1524598171353-7d7e46e1f7d1?w=600&auto=format&fit=crop&q=80', cat:'Орхідеї', badge:'',      bt:'',         big:false },
  { id:4,  name:'Весняний Вальс',  origin:'Букети · Авторський',      price:2100, oldPrice:2800, photo:'https://images.unsplash.com/photo-1487530811015-780a77aafe2c?w=600&auto=format&fit=crop&q=80', cat:'Букети',  badge:'−25%',  bt:'bdg-sale', big:false },
  { id:5,  name:'Золота Весна',    origin:'Тюльпани · Нідерланди',    price:650,  photo:'https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=600&auto=format&fit=crop&q=80', cat:'Тюльпани',badge:'',      bt:'',         big:false },
  { id:6,  name:'Сонячна Радість', origin:'Соняшники · Україна',      price:780,  photo:'https://images.unsplash.com/photo-1597848212624-a19eb35e2651?w=600&auto=format&fit=crop&q=80', cat:'Букети',  badge:'Новинка',bt:'bdg-new',  big:false },
  { id:7,  name:'Бархатна Троянда',origin:'Троянди · Кенія',          price:950,  photo:'https://images.unsplash.com/photo-1548199569-16a7af26ac87?w=600&auto=format&fit=crop&q=80', cat:'Троянди', badge:'',      bt:'',         big:false },
  { id:8,  name:'Лісова Казка',    origin:'Піони · Франція',          price:1850, photo:'https://images.unsplash.com/photo-1591886960571-74d43a9d4166?w=600&auto=format&fit=crop&q=80', cat:'Піони',   badge:'Хіт',   bt:'bdg-hit',  big:false },
];

const DEFAULT_SETTINGS = {
  siteName:    'Квіткова Хата',
  heroTitle:   'Квіти з теплом домашнього саду',
  heroSub:     'Свіжі букети та живі композиції — наче з вашого власного садочку.',
  promoTitle:  'Знижка 30% на весільні композиції',
  promoDesc:   'Лише цього місяця — ексклюзивні знижки на всі весільні букети.',
  phone:       '+38 (044) 123-45-67',
  email:       'info@kvitkovua.ua',
  address:     'вул. Хрещатик, 15, Київ',
  hours:       'Пн–Нд: 8:00–22:00',
  instagram:   '#',
  telegram:    '#',
};

let products    = load('products.json', DEFAULT_PRODUCTS);
let settings    = load('settings.json', DEFAULT_SETTINGS);
let serverOrders = load('orders.json', []);

// ── Chat storage ───────────────────────────────────────────────
const sessions      = new Map();   // sessionId → [{role,name,text,time}]
const pendingReplies = new Map();  // sessionId → [{text,time}]
let lastUpdateId = 0;
let botUsername  = '';

// ══════════════════════════════════════════════════════════════
//  ADMIN AUTH
// ══════════════════════════════════════════════════════════════
function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== ADMIN_PASS) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  next();
}

// ══════════════════════════════════════════════════════════════
//  PUBLIC API
// ══════════════════════════════════════════════════════════════

// Products (public — website fetches from here)
app.get('/api/products', (_req, res) => res.json({ ok: true, products }));

// Settings (public — website can fetch branding)
app.get('/api/settings', (_req, res) => res.json({ ok: true, settings }));

// Orders — client submits when checkout
app.post('/api/orders', (req, res) => {
  const o = { ...req.body, id: '#' + Math.floor(10000 + Math.random() * 90000), createdAt: Date.now(), status: 'processing' };
  serverOrders.unshift(o);
  save('orders.json', serverOrders);
  // Notify Telegram
  if (ADMIN_IDS.length && BOT_TOKEN) {
    const txt = `🛒 <b>Нове замовлення ${o.id}</b>\n👤 ${escTg(o.clientName||'Анонім')}\n📱 ${escTg(o.phone||'—')}\n💰 ${o.total} ₴\n📦 ${escTg(o.items||'')}\n📍 ${escTg(o.address||'—')}`;
    ADMIN_IDS.forEach(id => tgSend(id, txt));
  }
  res.json({ ok: true, order: o });
});

// Chat
app.post('/api/chat/send', async (req, res) => {
  const { sessionId, name, message } = req.body;
  if (!sessionId || !message) return res.status(400).json({ ok: false });
  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  sessions.get(sessionId).push({ role: 'client', name: name || 'Анонім', text: message, time: Date.now() });

  const clientName = name || 'Анонім';
  const tgText = `🌸 <b>Квіткова Хата</b>\n━━━━━━━━━━━━━━━\n👤 <b>${escTg(clientName)}</b>\n🆔 <code>${sessionId}</code>\n💬 ${escTg(message)}\n━━━━━━━━━━━━━━━\n<code>/reply ${sessionId} Відповідь</code>`;
  if (ADMIN_IDS.length) await Promise.all(ADMIN_IDS.map(id => tgSend(id, tgText)));
  res.json({ ok: true });
});

app.get('/api/chat/replies/:sessionId', (req, res) => {
  const since = parseInt(req.query.since) || 0;
  const replies = (pendingReplies.get(req.params.sessionId) || []).filter(r => r.time > since);
  res.json({ ok: true, replies });
});

// Keepalive
app.get('/ping', (_req, res) => res.send('pong 🌸'));
app.get('/api/health', (_req, res) => res.json({ ok: true, bot: !!BOT_TOKEN, sessions: sessions.size, orders: serverOrders.length }));

// ══════════════════════════════════════════════════════════════
//  ADMIN API
// ══════════════════════════════════════════════════════════════

// Auth check
app.post('/api/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASS) res.json({ ok: true, token: ADMIN_PASS });
  else res.status(401).json({ ok: false, error: 'Невірний пароль' });
});

// ── Products CRUD ──
app.get('/api/admin/products', adminAuth, (_req, res) => res.json({ ok: true, products }));

app.post('/api/admin/products', adminAuth, (req, res) => {
  const p = { ...req.body, id: Date.now(), bt: badgeType(req.body.badge) };
  products.push(p);
  save('products.json', products);
  res.json({ ok: true, product: p });
});

app.put('/api/admin/products/:id', adminAuth, (req, res) => {
  const idx = products.findIndex(p => String(p.id) === req.params.id);
  if (idx < 0) return res.json({ ok: false });
  products[idx] = { ...products[idx], ...req.body, bt: badgeType(req.body.badge || products[idx].badge) };
  save('products.json', products);
  res.json({ ok: true, product: products[idx] });
});

app.delete('/api/admin/products/:id', adminAuth, (req, res) => {
  products = products.filter(p => String(p.id) !== req.params.id);
  save('products.json', products);
  res.json({ ok: true });
});

// ── Orders ──
app.get('/api/admin/orders', adminAuth, (_req, res) => res.json({ ok: true, orders: serverOrders }));

app.put('/api/admin/orders/:id', adminAuth, (req, res) => {
  const idx = serverOrders.findIndex(o => o.id === req.params.id);
  if (idx >= 0) { serverOrders[idx] = { ...serverOrders[idx], ...req.body }; save('orders.json', serverOrders); }
  res.json({ ok: true });
});

app.delete('/api/admin/orders/:id', adminAuth, (req, res) => {
  serverOrders = serverOrders.filter(o => o.id !== req.params.id);
  save('orders.json', serverOrders);
  res.json({ ok: true });
});

// ── Chat sessions ──
app.get('/api/admin/sessions', adminAuth, (_req, res) => {
  const list = [...sessions.entries()].map(([id, msgs]) => ({
    id,
    name: msgs.find(m => m.name)?.name || 'Анонім',
    msgs,
    replies: pendingReplies.get(id) || [],
    lastTime: msgs[msgs.length - 1]?.time || 0,
    lastText: msgs[msgs.length - 1]?.text || '',
    unread: msgs.filter(m => m.role === 'client').length,
  }));
  list.sort((a, b) => b.lastTime - a.lastTime);
  res.json({ ok: true, sessions: list });
});

app.post('/api/admin/reply', adminAuth, (req, res) => {
  const { sessionId, text } = req.body;
  if (!sessionId || !text) return res.json({ ok: false });
  if (!pendingReplies.has(sessionId)) pendingReplies.set(sessionId, []);
  pendingReplies.get(sessionId).push({ text, time: Date.now() });
  res.json({ ok: true });
});

// ── Settings ──
app.get('/api/admin/settings', adminAuth, (_req, res) => res.json({ ok: true, settings }));

app.put('/api/admin/settings', adminAuth, (req, res) => {
  settings = { ...settings, ...req.body };
  save('settings.json', settings);
  res.json({ ok: true, settings });
});

// ── Stats ──
app.get('/api/admin/stats', adminAuth, (_req, res) => {
  const totalRevenue = serverOrders.reduce((s, o) => s + (o.total || 0), 0);
  const delivered = serverOrders.filter(o => o.status === 'delivered').length;
  res.json({
    ok: true,
    stats: {
      products:    products.length,
      orders:      serverOrders.length,
      revenue:     totalRevenue,
      delivered,
      sessions:    sessions.size,
    },
  });
});

// ══════════════════════════════════════════════════════════════
//  TELEGRAM
// ══════════════════════════════════════════════════════════════
function tgRequest(method, body = {}) {
  return new Promise(resolve => {
    if (!BOT_TOKEN) { resolve({ ok: false }); return; }
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ ok: false }); } }); });
    req.on('error', () => resolve({ ok: false }));
    req.write(payload); req.end();
  });
}
function tgGet(method, params = {}) {
  return new Promise(resolve => {
    if (!BOT_TOKEN) { resolve({ ok: false, result: [] }); return; }
    const qs = new URLSearchParams(params).toString();
    https.get(`https://api.telegram.org/bot${BOT_TOKEN}/${method}?${qs}`, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ ok: false, result: [] }); } });
    }).on('error', () => resolve({ ok: false, result: [] }));
  });
}
async function tgSend(chatId, text, extra = {}) {
  return tgRequest('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
}

async function pollTelegram() {
  while (true) {
    try {
      const data = await tgGet('getUpdates', { offset: lastUpdateId, timeout: 15, allowed_updates: '["message"]' });
      if (data.ok && data.result?.length) {
        for (const upd of data.result) {
          lastUpdateId = upd.update_id + 1;
          await handleTg(upd);
        }
      }
    } catch (_) {}
    await sleep(1000);
  }
}

async function handleTg(update) {
  const msg = update.message;
  if (!msg?.text) return;
  const text = msg.text.trim(), chatId = msg.chat.id;

  if (text === '/start') {
    return tgSend(chatId,
      `🌿 <b>Квіткова Хата — Підтримка</b>\n\nКоманди:\n` +
      `/reply {ID} {текст} — відповісти клієнту\n/sessions — активні чати\n\n` +
      `🖥 Адмін-панель:\nhttps://kvitkovua-chat.onrender.com/admin`
    );
  }
  const rm = text.match(/^\/reply\s+(\S+)\s+([\s\S]+)$/);
  if (rm) {
    const [, sid, txt] = rm;
    if (!pendingReplies.has(sid)) pendingReplies.set(sid, []);
    pendingReplies.get(sid).push({ text: txt.trim(), time: Date.now() });
    return tgSend(chatId, `✅ Відповідь надіслано (${sid})`);
  }
  if (text === '/sessions') {
    if (!sessions.size) return tgSend(chatId, '📭 Немає активних чатів');
    const list = [...sessions.entries()].map(([id, m]) => `• <code>${id}</code> — ${m[m.length-1]?.text?.slice(0,30)}`).join('\n');
    return tgSend(chatId, `📋 <b>Чати (${sessions.size}):</b>\n${list}`);
  }
}

// ══════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════
function escTg(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function badgeType(b) {
  if (!b) return '';
  const l = b.toLowerCase();
  if (l.includes('%') || l.includes('знижка')) return 'bdg-sale';
  if (l.includes('нов')) return 'bdg-new';
  return 'bdg-hit';
}

// ══════════════════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════════════════
app.listen(PORT, async () => {
  console.log('\n' + '═'.repeat(52));
  console.log('  🌿  Квіткова Хата — Server');
  console.log('═'.repeat(52));
  console.log(`  🚀  API:     http://localhost:${PORT}/api`);
  console.log(`  🖥  Admin:   http://localhost:${PORT}/admin`);
  console.log(`  🔑  Pass:    ${ADMIN_PASS}`);
  console.log('─'.repeat(52));

  if (BOT_TOKEN) {
    const me = await tgGet('getMe');
    if (me.ok) { botUsername = me.result.username; console.log(`  🤖  Bot:     @${botUsername}`); }
    if (ADMIN_IDS.length) {
      console.log(`  👤  Admins:  ${ADMIN_IDS.join(', ')}`);
      await Promise.all(ADMIN_IDS.map(id =>
        tgSend(id, `🌿 <b>Сервер запущено!</b>\n🖥 Адмін: https://kvitkovua-chat.onrender.com/admin`)
      ));
    }
  }
  console.log('─'.repeat(52));
  console.log('  📡  Telegram polling...\n');
  pollTelegram();
});
