import fs from 'fs';
import logger from './logger.js';

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
