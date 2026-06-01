require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const https   = require('https');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3001;
const BOT_TOKEN    = process.env.BOT_TOKEN    || '';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '';
const ADMIN_PASS   = process.env.ADMIN_PASSWORD || 'admin123';

const ADMIN_IDS = [...new Set([
  ...(ADMIN_CHAT_ID ? [ADMIN_CHAT_ID] : []),
  '733589995',
])];

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

/* ── Data helpers ─────────────────────────────────────────── */
const DATA = path.join(__dirname, 'data');
try { if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true }); } catch (_) {}

function load(file, def) {
  try { const d = fs.readFileSync(path.join(DATA, file), 'utf8'); return JSON.parse(d); }
  catch { return def; }
}
function save(file, val) {
  try { fs.writeFileSync(path.join(DATA, file), JSON.stringify(val, null, 2), 'utf8'); return true; }
  catch (e) { console.error('save error', file, e.message); return false; }
}

/* ── Default data ─────────────────────────────────────────── */
const DEFAULT_PRODUCTS = [
  { id:1, name:'Ніжна Принцеса',   origin:'Троянди · Еквадор',    price:890,  photo:'https://images.unsplash.com/photo-1562690868-60bbe7293e94?w=600&auto=format&fit=crop&q=80', cat:'Троянди', badge:'Хіт',    bt:'bdg-hit',  big:true  },
  { id:2, name:'Місячний Піон',    origin:'Піони · Нідерланди',   price:1200, photo:'https://images.unsplash.com/photo-1557800636-894a64c1696f?w=600&auto=format&fit=crop&q=80', cat:'Піони',   badge:'Новинка',bt:'bdg-new',  big:false },
  { id:3, name:'Пурпурна Орхідея', origin:'Орхідеї · Таїланд',    price:1650, photo:'https://images.unsplash.com/photo-1524598171353-7d7e46e1f7d1?w=600&auto=format&fit=crop&q=80', cat:'Орхідеї', badge:'',       bt:'',         big:false },
  { id:4, name:'Весняний Вальс',   origin:'Букети · Авторський',   price:2100, oldPrice:2800, photo:'https://images.unsplash.com/photo-1487530811015-780a77aafe2c?w=600&auto=format&fit=crop&q=80', cat:'Букети',  badge:'−25%',  bt:'bdg-sale', big:false },
  { id:5, name:'Золота Весна',     origin:'Тюльпани · Нідерланди', price:650,  photo:'https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=600&auto=format&fit=crop&q=80', cat:'Тюльпани',badge:'',       bt:'',         big:false },
  { id:6, name:'Сонячна Радість',  origin:'Соняшники · Україна',   price:780,  photo:'https://images.unsplash.com/photo-1597848212624-a19eb35e2651?w=600&auto=format&fit=crop&q=80', cat:'Букети',  badge:'Новинка',bt:'bdg-new',  big:false },
  { id:7, name:'Бархатна Троянда', origin:'Троянди · Кенія',       price:950,  photo:'https://images.unsplash.com/photo-1548199569-16a7af26ac87?w=600&auto=format&fit=crop&q=80', cat:'Троянди', badge:'',       bt:'',         big:false },
  { id:8, name:'Лісова Казка',     origin:'Піони · Франція',       price:1850, photo:'https://images.unsplash.com/photo-1591886960571-74d43a9d4166?w=600&auto=format&fit=crop&q=80', cat:'Піони',   badge:'Хіт',    bt:'bdg-hit',  big:false },
];
const DEFAULT_SETTINGS = {
  siteName:'Квіткова Хата', heroTitle:'Квіти з теплом домашнього саду',
  heroSub:'Свіжі букети та живі композиції — наче з вашого власного садочку.',
  promoTitle:'Знижка 30% на весільні композиції',
  promoDesc:'Лише цього місяця — ексклюзивні знижки на всі весільні букети.',
  phone:'+38 (044) 123-45-67', email:'info@kvitkovua.ua',
  address:'вул. Хрещатик, 15, Київ', hours:'Пн–Нд: 8:00–22:00',
  instagram:'#', telegram:'#',
};

let products     = load('products.json', DEFAULT_PRODUCTS);
let settings     = load('settings.json', DEFAULT_SETTINGS);
let serverOrders = load('orders.json',   []);

/* ── Chat storage ─────────────────────────────────────────── */
const sessions       = new Map();
const pendingReplies = new Map();
let lastUpdateId = 0;

/* ── Admin auth ───────────────────────────────────────────── */
function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || token !== ADMIN_PASS)
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  next();
}

/* ═══════════════════════════════════════════════════════════
   PUBLIC API
═══════════════════════════════════════════════════════════ */
app.get('/api/products', (_req, res) => res.json({ ok: true, products }));
app.get('/api/settings', (_req, res) => res.json({ ok: true, settings }));

app.post('/api/orders', (req, res) => {
  const { clientName, phone, address, items, total } = req.body;
  const order = {
    id: '#' + Math.floor(10000 + Math.random() * 90000),
    clientName: clientName || 'Анонім',
    phone:      phone     || '—',
    address:    address   || '—',
    items:      items     || '',
    total:      Number(total) || 0,
    date:       new Date().toLocaleDateString('uk-UA'),
    createdAt:  Date.now(),
    status:     'processing',
  };
  serverOrders.unshift(order);
  save('orders.json', serverOrders);
  if (BOT_TOKEN && ADMIN_IDS.length) {
    const txt =
      `🛒 <b>Нове замовлення ${order.id}</b>\n` +
      `👤 ${escTg(order.clientName)}\n📱 ${escTg(order.phone)}\n` +
      `📍 ${escTg(order.address)}\n💰 ${order.total} ₴\n` +
      `📦 ${escTg(order.items)}`;
    ADMIN_IDS.forEach(id => tgSend(id, txt));
  }
  res.json({ ok: true, order });
});

/* Chat */
app.post('/api/chat/send', async (req, res) => {
  const { sessionId, name, message } = req.body;
  if (!sessionId || !message) return res.status(400).json({ ok: false });
  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  sessions.get(sessionId).push({ role:'client', name: name||'Анонім', text: message, time: Date.now() });
  const tgText =
    `🌸 <b>Квіткова Хата</b>\n━━━━━━━━━━━━\n` +
    `👤 <b>${escTg(name||'Анонім')}</b>\n🆔 <code>${sessionId}</code>\n` +
    `💬 ${escTg(message)}\n━━━━━━━━━━━━\n<code>/reply ${sessionId} Відповідь</code>`;
  if (ADMIN_IDS.length) await Promise.all(ADMIN_IDS.map(id => tgSend(id, tgText)));
  res.json({ ok: true });
});

app.get('/api/chat/replies/:sid', (req, res) => {
  const since = parseInt(req.query.since) || 0;
  const list  = (pendingReplies.get(req.params.sid) || []).filter(r => r.time > since);
  res.json({ ok: true, replies: list });
});

app.get('/ping',       (_req, res) => res.send('pong 🌸'));
app.get('/api/health', (_req, res) => res.json({ ok: true, sessions: sessions.size, orders: serverOrders.length }));

/* ═══════════════════════════════════════════════════════════
   ADMIN API
═══════════════════════════════════════════════════════════ */
app.post('/api/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASS) res.json({ ok: true, token: ADMIN_PASS });
  else res.status(401).json({ ok: false, error: 'Невірний пароль' });
});

/* Stats */
app.get('/api/admin/stats', adminAuth, (_req, res) => {
  res.json({ ok: true, stats: {
    products:  products.length,
    orders:    serverOrders.length,
    revenue:   serverOrders.reduce((s,o) => s + (o.total||0), 0),
    delivered: serverOrders.filter(o => o.status==='delivered').length,
    sessions:  sessions.size,
  }});
});

/* Products */
app.get('/api/admin/products', adminAuth, (_req, res) => res.json({ ok: true, products }));

app.post('/api/admin/products', adminAuth, (req, res) => {
  const { name, cat, origin, price, oldPrice, badge, big, photo } = req.body;
  if (!name || !price || !photo)
    return res.status(400).json({ ok: false, error: 'name, price, photo required' });
  const p = {
    id: Date.now(), name, cat: cat||'Букети', origin: origin||'',
    price: Number(price), oldPrice: oldPrice ? Number(oldPrice) : null,
    badge: badge||'', bt: badgeType(badge), big: big===true||big==='true', photo,
  };
  if (!p.oldPrice) delete p.oldPrice;
  products.push(p);
  save('products.json', products);
  res.json({ ok: true, product: p });
});

app.put('/api/admin/products/:id', adminAuth, (req, res) => {
  const idx = products.findIndex(p => String(p.id) === String(req.params.id));
  if (idx < 0) return res.status(404).json({ ok: false, error: 'not found' });
  const u = req.body;
  products[idx] = {
    ...products[idx], ...u,
    price: Number(u.price || products[idx].price),
    oldPrice: u.oldPrice ? Number(u.oldPrice) : null,
    big: u.big===true || u.big==='true',
    bt: badgeType(u.badge ?? products[idx].badge),
  };
  if (!products[idx].oldPrice) delete products[idx].oldPrice;
  save('products.json', products);
  res.json({ ok: true, product: products[idx] });
});

app.delete('/api/admin/products/:id', adminAuth, (req, res) => {
  const before = products.length;
  products = products.filter(p => String(p.id) !== String(req.params.id));
  save('products.json', products);
  res.json({ ok: true, deleted: before - products.length });
});

/* Orders */
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

/* Chat sessions */
app.get('/api/admin/sessions', adminAuth, (_req, res) => {
  const list = [...sessions.entries()].map(([id, msgs]) => ({
    id, name: msgs.find(m=>m.name)?.name || 'Анонім',
    msgs, replies: pendingReplies.get(id) || [],
    lastTime: msgs[msgs.length-1]?.time || 0,
    lastText: msgs[msgs.length-1]?.text || '',
    unread: msgs.filter(m=>m.role==='client').length,
  })).sort((a,b) => b.lastTime - a.lastTime);
  res.json({ ok: true, sessions: list });
});

app.post('/api/admin/reply', adminAuth, (req, res) => {
  const { sessionId, text } = req.body;
  if (!sessionId || !text) return res.status(400).json({ ok: false });
  if (!pendingReplies.has(sessionId)) pendingReplies.set(sessionId, []);
  pendingReplies.get(sessionId).push({ text, time: Date.now() });
  res.json({ ok: true });
});

/* Settings */
app.get('/api/admin/settings', adminAuth, (_req, res) => res.json({ ok: true, settings }));
app.put('/api/admin/settings', adminAuth, (req, res) => {
  settings = { ...settings, ...req.body };
  save('settings.json', settings);
  res.json({ ok: true, settings });
});

/* ═══════════════════════════════════════════════════════════
   TELEGRAM
═══════════════════════════════════════════════════════════ */
function tgPost(method, body) {
  return new Promise(resolve => {
    if (!BOT_TOKEN) { resolve({ ok: false }); return; }
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d))}catch{resolve({ok:false})} }); });
    req.on('error', () => resolve({ ok: false }));
    req.write(payload); req.end();
  });
}
function tgFetch(method, params={}) {
  return new Promise(resolve => {
    if (!BOT_TOKEN) { resolve({ ok:false, result:[] }); return; }
    const qs = new URLSearchParams(params).toString();
    https.get(`https://api.telegram.org/bot${BOT_TOKEN}/${method}?${qs}`, res => {
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{ try{resolve(JSON.parse(d))}catch{resolve({ok:false,result:[]})} });
    }).on('error', () => resolve({ ok:false, result:[] }));
  });
}
function tgSend(chatId, text, extra={}) {
  return tgPost('sendMessage', { chat_id:chatId, text, parse_mode:'HTML', ...extra });
}

async function pollTelegram() {
  while (true) {
    try {
      const data = await tgFetch('getUpdates', { offset: lastUpdateId, timeout: 15, allowed_updates: '["message"]' });
      if (data.ok && data.result?.length) {
        for (const upd of data.result) {
          lastUpdateId = upd.update_id + 1;
          const msg = upd.message;
          if (!msg?.text) continue;
          const text = msg.text.trim(), chatId = msg.chat.id;
          if (text === '/start') {
            tgSend(chatId, `🌿 <b>Квіткова Хата — Підтримка</b>\n\n/reply {ID} {текст} — відповісти\n/sessions — активні чати\n\n🖥 Адмін: https://kvitkovua-chat.onrender.com/admin`);
            continue;
          }
          const rm = text.match(/^\/reply\s+(\S+)\s+([\s\S]+)$/);
          if (rm) {
            const [, sid, txt] = rm;
            if (!pendingReplies.has(sid)) pendingReplies.set(sid, []);
            pendingReplies.get(sid).push({ text: txt.trim(), time: Date.now() });
            tgSend(chatId, `✅ Надіслано (${sid})`);
            continue;
          }
          if (text === '/sessions') {
            if (!sessions.size) { tgSend(chatId, '📭 Немає активних чатів'); continue; }
            const list = [...sessions.entries()].map(([id,m])=>`• <code>${id}</code> ${m[m.length-1]?.text?.slice(0,30)||''}`).join('\n');
            tgSend(chatId, `📋 <b>Чати (${sessions.size}):</b>\n${list}`);
          }
        }
      }
    } catch (_) {}
    await sleep(1000);
  }
}

/* ── Utils ─────────────────────────────────────────────────── */
function escTg(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function badgeType(b='') {
  const l = b.toLowerCase();
  if (l.includes('%') || l.includes('знижк')) return 'bdg-sale';
  if (l.includes('нов')) return 'bdg-new';
  if (b) return 'bdg-hit';
  return '';
}

/* ── Start ─────────────────────────────────────────────────── */
app.listen(PORT, async () => {
  console.log('\n' + '═'.repeat(52));
  console.log('  🌿  Квіткова Хата — Server v2');
  console.log('═'.repeat(52));
  console.log(`  🚀  http://localhost:${PORT}`);
  console.log(`  🖥   Admin: http://localhost:${PORT}/admin`);
  console.log(`  🔑  Pass: ${ADMIN_PASS}`);
  if (BOT_TOKEN) {
    const me = await tgFetch('getMe');
    if (me.ok) console.log(`  🤖  Bot: @${me.result.username}`);
    if (ADMIN_IDS.length) {
      ADMIN_IDS.forEach(id => tgSend(id,
        `🌿 Сервер запущено!\n🖥 Адмін: https://kvitkovua-chat.onrender.com/admin\n🔑 Пароль: ${ADMIN_PASS}`
      ));
    }
  }
  console.log('  📡  Telegram polling...\n');
  pollTelegram();
});
