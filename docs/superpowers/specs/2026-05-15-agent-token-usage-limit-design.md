# Agent Token Weekly Usage Limit Design

## Goal

Add per-token weekly usage limits to the agent API endpoints (`/api/agent/claude`, `/v1/messages`). Limits are configured per-token with separate input and output caps. Configuration changes are picked up via file watch without server restart.

## Non-Goals

- Admin API endpoint to inspect/reset usage
- Per-endpoint or per-model limits
- Alerting when approaching limit
- Refunding tokens on Anthropic errors
- Calendar-week alignment (uses rolling 7-day window instead)

## Configuration

Extend `config/agent-tokens.json` with two optional fields per entry:

```json
{
  "tokens": [
    {
      "name": "example-agent",
      "token": "<32-byte hex>",
      "weekly_input_token_limit": 2000000,
      "weekly_output_token_limit": 500000
    }
  ]
}
```

- `weekly_input_token_limit` — optional. Max input tokens per rolling 7-day window. Omit for unlimited.
- `weekly_output_token_limit` — optional. Max output tokens per rolling 7-day window. Omit for unlimited.
- Either field can be set independently.

## Token Counting

From each Anthropic response `usage` object:

- **Input tokens:** `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`
- **Output tokens:** `output_tokens`

All bytes through Anthropic count, including cache operations.

## Rolling Window

- Each token tracks its own `window_start` (ISO 8601 timestamp).
- On each request: if `Date.now() - window_start >= 7 * 24 * 60 * 60 * 1000`, reset `window_start` to current time and zero both counters.
- No global clock alignment — each token's window is independent.

## Persistence

New file `config/agent-usage.json` (gitignored):

```json
{
  "example-agent": {
    "window_start": "2026-05-15T08:00:00.000Z",
    "input_tokens_used": 142300,
    "output_tokens_used": 38700
  }
}
```

- Loaded into memory at startup. If missing or corrupt → start with empty usage (no crash).
- Written synchronously after each successful Anthropic response.
- On write, orphaned entries (agent names no longer in token config) are excluded.

## Hot Reload

The server watches `config/agent-tokens.json` using `fs.watch`:

- On file change: re-read and re-parse the file.
- If valid: replace in-memory token list. Log which tokens were added/removed.
- If invalid: log error, keep previous config. Server does not crash.
- Usage counters for existing tokens are preserved across reloads.
- New tokens start with zero usage.
- Removed tokens have their usage cleaned up on next persist.

Debounce file-change events by 100ms to handle editors that write in multiple steps.

## Enforcement Flow

1. Request arrives at `/api/agent/claude` or `/v1/messages`.
2. `requireAgentToken` middleware authenticates → sets `req.agent = { name, weekly_input_token_limit, weekly_output_token_limit }`.
3. New `enforceTokenLimit` middleware (runs after `requireAgentToken`):
   - Look up usage record for `req.agent.name`.
   - If window expired → reset counters and `window_start`.
   - If `weekly_input_token_limit` is set and `input_tokens_used >= weekly_input_token_limit`, OR `weekly_output_token_limit` is set and `output_tokens_used >= weekly_output_token_limit` → respond 429.
   - Otherwise → `next()`.
4. After successful Anthropic response (in route handler), before sending to client:
   - Extract usage from response.
   - Add to in-memory counters.
   - Persist to `config/agent-usage.json`.
   - Send response to client.

### 429 Response Shape

```json
{
  "error": "Weekly token limit exceeded",
  "type": "rate_limit_error",
  "limit": { "input": 2000000, "output": 500000 },
  "used": { "input": 142300, "output": 38700 },
  "resets_at": "2026-05-22T08:00:00.000Z"
}
```

- `limit` fields are `null` if that dimension is unlimited.
- `resets_at` is `window_start + 7 days`.

## Edge Cases

- **Streaming (`/v1/messages` with `stream: true`):** The final `message_stop` event in the stream carries the cumulative `usage` object (via the SDK's `finalMessage`). Accumulate after the stream loop completes, before calling `res.end()`.
- **Anthropic error (5xx from upstream):** No tokens counted — response has no usage object.
- **Request exceeds limit mid-flight:** A request that starts under-limit but whose response pushes usage over-limit is allowed to complete. The overage is recorded; the next request will be blocked.
- **Server crash before persist:** At most one response worth of usage is lost. Acceptable.
- **Multiple rapid requests (single-process):** Express handles requests sequentially within a single event-loop tick for synchronous middleware, so no race on in-memory counters.

## Files Touched

- `server.js` — `enforceTokenLimit` middleware, usage load/persist, file watcher, pass limits through `req.agent`
- `config/agent-tokens.example.json` — add optional limit fields to example
- `.gitignore` — add `config/agent-usage.json`
