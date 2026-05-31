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

## 1. Token Tracking for Users

### Data shape (both files)

Both `config/user-usage.json` (server key) and `config/user-usage-own-key.json` (own key) use the same structure:

```json
{
  "alice": {
    "week_start": "2026-05-26T00:00:00.000Z",
    "week_input_tokens": 12000,
    "week_output_tokens": 3000,
    "total_input_tokens": 42000,
    "total_output_tokens": 8000,
    "created_at": "2026-05-31T10:00:00.000Z",
    "updated_at": "2026-05-31T12:34:56.000Z"
  }
}
```

- `week_start` / `week_input_tokens` / `week_output_tokens`: current 7-day window, reset when `now - week_start >= 7 days`
- `total_input_tokens` / `total_output_tokens`: lifetime cumulative, never reset
- `created_at`: first-seen timestamp
- `updated_at`: last write timestamp

### What changes

**`user-usage.json` (server key users):**
- Existing records migrated to new shape on first write (old fields `input_tokens_used` / `output_tokens_used` become `total_*` and seed the first `week_*` values)
- `checkFreeQuota` uses `week_input_tokens` / `week_output_tokens` for quota enforcement (resets weekly)
- Recording after response updates both `week_*` and `total_*`

**`user-usage-own-key.json` (own key users):**
- New file, same shape, no quota enforcement — purely informational
- Add `userOwnKeyUsagePath` and `userOwnKeyUsage` alongside existing `userUsage` variables
- In the `usingOwnKey` branch of `/api/claude`, record usage after a successful response

### Helper: `updateUserUsage(record, usage)`

Extracted helper in `server.js` that handles both weekly reset and cumulative accumulation, used by both tracking paths.

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
