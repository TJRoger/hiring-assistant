import express from 'express';
import cors from 'cors';
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
