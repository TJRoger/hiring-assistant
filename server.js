import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

if (!process.env.ANTHROPIC_AUTH_TOKEN) {
  console.warn('⚠️  Warning: ANTHROPIC_AUTH_TOKEN not set. Copy .env.example to .env and add your key.');
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
  ...(process.env.ANTHROPIC_BASE_URL && { baseURL: process.env.ANTHROPIC_BASE_URL })
});

app.post('/api/claude', async (req, res) => {
  try {
    const { messages, system, max_tokens = 16000 } = req.body;
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens,
      messages,
      ...(system && { system })
    });
    res.json(response);
  } catch (err) {
    console.error('API error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Serve built frontend in production
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
