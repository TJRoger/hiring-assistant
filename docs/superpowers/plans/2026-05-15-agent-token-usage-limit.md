# Agent Token Weekly Usage Limit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce per-token weekly input/output token limits on the agent API, with rolling 7-day windows, persistent usage tracking, and hot-reload of config changes.

**Architecture:** New `enforceTokenLimit` middleware between `requireAgentToken` and route handlers. Usage tracked in-memory and persisted to `config/agent-usage.json`. Config file watched with `fs.watch` for hot-reload. Token loading extracted into a reusable function shared by startup and reload.

**Tech Stack:** Node.js built-in `node:test` + `node:assert` for testing (zero dependencies). Express middleware. `fs.watch` for hot-reload.

---

### Task 1: Extract token loading into a reusable function

**Files:**
- Modify: `server.js:37-60`

- [ ] **Step 1: Write the failing test**

Create `test/token-limit.test.js`:

```js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures');

describe('loadAgentTokens', () => {
  beforeEach(() => {
    fs.mkdirSync(fixtureDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('loads valid tokens from file', async () => {
    const tokensFile = path.join(fixtureDir, 'agent-tokens.json');
    fs.writeFileSync(tokensFile, JSON.stringify({
      tokens: [
        { name: 'bot-a', token: 'aaa', weekly_input_token_limit: 1000, weekly_output_token_limit: 500 },
        { name: 'bot-b', token: 'bbb' }
      ]
    }));

    const { loadAgentTokens } = await import('../server-lib.js');
    const result = loadAgentTokens(tokensFile);
    assert.equal(result.length, 2);
    assert.equal(result[0].name, 'bot-a');
    assert.equal(result[0].weekly_input_token_limit, 1000);
    assert.equal(result[0].weekly_output_token_limit, 500);
    assert.equal(result[1].weekly_input_token_limit, undefined);
  });

  it('returns empty array when file missing', async () => {
    const { loadAgentTokens } = await import('../server-lib.js');
    const result = loadAgentTokens('/nonexistent/path.json');
    assert.deepEqual(result, []);
  });

  it('throws on invalid JSON structure', async () => {
    const tokensFile = path.join(fixtureDir, 'agent-tokens.json');
    fs.writeFileSync(tokensFile, '{ "tokens": "not-array" }');

    const { loadAgentTokens } = await import('../server-lib.js');
    assert.throws(() => loadAgentTokens(tokensFile), /tokens must be an array/);
  });

  it('deduplicates tokens keeping first occurrence', async () => {
    const tokensFile = path.join(fixtureDir, 'agent-tokens.json');
    fs.writeFileSync(tokensFile, JSON.stringify({
      tokens: [
        { name: 'first', token: 'same' },
        { name: 'second', token: 'same' }
      ]
    }));

    const { loadAgentTokens } = await import('../server-lib.js');
    const result = loadAgentTokens(tokensFile);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'first');
  });
});
```

- [ ] **Step 2: Create `server-lib.js` with `loadAgentTokens`**

```js
import fs from 'fs';

export function loadAgentTokens(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (!Array.isArray(parsed.tokens)) throw new Error('tokens must be an array');
  const seen = new Set();
  const tokens = [];
  for (const entry of parsed.tokens) {
    if (!entry.name || !entry.token) throw new Error('each token entry needs name and token');
    if (seen.has(entry.token)) continue;
    seen.add(entry.token);
    tokens.push(entry);
  }
  return tokens;
}
```

- [ ] **Step 3: Run tests**

Run: `node --test test/token-limit.test.js`
Expected: All 4 tests pass.

- [ ] **Step 4: Update `server.js` to use `loadAgentTokens`**

Replace lines 37-60 in `server.js` with:

```js
import { loadAgentTokens } from './server-lib.js';

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
```

- [ ] **Step 5: Verify server still starts**

Run: `node server.js &` then `curl -s http://localhost:3001/api/me | head -1` → should return 401 JSON. Kill the server.

- [ ] **Step 6: Commit**

```bash
git add server-lib.js test/token-limit.test.js server.js
git commit -m "refactor: extract loadAgentTokens into server-lib.js with tests"
```

---

### Task 2: Add usage persistence (load/save)

**Files:**
- Modify: `server-lib.js`
- Modify: `test/token-limit.test.js`
- Modify: `.gitignore`

- [ ] **Step 1: Write the failing tests**

Append to `test/token-limit.test.js`:

```js
describe('usage persistence', () => {
  beforeEach(() => {
    fs.mkdirSync(fixtureDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('loadUsage returns empty object when file missing', async () => {
    const { loadUsage } = await import('../server-lib.js');
    const result = loadUsage('/nonexistent/usage.json');
    assert.deepEqual(result, {});
  });

  it('loadUsage returns parsed data from valid file', async () => {
    const usageFile = path.join(fixtureDir, 'usage.json');
    const data = {
      'bot-a': { window_start: '2026-05-10T00:00:00.000Z', input_tokens_used: 100, output_tokens_used: 50 }
    };
    fs.writeFileSync(usageFile, JSON.stringify(data));

    const { loadUsage } = await import('../server-lib.js');
    const result = loadUsage(usageFile);
    assert.deepEqual(result, data);
  });

  it('loadUsage returns empty object on corrupt file', async () => {
    const usageFile = path.join(fixtureDir, 'usage.json');
    fs.writeFileSync(usageFile, 'not json{{{');

    const { loadUsage } = await import('../server-lib.js');
    const result = loadUsage(usageFile);
    assert.deepEqual(result, {});
  });

  it('saveUsage writes JSON and excludes orphaned agents', async () => {
    const usageFile = path.join(fixtureDir, 'usage.json');
    const usage = {
      'bot-a': { window_start: '2026-05-10T00:00:00.000Z', input_tokens_used: 100, output_tokens_used: 50 },
      'removed-bot': { window_start: '2026-05-10T00:00:00.000Z', input_tokens_used: 999, output_tokens_used: 999 }
    };
    const activeNames = new Set(['bot-a']);

    const { saveUsage } = await import('../server-lib.js');
    saveUsage(usageFile, usage, activeNames);

    const written = JSON.parse(fs.readFileSync(usageFile, 'utf-8'));
    assert.ok(written['bot-a']);
    assert.equal(written['removed-bot'], undefined);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/token-limit.test.js`
Expected: FAIL — `loadUsage` and `saveUsage` not exported.

- [ ] **Step 3: Implement `loadUsage` and `saveUsage` in `server-lib.js`**

```js
export function loadUsage(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveUsage(filePath, usage, activeNames) {
  const filtered = {};
  for (const [name, data] of Object.entries(usage)) {
    if (activeNames.has(name)) filtered[name] = data;
  }
  fs.writeFileSync(filePath, JSON.stringify(filtered, null, 2));
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/token-limit.test.js`
Expected: All tests pass.

- [ ] **Step 5: Add `config/agent-usage.json` to `.gitignore`**

Add after the `config/users.json` line:

```
config/agent-usage.json
```

- [ ] **Step 6: Commit**

```bash
git add server-lib.js test/token-limit.test.js .gitignore
git commit -m "feat: add usage persistence helpers (loadUsage, saveUsage)"
```

---

### Task 3: Implement `enforceTokenLimit` middleware

**Files:**
- Modify: `server-lib.js`
- Modify: `test/token-limit.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/token-limit.test.js`:

```js
describe('enforceTokenLimit', () => {
  it('calls next() when no limit configured', async () => {
    const { enforceTokenLimit } = await import('../server-lib.js');
    const usage = {};
    const req = { agent: { name: 'bot-a' } };
    let nextCalled = false;
    const res = { status: () => ({ json: () => {} }) };
    enforceTokenLimit(usage, req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('calls next() when under limit', async () => {
    const { enforceTokenLimit } = await import('../server-lib.js');
    const usage = {
      'bot-a': { window_start: new Date().toISOString(), input_tokens_used: 500, output_tokens_used: 100 }
    };
    const req = { agent: { name: 'bot-a', weekly_input_token_limit: 1000, weekly_output_token_limit: 500 } };
    let nextCalled = false;
    const res = { status: () => ({ json: () => {} }) };
    enforceTokenLimit(usage, req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('returns 429 when input limit exceeded', async () => {
    const { enforceTokenLimit } = await import('../server-lib.js');
    const usage = {
      'bot-a': { window_start: new Date().toISOString(), input_tokens_used: 1000, output_tokens_used: 100 }
    };
    const req = { agent: { name: 'bot-a', weekly_input_token_limit: 1000, weekly_output_token_limit: 5000 } };
    let statusCode, body;
    const res = { status: (code) => { statusCode = code; return { json: (b) => { body = b; } }; } };
    enforceTokenLimit(usage, req, res, () => {});
    assert.equal(statusCode, 429);
    assert.equal(body.type, 'rate_limit_error');
  });

  it('returns 429 when output limit exceeded', async () => {
    const { enforceTokenLimit } = await import('../server-lib.js');
    const usage = {
      'bot-a': { window_start: new Date().toISOString(), input_tokens_used: 100, output_tokens_used: 500 }
    };
    const req = { agent: { name: 'bot-a', weekly_input_token_limit: 9999, weekly_output_token_limit: 500 } };
    let statusCode, body;
    const res = { status: (code) => { statusCode = code; return { json: (b) => { body = b; } }; } };
    enforceTokenLimit(usage, req, res, () => {});
    assert.equal(statusCode, 429);
    assert.equal(body.type, 'rate_limit_error');
  });

  it('resets window when expired and allows request', async () => {
    const { enforceTokenLimit } = await import('../server-lib.js');
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const usage = {
      'bot-a': { window_start: eightDaysAgo, input_tokens_used: 9999, output_tokens_used: 9999 }
    };
    const req = { agent: { name: 'bot-a', weekly_input_token_limit: 1000, weekly_output_token_limit: 500 } };
    let nextCalled = false;
    const res = { status: () => ({ json: () => {} }) };
    enforceTokenLimit(usage, req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
    assert.equal(usage['bot-a'].input_tokens_used, 0);
    assert.equal(usage['bot-a'].output_tokens_used, 0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/token-limit.test.js`
Expected: FAIL — `enforceTokenLimit` not exported.

- [ ] **Step 3: Implement `enforceTokenLimit`**

Add to `server-lib.js`:

```js
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function enforceTokenLimit(usage, req, res, next) {
  const { name, weekly_input_token_limit, weekly_output_token_limit } = req.agent;
  if (!weekly_input_token_limit && !weekly_output_token_limit) return next();

  if (!usage[name]) {
    usage[name] = { window_start: new Date().toISOString(), input_tokens_used: 0, output_tokens_used: 0 };
  }

  const record = usage[name];
  const windowStart = new Date(record.window_start).getTime();
  if (Date.now() - windowStart >= WEEK_MS) {
    record.window_start = new Date().toISOString();
    record.input_tokens_used = 0;
    record.output_tokens_used = 0;
  }

  const inputExceeded = weekly_input_token_limit && record.input_tokens_used >= weekly_input_token_limit;
  const outputExceeded = weekly_output_token_limit && record.output_tokens_used >= weekly_output_token_limit;

  if (inputExceeded || outputExceeded) {
    const resetsAt = new Date(new Date(record.window_start).getTime() + WEEK_MS).toISOString();
    return res.status(429).json({
      error: 'Weekly token limit exceeded',
      type: 'rate_limit_error',
      limit: {
        input: weekly_input_token_limit || null,
        output: weekly_output_token_limit || null
      },
      used: {
        input: record.input_tokens_used,
        output: record.output_tokens_used
      },
      resets_at: resetsAt
    });
  }

  next();
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/token-limit.test.js`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add server-lib.js test/token-limit.test.js
git commit -m "feat: implement enforceTokenLimit middleware"
```

---

### Task 4: Implement `recordUsage` helper

**Files:**
- Modify: `server-lib.js`
- Modify: `test/token-limit.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/token-limit.test.js`:

```js
describe('recordUsage', () => {
  it('adds input and output tokens from response usage', async () => {
    const { recordUsage } = await import('../server-lib.js');
    const usage = {
      'bot-a': { window_start: new Date().toISOString(), input_tokens_used: 100, output_tokens_used: 50 }
    };
    const responseUsage = {
      input_tokens: 200,
      output_tokens: 80,
      cache_creation_input_tokens: 50,
      cache_read_input_tokens: 30
    };
    recordUsage(usage, 'bot-a', responseUsage);
    assert.equal(usage['bot-a'].input_tokens_used, 380); // 100 + 200 + 50 + 30
    assert.equal(usage['bot-a'].output_tokens_used, 130); // 50 + 80
  });

  it('handles missing cache fields gracefully', async () => {
    const { recordUsage } = await import('../server-lib.js');
    const usage = {
      'bot-a': { window_start: new Date().toISOString(), input_tokens_used: 0, output_tokens_used: 0 }
    };
    const responseUsage = { input_tokens: 100, output_tokens: 40 };
    recordUsage(usage, 'bot-a', responseUsage);
    assert.equal(usage['bot-a'].input_tokens_used, 100);
    assert.equal(usage['bot-a'].output_tokens_used, 40);
  });

  it('initializes usage record if missing', async () => {
    const { recordUsage } = await import('../server-lib.js');
    const usage = {};
    const responseUsage = { input_tokens: 100, output_tokens: 40 };
    recordUsage(usage, 'bot-a', responseUsage);
    assert.equal(usage['bot-a'].input_tokens_used, 100);
    assert.equal(usage['bot-a'].output_tokens_used, 40);
    assert.ok(usage['bot-a'].window_start);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/token-limit.test.js`
Expected: FAIL — `recordUsage` not exported.

- [ ] **Step 3: Implement `recordUsage`**

Add to `server-lib.js`:

```js
export function recordUsage(usage, agentName, responseUsage) {
  if (!usage[agentName]) {
    usage[agentName] = { window_start: new Date().toISOString(), input_tokens_used: 0, output_tokens_used: 0 };
  }
  const record = usage[agentName];
  const inputTotal = (responseUsage.input_tokens || 0)
    + (responseUsage.cache_creation_input_tokens || 0)
    + (responseUsage.cache_read_input_tokens || 0);
  record.input_tokens_used += inputTotal;
  record.output_tokens_used += (responseUsage.output_tokens || 0);
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/token-limit.test.js`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add server-lib.js test/token-limit.test.js
git commit -m "feat: implement recordUsage helper"
```

---

### Task 5: Wire middleware and usage accounting into `server.js`

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Update imports in `server.js`**

Add to the import block at the top:

```js
import { loadAgentTokens, loadUsage, saveUsage, enforceTokenLimit, recordUsage } from './server-lib.js';
```

- [ ] **Step 2: Add usage loading after token loading**

After the `agentTokens` loading block, add:

```js
const agentUsagePath = path.join(__dirname, 'config', 'agent-usage.json');
let agentUsage = loadUsage(agentUsagePath);
```

- [ ] **Step 3: Update `requireAgentToken` to pass limits through `req.agent`**

Change line 119 from:
```js
  req.agent = { name: matched.name };
```
to:
```js
  req.agent = {
    name: matched.name,
    weekly_input_token_limit: matched.weekly_input_token_limit,
    weekly_output_token_limit: matched.weekly_output_token_limit
  };
```

- [ ] **Step 4: Add `enforceTokenLimit` middleware to agent routes**

Change route registrations:

```js
app.post('/api/agent/claude', requireAgentToken, (req, res, next) => enforceTokenLimit(agentUsage, req, res, next), async (req, res) => {
```

```js
app.post('/v1/messages', requireAgentToken, (req, res, next) => enforceTokenLimit(agentUsage, req, res, next), async (req, res) => {
```

- [ ] **Step 5: Add usage recording after successful Anthropic response in `/api/agent/claude`**

In the `/api/agent/claude` handler, after `const response = ...` and before `res.json(response)`:

```js
    if (response.usage) {
      recordUsage(agentUsage, req.agent.name, response.usage);
      saveUsage(agentUsagePath, agentUsage, new Set(agentTokens.map(t => t.name)));
    }
```

- [ ] **Step 6: Add usage recording after successful Anthropic response in `/v1/messages`**

In the `/v1/messages` handler, for the non-streaming path, after `const response = ...` and before `res.json(response)`:

```js
    if (response.usage) {
      recordUsage(agentUsage, req.agent.name, response.usage);
      saveUsage(agentUsagePath, agentUsage, new Set(agentTokens.map(t => t.name)));
    }
```

For the streaming path, after the `for await` loop and before `res.end()`:

```js
      const finalMessage = response.finalMessage;
      if (finalMessage && finalMessage.usage) {
        recordUsage(agentUsage, req.agent.name, finalMessage.usage);
        saveUsage(agentUsagePath, agentUsage, new Set(agentTokens.map(t => t.name)));
      }
```

Note: The Anthropic SDK streaming response object exposes `.finalMessage` after iteration completes. If the SDK version doesn't support this, accumulate usage from the last `message_delta` event in the loop instead:

```js
      let lastUsage = null;
      for await (const event of response) {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        if (event.type === 'message_delta' && event.usage) lastUsage = event.usage;
      }
      if (lastUsage) {
        recordUsage(agentUsage, req.agent.name, lastUsage);
        saveUsage(agentUsagePath, agentUsage, new Set(agentTokens.map(t => t.name)));
      }
```

- [ ] **Step 7: Verify server starts and non-limited token works**

Run: `node server.js` — should boot without errors.

- [ ] **Step 8: Commit**

```bash
git add server.js
git commit -m "feat: wire enforceTokenLimit and usage accounting into agent routes"
```

---

### Task 6: Add hot-reload via `fs.watch`

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add file watcher after token loading block**

After the `agentTokens` loading and usage loading, add:

```js
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
```

- [ ] **Step 2: Manual test**

1. Start server with a token configured with `weekly_input_token_limit: 1`.
2. Make one request → should succeed and record usage.
3. Make second request → should get 429.
4. Edit `config/agent-tokens.json` to increase limit to 999999.
5. Wait 200ms, make request → should succeed (hot-reload picked up new limit).

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: hot-reload agent-tokens.json on file change"
```

---

### Task 7: Update config example and documentation

**Files:**
- Modify: `config/agent-tokens.example.json`

- [ ] **Step 1: Update example file**

```json
{
  "tokens": [
    {
      "name": "example-agent",
      "token": "replace-with-output-of-node-scripts-gen-agent-token-js",
      "weekly_input_token_limit": 2000000,
      "weekly_output_token_limit": 500000
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add config/agent-tokens.example.json
git commit -m "docs: add weekly limit fields to agent-tokens example"
```

---

### Task 8: Final integration test

**Files:**
- Modify: `test/token-limit.test.js`

- [ ] **Step 1: Add integration-style test for the full flow**

Append to `test/token-limit.test.js`:

```js
describe('full flow integration', () => {
  it('enforce → record → enforce blocks on second call', async () => {
    const { enforceTokenLimit, recordUsage } = await import('../server-lib.js');
    const usage = {};
    const req = { agent: { name: 'bot-a', weekly_input_token_limit: 100, weekly_output_token_limit: 50 } };
    let nextCalled = false;
    const passRes = { status: () => ({ json: () => {} }) };

    // First request: under limit
    enforceTokenLimit(usage, req, passRes, () => { nextCalled = true; });
    assert.ok(nextCalled);

    // Simulate Anthropic response
    recordUsage(usage, 'bot-a', { input_tokens: 80, output_tokens: 30, cache_creation_input_tokens: 25, cache_read_input_tokens: 0 });

    // Second request: input exceeded (80+25 = 105 >= 100)
    let statusCode;
    const blockRes = { status: (code) => { statusCode = code; return { json: () => {} }; } };
    nextCalled = false;
    enforceTokenLimit(usage, req, blockRes, () => { nextCalled = true; });
    assert.ok(!nextCalled);
    assert.equal(statusCode, 429);
  });
});
```

- [ ] **Step 2: Run full test suite**

Run: `node --test test/token-limit.test.js`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/token-limit.test.js
git commit -m "test: add integration test for token limit full flow"
```
