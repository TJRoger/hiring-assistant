# Agent API Token Design

## Goal

Expose the existing Claude proxy at a separate path for external agents, authenticated by bearer token instead of session cookie. Support multiple named tokens so individual tokens can be revoked without rotating the others.

## Non-Goals

- Rate limiting per token
- Token expiry / TTL
- Per-token model, quota, or scope restrictions
- Persistent audit log to disk
- Hashing tokens at rest (file is gitignored, secrets stay plaintext like `config/users.json`)
- Modifying or replacing the existing session-authenticated `/api/claude` endpoint

## Configuration

New file `config/agent-tokens.json` (gitignored):

```json
{
  "tokens": [
    { "name": "example-agent", "token": "<32-byte hex>" }
  ]
}
```

Also provide `config/agent-tokens.example.json` as a template, committed to git.

Each entry:
- `name` — human-readable label, used only for logging. Must be a non-empty string.
- `token` — the bearer secret. Must be a non-empty string. Recommended: 32 random bytes hex-encoded (64 chars).

Token uniqueness across entries is required. On startup, if duplicates are detected the server logs a warning naming the duplicated entries and keeps only the first occurrence.

`.gitignore` adds `config/agent-tokens.json`.

## Backend Design

### Token loading

At startup, the server attempts to read `config/agent-tokens.json`:

- File missing — log a warning and continue with an empty token list. The app must still boot.
- File present but invalid JSON or wrong shape — fail startup with a clear error.
- File present and valid — load tokens into memory once. Restart to pick up changes.

### `requireAgentToken` middleware

- Reads the `Authorization` header. Expects format `Bearer <token>`. Anything else → 401.
- Compares the presented token against each loaded token using `crypto.timingSafeEqual` on equal-length buffers. If lengths differ, the comparison is skipped for that entry.
- On match: attach `req.agent = { name }` and call `next()`.
- On no match: 401 with `{ "error": "Unauthorized" }`.
- Never log the token value. On success, log `agent=<name>` alongside the request method/path.

### `POST /api/agent/claude`

- Protected by `requireAgentToken`.
- Request body identical to existing `/api/claude`: `{ messages, system?, max_tokens? }`. `max_tokens` defaults to 16000.
- Calls `anthropic.messages.create` with the same model the existing endpoint uses.
- Returns the Anthropic response unmodified.
- On Anthropic SDK error: 500 with `{ "error": <message> }`.

### Existing endpoints

`/api/claude`, `/api/login`, `/api/logout`, `/api/me` are unchanged.

## Token Generation Helper

New script `scripts/gen-agent-token.js`:

- Prints `crypto.randomBytes(32).toString('hex')` to stdout, nothing else.
- Run via `node scripts/gen-agent-token.js`.

## Files Touched

- `server.js` — add token loading, `requireAgentToken`, `POST /api/agent/claude`
- `config/agent-tokens.example.json` — new
- `.gitignore` — add `config/agent-tokens.json`
- `scripts/gen-agent-token.js` — new
- `README.md` — new "Agent API" section
