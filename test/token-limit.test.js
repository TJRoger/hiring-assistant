import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadAgentTokens, loadUsage, saveUsage, enforceTokenLimit } from '../server-lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures');

describe('loadAgentTokens', () => {
  beforeEach(() => {
    fs.mkdirSync(fixtureDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('loads valid tokens from file', () => {
    const tokensFile = path.join(fixtureDir, 'agent-tokens.json');
    fs.writeFileSync(tokensFile, JSON.stringify({
      tokens: [
        { name: 'bot-a', token: 'aaa', weekly_input_token_limit: 1000, weekly_output_token_limit: 500 },
        { name: 'bot-b', token: 'bbb' }
      ]
    }));

    const result = loadAgentTokens(tokensFile);
    assert.equal(result.length, 2);
    assert.equal(result[0].name, 'bot-a');
    assert.equal(result[0].weekly_input_token_limit, 1000);
    assert.equal(result[0].weekly_output_token_limit, 500);
    assert.equal(result[1].weekly_input_token_limit, undefined);
  });

  it('returns empty array when file missing', () => {
    const result = loadAgentTokens('/nonexistent/path.json');
    assert.deepEqual(result, []);
  });

  it('throws on invalid JSON structure', () => {
    const tokensFile = path.join(fixtureDir, 'agent-tokens.json');
    fs.writeFileSync(tokensFile, '{ "tokens": "not-array" }');

    assert.throws(() => loadAgentTokens(tokensFile), /tokens must be an array/);
  });

  it('deduplicates tokens keeping first occurrence', () => {
    const tokensFile = path.join(fixtureDir, 'agent-tokens.json');
    fs.writeFileSync(tokensFile, JSON.stringify({
      tokens: [
        { name: 'first', token: 'same' },
        { name: 'second', token: 'same' }
      ]
    }));

    const result = loadAgentTokens(tokensFile);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'first');
  });
});

describe('usage persistence', () => {
  beforeEach(() => {
    fs.mkdirSync(fixtureDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('loadUsage returns empty object when file missing', () => {
    const result = loadUsage('/nonexistent/usage.json');
    assert.deepEqual(result, {});
  });

  it('loadUsage returns parsed data from valid file', () => {
    const usageFile = path.join(fixtureDir, 'usage.json');
    const data = {
      'bot-a': { window_start: '2026-05-10T00:00:00.000Z', input_tokens_used: 100, output_tokens_used: 50 }
    };
    fs.writeFileSync(usageFile, JSON.stringify(data));

    const result = loadUsage(usageFile);
    assert.deepEqual(result, data);
  });

  it('loadUsage returns empty object on corrupt file', () => {
    const usageFile = path.join(fixtureDir, 'usage.json');
    fs.writeFileSync(usageFile, 'not json{{{');

    const result = loadUsage(usageFile);
    assert.deepEqual(result, {});
  });

  it('saveUsage writes JSON and excludes orphaned agents', () => {
    const usageFile = path.join(fixtureDir, 'usage.json');
    const usage = {
      'bot-a': { window_start: '2026-05-10T00:00:00.000Z', input_tokens_used: 100, output_tokens_used: 50 },
      'removed-bot': { window_start: '2026-05-10T00:00:00.000Z', input_tokens_used: 999, output_tokens_used: 999 }
    };
    const activeNames = new Set(['bot-a']);

    saveUsage(usageFile, usage, activeNames);

    const written = JSON.parse(fs.readFileSync(usageFile, 'utf-8'));
    assert.ok(written['bot-a']);
    assert.equal(written['removed-bot'], undefined);
  });
});

describe('enforceTokenLimit', () => {
  it('calls next() when no limit configured', () => {
    const usage = {};
    const req = { agent: { name: 'bot-a' } };
    let nextCalled = false;
    const res = { status: () => ({ json: () => {} }) };
    enforceTokenLimit(usage, req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('calls next() when under limit', () => {
    const usage = {
      'bot-a': { window_start: new Date().toISOString(), input_tokens_used: 500, output_tokens_used: 100 }
    };
    const req = { agent: { name: 'bot-a', weekly_input_token_limit: 1000, weekly_output_token_limit: 500 } };
    let nextCalled = false;
    const res = { status: () => ({ json: () => {} }) };
    enforceTokenLimit(usage, req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('returns 429 when input limit exceeded', () => {
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

  it('returns 429 when output limit exceeded', () => {
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

  it('resets window when expired and allows request', () => {
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
