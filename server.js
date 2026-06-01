require('dotenv').config();
const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
const PORT = process.env.PORT || process.env.CHAT_PORT || 3001;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '';
// All admins who receive client messages
const ADMIN_IDS = [
  ...( ADMIN_CHAT_ID ? [ADMIN_CHAT_ID] : [] ),
  '733589995', // @dorisey
].filter((v, i, a) => a.indexOf(v) === i); // deduplicate
const SITE_ORIGIN = `http://localhost:${process.env.SITE_PORT || 3000}`;

app.use(cors({ origin: '*' }));
app.use(express.json());

// ── In-memory storage ──────────────────────────────────────────
// sessions: sessionId → [{ role, text, name, time }]
const sessions = new Map();
// pending replies from Telegram: sessionId → [{ text, time }]
const pendingReplies = new Map();

let lastUpdateId = 0;
let botUsername = '';

// ══════════════════════════════════════════════════════════════
//   TELEGRAM API helpers
// ══════════════════════════════════════════════════════════════
function tgRequest(method, body = {}) {
  return new Promise((resolve) => {
    if (!BOT_TOKEN) { resolve({ ok: false, error: 'No token' }); return; }
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ ok: false }); }
      });
    });
    req.on('error', () => resolve({ ok: false }));
    req.write(payload);
    req.end();
  });
}

function tgGet(method, params = {}) {
  return new Promise((resolve) => {
    if (!BOT_TOKEN) { resolve({ ok: false, result: [] }); return; }
    const qs = new URLSearchParams(params).toString();
    https.get(`https://api.telegram.org/bot${BOT_TOKEN}/${method}?${qs}`, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ ok: false, result: [] }); }
      });
    }).on('error', () => resolve({ ok: false, result: [] }));
  });
}

async function tgSend(chatId, text, extra = {}) {
  return tgRequest('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
}

// ══════════════════════════════════════════════════════════════
//   TELEGRAM LONG POLLING
// ══════════════════════════════════════════════════════════════
async function pollTelegram() {
  while (true) {
    try {
      const data = await tgGet('getUpdates', {
        offset: lastUpdateId,
        timeout: 15,
        allowed_updates: JSON.stringify(['message']),
      });

      if (data.ok && data.result && data.result.length) {
        for (const update of data.result) {
          lastUpdateId = update.update_id + 1;
          await handleTelegramUpdate(update);
        }
      }
    } catch (_) {
      // network blip — retry
    }
    await sleep(1000);
  }
}

async function handleTelegramUpdate(update) {
  const msg = update.message;
  if (!msg || !msg.text) return;

  const text = msg.text.trim();
  const chatId = msg.chat.id;

  // /start
  if (text === '/start') {
    await tgSend(chatId,
      `🌸 <b>Квіткова — Панель підтримки</b>\n\n` +
      `Тут ви будете отримувати повідомлення від клієнтів сайту.\n\n` +
      `<b>Як відповісти клієнту:</b>\n` +
      `<code>/reply {ID} Ваш текст відповіді</code>\n\n` +
      `<b>Наприклад:</b>\n` +
      `<code>/reply abc123 Добрий день! Звичайно, допоможемо!</code>\n\n` +
      `ℹ️ ID сесії вказано у кожному повідомленні від клієнта.`
    );
    return;
  }

  // /reply {sessionId} {message}
  const replyMatch = text.match(/^\/reply\s+(\S+)\s+([\s\S]+)$/);
  if (replyMatch) {
    const [, sessionId, replyText] = replyMatch;
    if (!pendingReplies.has(sessionId)) pendingReplies.set(sessionId, []);
    pendingReplies.get(sessionId).push({ text: replyText.trim(), time: Date.now() });
    await tgSend(chatId,
      `✅ <b>Відповідь надіслано!</b>\n` +
      `🆔 Сесія: <code>${sessionId}</code>\n` +
      `💬 Текст: ${replyText.trim()}`
    );
    return;
  }

  // /sessions — список активних сесій
  if (text === '/sessions') {
    if (sessions.size === 0) {
      await tgSend(chatId, '📭 Активних діалогів немає.');
    } else {
      const list = [...sessions.entries()].map(([id, msgs]) => {
        const last = msgs[msgs.length - 1];
        return `• <code>${id}</code> — ${last.name || 'Анонім'}: ${last.text.slice(0, 40)}...`;
      }).join('\n');
      await tgSend(chatId, `📋 <b>Активні діалоги (${sessions.size}):</b>\n\n${list}`);
    }
    return;
  }

  // Unknow command
  if (text.startsWith('/')) {
    await tgSend(chatId,
      `❓ Невідома команда.\n\n` +
      `Доступні команди:\n` +
      `/start — довідка\n` +
      `/sessions — активні діалоги\n` +
      `/reply {ID} {текст} — відповісти клієнту`
    );
  }
}

// ══════════════════════════════════════════════════════════════
//   REST API
// ══════════════════════════════════════════════════════════════

// POST /api/chat/send — повідомлення від клієнта
app.post('/api/chat/send', async (req, res) => {
  const { sessionId, name, message } = req.body;
  if (!sessionId || !message) {
    return res.status(400).json({ ok: false, error: 'Missing fields' });
  }

  // Store
  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  sessions.get(sessionId).push({ role: 'client', name: name || 'Анонім', text: message, time: Date.now() });

  // Forward to Telegram
  const clientName = name || 'Анонім';
  const tgText =
    `🌸 <b>Квіткова — Нове повідомлення</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>Клієнт:</b> ${escTg(clientName)}\n` +
    `🆔 <b>Сесія:</b> <code>${sessionId}</code>\n` +
    `💬 <b>Повідомлення:</b>\n${escTg(message)}\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `📲 <i>Відповісти:</i>\n` +
    `<code>/reply ${sessionId} Ваш текст</code>`;

  if (ADMIN_IDS.length) {
    await Promise.all(ADMIN_IDS.map(id => tgSend(id, tgText)));
  } else {
    console.log('[TG not configured] Would send:', tgText);
  }

  res.json({ ok: true });
});

// GET /api/chat/replies/:sessionId?since=timestamp
app.get('/api/chat/replies/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const since = parseInt(req.query.since) || 0;
  const replies = (pendingReplies.get(sessionId) || []).filter((r) => r.time > since);
  res.json({ ok: true, replies });
});

// GET /ping — keepalive for Render free tier
app.get('/ping', (req, res) => res.send('pong 🌸'));

// GET /api/health
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    bot: !!BOT_TOKEN,
    admin: !!ADMIN_CHAT_ID,
    activeSessions: sessions.size,
  });
});

// ══════════════════════════════════════════════════════════════
//   UTILS
// ══════════════════════════════════════════════════════════════
function escTg(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ══════════════════════════════════════════════════════════════
//   START
// ══════════════════════════════════════════════════════════════
app.listen(PORT, async () => {
  console.log('\n' + '═'.repeat(50));
  console.log('  🌸  Квіткова — Chat Support Server');
  console.log('═'.repeat(50));
  console.log(`  🚀  API:        http://localhost:${PORT}/api`);
  console.log(`  🌐  Сайт:       ${SITE_ORIGIN}`);
  console.log('─'.repeat(50));

  if (!BOT_TOKEN || BOT_TOKEN === 'YOUR_BOT_TOKEN') {
    console.log('  ❌  BOT_TOKEN не вказано!');
    console.log('      Скопіюйте .env.example → .env і заповніть');
  } else {
    const me = await tgGet('getMe');
    if (me.ok) {
      botUsername = me.result.username;
      console.log(`  🤖  Бот:        @${botUsername}`);
    }
    if (!ADMIN_CHAT_ID) {
      console.log('  ❌  ADMIN_CHAT_ID не вказано!');
    } else {
      console.log(`  👤  Адміни:     ${ADMIN_IDS.join(', ')}`);
      await Promise.all(ADMIN_IDS.map(id => tgSend(id, '🌸 <b>Сервер підтримки запущено!</b>\nНадсилайте /start для довідки.')));
    }
  }

  console.log('─'.repeat(50));
  console.log('  📡  Long polling Telegram...\n');
  pollTelegram();
});
