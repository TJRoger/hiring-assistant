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
