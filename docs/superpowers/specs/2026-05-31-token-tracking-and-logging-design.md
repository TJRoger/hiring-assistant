# Token Tracking & Server Logging Design

**Date:** 2026-05-31

## Problem

Two gaps in the current server:

1. Users who supply their own API key (`x-user-api-key`) have zero token usage recorded.
2. Server logs only go to stdout — nothing is written to disk, so logs are lost on restart.

## Solution Overview

- Add token tracking for own-key users to a separate file `config/user-usage-own-key.json`.
- Introduce `winston` logging with daily-rotating files, replacing all `console.*` calls.
- Add a request logging middleware that records per-request metadata and token usage.

---

## 1. Token Tracking for Own-Key Users

### What changes

In `server.js`, the `/api/claude` handler currently skips usage recording when `usingOwnKey` is true. We add a parallel recording path:

- Load/save from `config/user-usage-own-key.json` (same JSON shape as `user-usage.json`)
- Record `input_tokens_used`, `output_tokens_used`, `created_at` per username
- No quota enforcement — purely informational

### Data shape

```json
{
  "alice": {
    "input_tokens_used": 42000,
    "output_tokens_used": 8000,
    "created_at": "2026-05-31T10:00:00.000Z"
  }
}
```

### Implementation

- Add `userOwnKeyUsagePath` and `userOwnKeyUsage` alongside the existing `userUsage` variables
- Reuse the same `loadUserUsage` / `saveUserUsage` pattern, passing the new path
- In the `usingOwnKey` branch of `/api/claude`, record usage after a successful response

---

## 2. Winston Logging

### Dependencies

```
winston
winston-daily-rotate-file
```

### New file: `logger.js` (project root)

Exports a single `logger` instance with three transports:

| Transport | File pattern | Levels | Retention |
|-----------|-------------|--------|-----------|
| Console | stdout | all | — |
| Combined file | `logs/combined-%DATE%.log` | all | 14 days |
| Error file | `logs/error-%DATE%.log` | error only | 30 days |

Log format: `YYYY-MM-DD HH:mm:ss [LEVEL] message` for console; JSON for files (machine-parseable).

### Replacing console calls

All `console.log`, `console.warn`, `console.error` in `server.js` and `server-lib.js` are replaced with `logger.info`, `logger.warn`, `logger.error`.

### Request logging middleware

Added in `server.js` before route definitions. Logs on response finish:

```
[REQUEST] POST /api/claude user=alice status=200 duration=1243ms input=1200 output=340
[REQUEST] POST /api/agent/claude agent=hr-agent status=200 duration=890ms input=800 output=120
```

Fields: timestamp, method, path, user (from session) or agent (from `req.agent`), status code, duration (ms), input/output tokens (if available).

Token counts are attached to `res.locals` by the route handler after the Anthropic call, then read by the middleware's `res.on('finish')` handler.

### Log directory

`logs/` is created at startup if it doesn't exist. Added to `.gitignore`.

---

## 3. File Changes Summary

| File | Change |
|------|--------|
| `logger.js` | New — winston setup |
| `server.js` | Import logger; replace console calls; add request middleware; add own-key usage tracking |
| `server-lib.js` | Import logger; replace console calls |
| `package.json` | Add `winston`, `winston-daily-rotate-file` |
| `.gitignore` | Add `logs/` |

---

## Out of Scope

- No API endpoint to query own-key usage (informational file only)
- No log shipping to external services
- No changes to agent token tracking (already works correctly)
