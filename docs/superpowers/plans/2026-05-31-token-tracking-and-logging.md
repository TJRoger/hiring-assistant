# Token Tracking & Server Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record token usage for own-API-key users, add weekly-reset + lifetime totals to all user usage tracking, and write all server logs to rotating disk files via winston.

**Architecture:** New `logger.js` exports a winston instance used throughout the server. User usage tracking is refactored to a unified shape (weekly + lifetime) in `server.js`. Own-key usage writes to a separate JSON file. All changes are in `server.js`, `server-lib.js`, and the new `logger.js`.

**Tech Stack:** Node.js, Express, winston, winston-daily-rotate-file

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `logger.js` | Create | Winston instance with console + rotating file transports |
| `server.js` | Modify | Import logger; unified user usage shape; own-key tracking; request middleware |
| `server-lib.js` | Modify | Replace console calls with logger |
| `package.json` | Modify | Add winston + winston-daily-rotate-file |
| `.gitignore` | Modify | Add `logs/` |

---

## Task 1: Install dependencies and create logger.js

**Files:**
- Modify: `package.json`
- Create: `logger.js`

- [ ] **Step 1: Install winston packages**

```bash
cd /path/to/worktree
npm install winston winston-daily-rotate-file
```

Expected: packages added to `node_modules/`, `package.json` and `package-lock.json` updated.

- [ ] **Step 2: Create `logger.js`**

```js
import winston from 'winston';
import 'winston-daily-rotate-file';
import fs from 'fs';

const logsDir = new URL('./logs', import.meta.url).pathname;
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message }) =>
    `${timestamp} [${level.toUpperCase()}] ${message}`
  )
);

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
);

const logger = winston.createLogger({
  level: 'info',
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
    new winston.transports.DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
      format: fileFormat,
    }),
    new winston.transports.DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxFiles: '30d',
      format: fileFormat,
    }),
  ],
});

export default logger;
```

- [ ] **Step 3: Verify logger works**

Create a temporary test file `/tmp/test-logger.mjs`:

```js
import logger from './logger.js';
logger.info('test info');
logger.warn('test warn');
logger.error('test error');
```

Run from the worktree root:
```bash
node /tmp/test-logger.mjs
```

Expected: three lines printed to stdout, and `logs/combined-YYYY-MM-DD.log` + `logs/error-YYYY-MM-DD.log` created with JSON entries.

- [ ] **Step 4: Add `logs/` to .gitignore**

Open `.gitignore` and append:
```
# Application logs
logs/
```

- [ ] **Step 5: Commit**

```bash
git add logger.js package.json package-lock.json .gitignore
git commit -m "feat: add winston logger with daily rotating file transports"
```

---

## Task 2: Replace console calls in server-lib.js

**Files:**
- Modify: `server-lib.js`

`server-lib.js` currently has two `console.error` calls (lines 91–92 area). Replace them with logger.

- [ ] **Step 1: Update server-lib.js**

Replace the top of the file and the two console calls:

```js
import fs from 'fs';
import logger from './logger.js';
```

Find and replace:
```js
// OLD
console.error('🔄 Failed to reload agent-tokens.json:', e.message, '— keeping previous config');
```
```js
// NEW
logger.error(`🔄 Failed to reload agent-tokens.json: ${e.message} — keeping previous config`);
```

`server-lib.js` has no other console calls — verify with:
```bash
grep -n "console\." server-lib.js
```
Expected: no output.

- [ ] **Step 2: Verify server-lib.js still imports cleanly**

```bash
node --input-type=module <<'EOF'
import './server-lib.js';
console.log('ok');
EOF
```

Expected: `ok` printed (no errors).

- [ ] **Step 3: Commit**

```bash
git add server-lib.js
git commit -m "refactor: replace console calls with logger in server-lib.js"
```

---

## Task 3: Refactor user usage shape + add own-key tracking

**Files:**
- Modify: `server.js`

This task changes the user usage data shape to include weekly + lifetime fields, adds own-key usage tracking, and extracts a `updateUserUsage` helper.

- [ ] **Step 1: Add own-key usage path and load at startup**

In `server.js`, after the existing `userUsagePath` / `loadUserUsage` / `saveUserUsage` / `userUsage` block (lines 23–37), add:

```js
const userOwnKeyUsagePath = path.join(__dirname, 'config', 'user-usage-own-key.json');
let userOwnKeyUsage = loadUserUsage(userOwnKeyUsagePath);
```

Also update `loadUserUsage` and `saveUserUsage` to accept a path parameter:

```js
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

let userUsage = loadUserUsage(userUsagePath);
```

- [ ] **Step 2: Add `updateUserUsage` helper**

Add this function after `saveUserUsage`:

```js
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function updateUserUsage(record, responseUsage) {
  const now = new Date();
  const inputDelta = (responseUsage.input_tokens || 0)
    + (responseUsage.cache_creation_input_tokens || 0)
    + (responseUsage.cache_read_input_tokens || 0);
  const outputDelta = responseUsage.output_tokens || 0;

  // weekly reset
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
```

- [ ] **Step 3: Update `checkFreeQuota` to use new field names**

Find `checkFreeQuota` and update the quota check to use `week_input_tokens` / `week_output_tokens`, and initialize new records with the new shape:

```js
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

  // weekly reset
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
```

- [ ] **Step 4: Update `/api/claude` to use `updateUserUsage` and record own-key usage**

Replace the token recording block inside `/api/claude` (currently lines ~251–266) with:

```js
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
```

- [ ] **Step 5: Update `/api/usage` endpoint to return new field names**

```js
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
```

- [ ] **Step 6: Fix all remaining `saveUserUsage` calls to pass path**

Search for any remaining `saveUserUsage(userUsage)` calls (old signature) and update to `saveUserUsage(userUsagePath, userUsage)`.

```bash
grep -n "saveUserUsage" server.js
```

All calls should now pass two arguments.

- [ ] **Step 7: Verify server starts**

```bash
node server.js &
sleep 2
curl -s http://localhost:3001/api/me
kill %1
```

Expected: `{"error":"Unauthorized"}` (server running, auth working).

- [ ] **Step 8: Commit**

```bash
git add server.js
git commit -m "feat: refactor user usage to weekly+lifetime shape, add own-key tracking"
```

---

## Task 4: Replace console calls in server.js with logger + add request middleware

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Import logger at top of server.js**

Add after the existing imports:

```js
import logger from './logger.js';
```

- [ ] **Step 2: Replace all console calls**

Run to find them:
```bash
grep -n "console\." server.js
```

Replace each one:

| Old | New |
|-----|-----|
| `console.error('❌ ...')` | `logger.error('❌ ...')` |
| `console.warn('⚠️  ...')` | `logger.warn('⚠️  ...')` |
| `console.log('✅ ...')` | `logger.info('✅ ...')` |
| `console.log('🔄 ...')` | `logger.info('🔄 ...')` |
| `console.warn('agent auth failed')` | `logger.warn('agent auth failed')` |
| `console.log(\`agent=...\`)` | `logger.info(\`agent=...\`)` |
| `console.error('API error:', err)` | `logger.error(\`API error: \${err.message}\`)` |

Verify no console calls remain:
```bash
grep -n "console\." server.js
```
Expected: no output.

- [ ] **Step 3: Add request logging middleware**

Add this block in `server.js` after the session middleware setup and before the route definitions (before `app.post('/api/login', ...)`):

```js
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
```

- [ ] **Step 4: Attach token usage to res.locals in route handlers**

In `/api/claude`, after `res.json(response)` is called but before it, set:

```js
if (response.usage) {
  const inputTotal = (response.usage.input_tokens || 0)
    + (response.usage.cache_creation_input_tokens || 0)
    + (response.usage.cache_read_input_tokens || 0);
  res.locals.usage = { input: inputTotal, output: response.usage.output_tokens || 0 };
}
res.json(response);
```

Do the same in `/api/agent/claude` (non-streaming) and `/v1/messages` (both streaming and non-streaming paths). For the streaming path in `/v1/messages`, set `res.locals.usage` from `lastUsage` before `res.end()`.

- [ ] **Step 5: Verify request logs appear**

```bash
node server.js &
sleep 2
curl -s -X POST http://localhost:3001/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"wrong"}'
kill %1
```

Expected: a `[REQUEST] POST /api/login unauthenticated status=401 duration=Xms` line in stdout and in `logs/combined-YYYY-MM-DD.log`.

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat: replace console calls with logger, add request logging middleware"
```

---

## Task 5: Final verification

- [ ] **Step 1: Check no console calls remain anywhere**

```bash
grep -rn "console\." server.js server-lib.js
```

Expected: no output.

- [ ] **Step 2: Verify log files are created on startup**

```bash
node server.js &
sleep 2
ls logs/
kill %1
```

Expected: `combined-YYYY-MM-DD.log` and `error-YYYY-MM-DD.log` present.

- [ ] **Step 3: Verify own-key usage file is created on first own-key request**

This requires a running server with valid credentials. If integration testing is available:

```bash
npm test
```

Otherwise, manually confirm `config/user-usage-own-key.json` is created after a request with `x-user-api-key` header.

- [ ] **Step 4: Verify `config/user-usage-own-key.json` is NOT in .gitignore**

```bash
git check-ignore -v config/user-usage-own-key.json
```

Expected: no output (file is tracked, not ignored — same as `config/agent-usage.json`).

- [ ] **Step 5: Final commit if any loose changes**

```bash
git status
# commit anything uncommitted
```
