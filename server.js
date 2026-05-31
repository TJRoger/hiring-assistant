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
import logger from './logger.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// Free quota configuration
const FREE_QUOTA_INPUT_TOKENS = parseInt(process.env.FREE_QUOTA_INPUT_TOKENS) || 100000;
const FREE_QUOTA_OUTPUT_TOKENS = parseInt(process.env.FREE_QUOTA_OUTPUT_TOKENS) || 20000;

// User usage tracking
const userUsagePath = path.join(__dirname, 'config', 'user-usage.json');
const userOwnKeyUsagePath = path.join(__dirname, 'config', 'user-usage-own-key.json');

function loadUserUsage(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

function saveUserUsage(filePath, usage) {
  fs.writeFileSync(filePath, JSON.stringify(usage, null, 2));
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function updateUserUsage(record, responseUsage) {
  const now = new Date();
  const inputDelta = (responseUsage.input_tokens || 0)
    + (responseUsage.cache_creation_input_tokens || 0)
    + (responseUsage.cache_read_input_tokens || 0);
  const outputDelta = responseUsage.output_tokens || 0;

  if (!record.week_start || now.getTime() - new Date(record.week_start).getTime() >= WEEK_MS) {
    record.week_start = now.toISOString();
    record.week_input_tokens = 0;
    record.week_output_tokens = 0;
  }

  record.week_input_tokens = (record.week_input_tokens || 0) + inputDelta;
  record.week_output_tokens = (record.week_output_tokens || 0) + outputDelta;
  record.total_input_tokens = (record.total_input_tokens || 0) + inputDelta;
  record.total_output_tokens = (record.total_output_tokens || 0) + outputDelta;
  record.updated_at = now.toISOString();
}

let userUsage = loadUserUsage(userUsagePath);
let userOwnKeyUsage = loadUserUsage(userOwnKeyUsagePath);

const usersConfigPath = path.join(__dirname, 'config', 'users.json');
if (!fs.existsSync(usersConfigPath)) {
  logger.error('❌ Missing config/users.json. Copy config/users.example.json and add your users.');
  process.exit(1);
}

let users;
try {
  users = JSON.parse(fs.readFileSync(usersConfigPath, 'utf-8')).users;
} catch (e) {
  logger.error(`❌ Invalid config/users.json: ${e.message}`);
  process.exit(1);
}

if (!process.env.SESSION_SECRET) {
  logger.error('❌ SESSION_SECRET not set in .env');
  process.exit(1);
}

let agentTokens = [];
const agentTokensPath = path.join(__dirname, 'config', 'agent-tokens.json');
try {
  agentTokens = loadAgentTokens(agentTokensPath);
  if (agentTokens.length > 0) {
    logger.info(`✅ Loaded ${agentTokens.length} agent token(s)`);
  } else {
    logger.warn('⚠️  config/agent-tokens.json not found; /api/agent/* will reject all requests');
  }
} catch (e) {
  logger.error(`❌ Invalid config/agent-tokens.json: ${e.message}`);
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
        if (added.length) logger.info(`🔄 Agent tokens added: ${added.join(', ')}`);
        if (removed.length) logger.info(`🔄 Agent tokens removed: ${removed.join(', ')}`);
        logger.info(`🔄 Reloaded ${agentTokens.length} agent token(s)`);
      } catch (e) {
        logger.error(`🔄 Failed to reload agent-tokens.json: ${e.message} — keeping previous config`);
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
logger.warn('⚠️  Warning: ANTHROPIC_AUTH_TOKEN not set. Copy .env.example to .env and add your key.');
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
    logger.warn('agent auth failed');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.agent = {
    name: matched.name,
    weekly_input_token_limit: matched.weekly_input_token_limit,
    weekly_output_token_limit: matched.weekly_output_token_limit
  };
  logger.info(`agent=${matched.name} ${req.method} ${req.path}`);
  next();
}

function checkFreeQuota(req, res, next) {
  if (req.headers['x-user-api-key']) return next();

  const username = req.session.user.username;
  if (!userUsage[username]) {
    userUsage[username] = {
      week_start: new Date().toISOString(),
      week_input_tokens: 0,
      week_output_tokens: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  const record = userUsage[username];

  if (Date.now() - new Date(record.week_start).getTime() >= WEEK_MS) {
    record.week_start = new Date().toISOString();
    record.week_input_tokens = 0;
    record.week_output_tokens = 0;
  }

  const inputExceeded = record.week_input_tokens >= FREE_QUOTA_INPUT_TOKENS;
  const outputExceeded = record.week_output_tokens >= FREE_QUOTA_OUTPUT_TOKENS;

  if (inputExceeded || outputExceeded) {
    return res.status(429).json({
      error: 'Free quota exceeded. Provide your own API key via x-user-api-key header to continue.',
      type: 'quota_exceeded',
      quota: { input: FREE_QUOTA_INPUT_TOKENS, output: FREE_QUOTA_OUTPUT_TOKENS },
      used: { input: record.week_input_tokens, output: record.week_output_tokens },
    });
  }

  next();
}

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const who = req.agent
      ? `agent=${req.agent.name}`
      : req.session?.user
        ? `user=${req.session.user.username}`
        : 'unauthenticated';
    const tokens = res.locals.usage
      ? ` input=${res.locals.usage.input} output=${res.locals.usage.output}`
      : '';
    logger.info(`[REQUEST] ${req.method} ${req.path} ${who} status=${res.statusCode} duration=${duration}ms${tokens}`);
  });
  next();
});

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

    // Record token usage
    if (response.usage) {
      const username = req.session.user.username;
      if (usingOwnKey) {
        if (!userOwnKeyUsage[username]) {
          userOwnKeyUsage[username] = {
            week_start: new Date().toISOString(),
            week_input_tokens: 0,
            week_output_tokens: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
        }
        updateUserUsage(userOwnKeyUsage[username], response.usage);
        saveUserUsage(userOwnKeyUsagePath, userOwnKeyUsage);
      } else {
        if (!userUsage[username]) {
          userUsage[username] = {
            week_start: new Date().toISOString(),
            week_input_tokens: 0,
            week_output_tokens: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
        }
        updateUserUsage(userUsage[username], response.usage);
        saveUserUsage(userUsagePath, userUsage);
      }
    }

    if (response.usage) {
      const inputTotal = (response.usage.input_tokens || 0)
        + (response.usage.cache_creation_input_tokens || 0)
        + (response.usage.cache_read_input_tokens || 0);
      res.locals.usage = { input: inputTotal, output: response.usage.output_tokens || 0 };
    }
    res.json(response);
  } catch (err) {
    logger.error(`API error: ${err.message}`);
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
    if (response.usage) {
      const inputTotal = (response.usage.input_tokens || 0)
        + (response.usage.cache_creation_input_tokens || 0)
        + (response.usage.cache_read_input_tokens || 0);
      res.locals.usage = { input: inputTotal, output: response.usage.output_tokens || 0 };
    }
    res.json(response);
  } catch (err) {
    logger.error(`API error: ${err.message}`);
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
      let startUsage = null;
      let lastUsage = null;
      for await (const event of response) {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        if (event.type === 'message_start' && event.message?.usage) startUsage = event.message.usage;
        if (event.type === 'message_delta' && event.usage) lastUsage = event.usage;
      }
      if (lastUsage || startUsage) {
        const mergedUsage = {
          input_tokens: startUsage?.input_tokens || 0,
          cache_creation_input_tokens: startUsage?.cache_creation_input_tokens || 0,
          cache_read_input_tokens: startUsage?.cache_read_input_tokens || 0,
          output_tokens: lastUsage?.output_tokens || 0,
        };
        recordUsage(agentUsage, req.agent.name, mergedUsage);
        saveUsage(agentUsagePath, agentUsage, new Set(agentTokens.map(t => t.name)));
        res.locals.usage = {
          input: (mergedUsage.input_tokens) + (mergedUsage.cache_creation_input_tokens) + (mergedUsage.cache_read_input_tokens),
          output: mergedUsage.output_tokens,
        };
      }
      res.end();
    } else {
      if (response.usage) {
        recordUsage(agentUsage, req.agent.name, response.usage);
        saveUsage(agentUsagePath, agentUsage, new Set(agentTokens.map(t => t.name)));
      }
      if (response.usage) {
        const inputTotal = (response.usage.input_tokens || 0)
          + (response.usage.cache_creation_input_tokens || 0)
          + (response.usage.cache_read_input_tokens || 0);
        res.locals.usage = { input: inputTotal, output: response.usage.output_tokens || 0 };
      }
      res.json(response);
    }
  } catch (err) {
    logger.error(`API error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/usage', requireAuth, (req, res) => {
  const username = req.session.user.username;
  const record = userUsage[username] || {
    week_input_tokens: 0,
    week_output_tokens: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    created_at: null,
    updated_at: null,
  };
  res.json({
    weekInputTokens: record.week_input_tokens,
    weekOutputTokens: record.week_output_tokens,
    totalInputTokens: record.total_input_tokens,
    totalOutputTokens: record.total_output_tokens,
    inputTokensQuota: FREE_QUOTA_INPUT_TOKENS,
    outputTokensQuota: FREE_QUOTA_OUTPUT_TOKENS,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  });
});

// Serve built frontend in production
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
logger.info(`✅ Server running on http://localhost:${PORT}`);
});
