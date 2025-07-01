// server.js
// ─────────────────────────────────────────────────────────────────────
// Node.js backend for multi-session WhatsApp integration via whatsapp-web.js
// Provides per-session QR (as PNG data URL), health-check, send-message endpoints
// ─────────────────────────────────────────────────────────────────────

const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory map: sessionId -> { client, ready, qrDataUrl }
const sessions = new Map();

// Helper: initialize a WhatsApp client for a session
function initSession(sessionId) {
  if (sessions.has(sessionId)) {
    return sessions.get(sessionId);
  }

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: sessionId }),
    puppeteer: { headless: true }
  });

  const session = { client, ready: false, qrDataUrl: null };
  sessions.set(sessionId, session);

  // QR code event - convert text QR to PNG data URL
  client.on('qr', async qr => {
    try {
      const dataUrl = await QRCode.toDataURL(qr);
      session.qrDataUrl = dataUrl;
      console.log(`Session ${sessionId}: QR generated`);
    } catch (err) {
      console.error(`Session ${sessionId}: QR generation error`, err);
    }
  });

  // Ready event
  client.on('ready', () => {
    session.ready = true;
    console.log(`Session ${sessionId}: client ready`);
  });

  // Auth failure
  client.on('auth_failure', msg => {
    console.error(`Session ${sessionId}: auth failure`, msg);
    session.ready = false;
  });

  // Disconnected
  client.on('disconnected', reason => {
    console.log(`Session ${sessionId}: disconnected`, reason);
    session.ready = false;
    session.qrDataUrl = null;
    client.initialize();
  });

  client.initialize();
  return session;
}

// 1) GET /register?sessionId=... -> { qrDataUrl: "data:image/png;base64,..." }
app.get('/register', (req, res) => {
  const sessionId = req.query.sessionId;
  if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });

  const session = initSession(sessionId);
  // If QR not generated yet, return qrDataUrl: null
  return res.json({ qrDataUrl: session.qrDataUrl });
});

// 2) GET /health?sessionId=... -> { status: "initializing" | "ready" }
app.get('/health', (req, res) => {
  const sessionId = req.query.sessionId;
  if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });

  const session = sessions.get(sessionId);
  if (!session) {
    return res.json({ status: 'initializing' });
  }
  return res.json({ status: session.ready ? 'ready' : 'initializing' });
});

// 3) POST /send { sessionId, to, text } -> sends message
app.post('/send', async (req, res) => {
  const { sessionId, to, text } = req.body;
  if (!sessionId || !to || !text) {
    return res.status(400).json({ error: 'Missing sessionId, to, or text' });
  }

  const session = sessions.get(sessionId);
  if (!session || !session.ready) {
    return res.status(503).json({ error: 'Session not ready' });
  }

  try {
    const chatId = `${to}@c.us`;
    await session.client.sendMessage(chatId, text);
    return res.json({ success: true });
  } catch (err) {
    console.error(`Session ${sessionId} send error:`, err);
    return res.status(500).json({ error: err.message });
  }
});

// 4) GET /send?sessionId=...&to=...&text=... -> sends message (for public links)
app.get('/send', async (req, res) => {
  const { sessionId, to, text } = req.query;

  if (!sessionId || !to || !text) {
    return res.status(400).send("❌ Missing sessionId, to, or text");
  }

  const session = sessions.get(sessionId);
  if (!session || !session.ready) {
    return res.status(503).send("⏳ Session not ready");
  }

  try {
    const chatId = `${to}@c.us`;
    await session.client.sendMessage(chatId, text);
    return res.send("✅ Message sent successfully!");
  } catch (err) {
    console.error(`Send error:`, err);
    return res.status(500).send("❌ Failed to send message");
  }
});

// Serve register.html as default
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));