import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadAgentTokens } from '../server-lib.js';

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
