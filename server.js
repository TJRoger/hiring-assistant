import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import fs from 'fs';
import { loadAgentTokens, loadUsage, saveUsage, enforceTokenLimit, recordUsage } from './server-lib.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// Free quota configuration
const FREE_QUOTA_INPUT_TOKENS = parseInt(process.env.FREE_QUOTA_INPUT_TOKENS) || 100000;
const FREE_QUOTA_OUTPUT_TOKENS = parseInt(process.env.FREE_QUOTA_OUTPUT_TOKENS) || 20000;

// User usage tracking
const userUsagePath = path.join(__dirname, 'config', 'user-usage.json');

function loadUserUsage() {
  try {
    return JSON.parse(fs.readFileSync(userUsagePath, 'utf-8'));
  } catch {
    return {};
  }
}

function saveUserUsage(usage) {
  fs.writeFileSync(userUsagePath, JSON.stringify(usage, null, 2));
}

let userUsage = loadUserUsage();

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

let agentTokens = [];
const agentTokensPath = path.join(__dirname, 'config', 'agent-tokens.json');
try {
  agentTokens = loadAgentTokens(agentTokensPath);
  if (agentTokens.length > 0) {
    console.log(`✅ Loaded ${agentTokens.length} agent token(s)`);
  } else {
    console.warn('⚠️  config/agent-tokens.json not found; /api/agent/* will reject all requests');
  }
} catch (e) {
  console.error('❌ Invalid config/agent-tokens.json:', e.message);
  process.exit(1);
}

const agentUsagePath = path.join(__dirname, 'config', 'agent-usage.json');
let agentUsage = loadUsage(agentUsagePath);

let reloadTimer = null;
if (fs.existsSync(agentTokensPath)) {
  fs.watch(agentTokensPath, () => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      try {
        const newTokens = loadAgentTokens(agentTokensPath);
        const oldNames = new Set(agentTokens.map(t => t.name));
        const newNames = new Set(newTokens.map(t => t.name));
        const added = [...newNames].filter(n => !oldNames.has(n));
        const removed = [...oldNames].filter(n => !newNames.has(n));
        agentTokens = newTokens;
        if (added.length) console.log(`🔄 Agent tokens added: ${added.join(', ')}`);
        if (removed.length) console.log(`🔄 Agent tokens removed: ${removed.join(', ')}`);
        console.log(`🔄 Reloaded ${agentTokens.length} agent token(s)`);
      } catch (e) {
        console.error('🔄 Failed to reload agent-tokens.json:', e.message, '— keeping previous config');
      }
    }, 100);
  });
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
  const apiKey = req.headers['x-api-key'];
  let presented;
  if (apiKey) {
    presented = apiKey;
  } else if (auth && auth.startsWith('Bearer ')) {
    presented = auth.slice(7);
  } else {
    return res.status(401).json({ error: 'Unauthorized' });
  }
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
  req.agent = {
    name: matched.name,
    weekly_input_token_limit: matched.weekly_input_token_limit,
    weekly_output_token_limit: matched.weekly_output_token_limit
  };
  console.log(`agent=${matched.name} ${req.method} ${req.path}`);
  next();
}

function checkFreeQuota(req, res, next) {
  // Skip quota check if user provides their own API key
  if (req.headers['x-user-api-key']) {
    return next();
  }

  const username = req.session.user.username;
  if (!userUsage[username]) {
    userUsage[username] = {
      input_tokens_used: 0,
      output_tokens_used: 0,
      created_at: new Date().toISOString()
    };
  }

  const record = userUsage[username];
  const inputExceeded = record.input_tokens_used >= FREE_QUOTA_INPUT_TOKENS;
  const outputExceeded = record.output_tokens_used >= FREE_QUOTA_OUTPUT_TOKENS;

  if (inputExceeded || outputExceeded) {
    return res.status(429).json({
      error: 'Free quota exceeded. Provide your own API key via x-user-api-key header to continue.',
      type: 'quota_exceeded',
      quota: {
        input: FREE_QUOTA_INPUT_TOKENS,
        output: FREE_QUOTA_OUTPUT_TOKENS
      },
      used: {
        input: record.input_tokens_used,
        output: record.output_tokens_used
      }
    });
  }

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

app.post('/api/claude', requireAuth, checkFreeQuota, async (req, res) => {
  try {
    const { messages, system, max_tokens = 16000 } = req.body;

    // Use user-provided API key if present, otherwise use server default
    const userApiKey = req.headers['x-user-api-key'];
    const userBaseUrl = req.headers['x-user-base-url'];
    const usingOwnKey = !!userApiKey;

    const client = usingOwnKey
      ? new Anthropic({
          apiKey: userApiKey,
          ...(userBaseUrl && { baseURL: userBaseUrl })
        })
      : anthropic;

    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens,
      messages,
      ...(system && { system })
    });

    // Record token usage if using server key
    if (!usingOwnKey && response.usage) {
      const username = req.session.user.username;
      if (!userUsage[username]) {
        userUsage[username] = {
          input_tokens_used: 0,
          output_tokens_used: 0,
          created_at: new Date().toISOString()
        };
      }
      const record = userUsage[username];
      const inputTotal = (response.usage.input_tokens || 0)
        + (response.usage.cache_creation_input_tokens || 0)
        + (response.usage.cache_read_input_tokens || 0);
      record.input_tokens_used += inputTotal;
      record.output_tokens_used += (response.usage.output_tokens || 0);
      saveUserUsage(userUsage);
    }

    res.json(response);
  } catch (err) {
    console.error('API error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agent/claude', requireAgentToken, (req, res, next) => enforceTokenLimit(agentUsage, req, res, next), async (req, res) => {
  try {
    const { messages, system, max_tokens = 16000 } = req.body;
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens,
      messages,
      ...(system && { system })
    });
    if (response.usage) {
      recordUsage(agentUsage, req.agent.name, response.usage);
      saveUsage(agentUsagePath, agentUsage, new Set(agentTokens.map(t => t.name)));
    }
    res.json(response);
  } catch (err) {
    console.error('API error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/v1/messages', requireAgentToken, (req, res, next) => enforceTokenLimit(agentUsage, req, res, next), async (req, res) => {
  try {
    const { messages, system, max_tokens = 16000, model, stream } = req.body;
    const response = await anthropic.messages.create({
      model: model || 'claude-opus-4-7',
      max_tokens,
      messages,
      ...(system && { system }),
      ...(stream && { stream })
    });
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      let lastUsage = null;
      for await (const event of response) {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        if (event.type === 'message_delta' && event.usage) lastUsage = event.usage;
      }
      if (lastUsage) {
        recordUsage(agentUsage, req.agent.name, lastUsage);
        saveUsage(agentUsagePath, agentUsage, new Set(agentTokens.map(t => t.name)));
      }
      res.end();
    } else {
      if (response.usage) {
        recordUsage(agentUsage, req.agent.name, response.usage);
        saveUsage(agentUsagePath, agentUsage, new Set(agentTokens.map(t => t.name)));
      }
      res.json(response);
    }
  } catch (err) {
    console.error('API error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/usage', requireAuth, (req, res) => {
  const username = req.session.user.username;
  const record = userUsage[username] || {
    input_tokens_used: 0,
    output_tokens_used: 0,
    created_at: null
  };
  res.json({
    inputTokensUsed: record.input_tokens_used,
    outputTokensUsed: record.output_tokens_used,
    inputTokensQuota: FREE_QUOTA_INPUT_TOKENS,
    outputTokensQuota: FREE_QUOTA_OUTPUT_TOKENS,
    createdAt: record.created_at
  });
});

// Serve built frontend in production
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
