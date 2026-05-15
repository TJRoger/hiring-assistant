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
