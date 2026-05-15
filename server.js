import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import fs from 'fs';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

const usersConfigPath = path.join(__dirname, 'config', 'users.json');
if (!fs.existsSync(usersConfigPath)) {
  console.error('❌ Missing config/users.json. Copy config/users.example.json and add your users.');
  process.exit(1);
}

let users;
try {
  users = JSON.parse(fs.readFileSync(usersConfigPath, 'utf-8')).users;
} catch (e) {
  console.error('❌ Invalid config/users.json:', e.message);
  process.exit(1);
}

if (!process.env.SESSION_SECRET) {
  console.error('❌ SESSION_SECRET not set in .env');
  process.exit(1);
}

// Load agent tokens (optional — server boots without them)
let agentTokens = [];
const agentTokensPath = path.join(__dirname, 'config', 'agent-tokens.json');
if (fs.existsSync(agentTokensPath)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(agentTokensPath, 'utf-8'));
    if (!Array.isArray(parsed.tokens)) throw new Error('tokens must be an array');
    const seen = new Set();
    for (const entry of parsed.tokens) {
      if (!entry.name || !entry.token) throw new Error('each token entry needs name and token');
      if (seen.has(entry.token)) {
        console.warn(`⚠️  Duplicate agent token for "${entry.name}" — keeping first occurrence`);
        continue;
      }
      seen.add(entry.token);
      agentTokens.push(entry);
    }
    console.log(`✅ Loaded ${agentTokens.length} agent token(s)`);
  } catch (e) {
    console.error('❌ Invalid config/agent-tokens.json:', e.message);
    process.exit(1);
  }
} else {
  console.warn('⚠️  config/agent-tokens.json not found; /api/agent/* will reject all requests');
}

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

if (!process.env.ANTHROPIC_AUTH_TOKEN) {
  console.warn('⚠️  Warning: ANTHROPIC_AUTH_TOKEN not set. Copy .env.example to .env and add your key.');
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
  ...(process.env.ANTHROPIC_BASE_URL && { baseURL: process.env.ANTHROPIC_BASE_URL })
});

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function requireAgentToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const presented = auth.slice(7);
  const presentedBuf = Buffer.from(presented);
  let matched = null;
  for (const entry of agentTokens) {
    const entryBuf = Buffer.from(entry.token);
    if (presentedBuf.length === entryBuf.length && crypto.timingSafeEqual(presentedBuf, entryBuf)) {
      matched = entry;
    }
  }
  if (!matched) {
    console.warn('agent auth failed');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.agent = { name: matched.name };
  console.log(`agent=${matched.name} ${req.method} ${req.path}`);
  next();
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  req.session.user = { username: user.username };
  res.json({ username: user.username });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json(req.session.user);
});

app.post('/api/claude', requireAuth, async (req, res) => {
  try {
    const { messages, system, max_tokens = 16000 } = req.body;
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens,
      messages,
      ...(system && { system })
    });
    res.json(response);
  } catch (err) {
    console.error('API error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agent/claude', requireAgentToken, async (req, res) => {
  try {
    const { messages, system, max_tokens = 16000 } = req.body;
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens,
      messages,
      ...(system && { system })
    });
    res.json(response);
  } catch (err) {
    console.error('API error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Serve built frontend in production
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
