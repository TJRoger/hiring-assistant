# AI Hiring Assistant

AI-powered recruiting tool - evaluate resumes, generate tailored interview questions, and assess candidates with Claude.

## Features

- 📄 Resume evaluation with match scoring
- 💬 AI-generated interview questions tailored to each candidate
- 🔄 Smart follow-up questions
- 📊 Comprehensive candidate scoring (technical, experience, communication, culture fit)
- 💾 Local data persistence

## Quick Start

```bash
npm install
cp .env.example .env
# Edit .env: add ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN, set SESSION_SECRET
cp config/users.example.json config/users.json
# Edit config/users.json: add your users
npm run dev:full
```

Open http://localhost:5173

## Production Build

```bash
npm run build
npm start
```

## Get Your API Key

Sign up at https://console.anthropic.com and create an API key, or use a compatible proxy service with `ANTHROPIC_BASE_URL`.

## Deploy

### Vercel
1. Push to GitHub
2. Import project in Vercel
3. Add environment variables:
   - `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`
   - `ANTHROPIC_BASE_URL` (optional, for proxy services)
4. Deploy

### Docker
```bash
docker build -t hiring-assistant .
docker run -p 3001:3001 -e ANTHROPIC_API_KEY=your-key hiring-assistant
```

## Tech Stack

- React 18 + Vite
- Tailwind CSS
- Express (API proxy)
- Anthropic Claude API

## License

MIT
