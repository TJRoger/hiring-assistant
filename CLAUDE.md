         # CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI-powered hiring assistant that evaluates resumes, generates interview questions, and scores candidates using Claude AI. Two-sided application: recruiter view for managing jobs and evaluating candidates, candidate view for submitting applications and answering interview questions.

## Architecture

**Client-Server Split:**
- Frontend: React 18 + Vite (port 5173 in dev)
- Backend: Express API proxy (port 3001)
- Communication: Frontend calls `/api/claude` which proxies to Anthropic API

**Why the proxy:** Keeps API key server-side, avoids CORS issues, allows request/response transformation.

**Data Flow:**
1. User action in React → `callClaude()` in App.jsx
2. POST to `/api/claude` → Express server.js
3. Server calls Anthropic SDK → Claude API
4. Response flows back through chain
5. Data persisted via `window.storage` (localStorage wrapper)

**Authentication Flow:**
1. Browser loads app → `GET /api/me` checks session
2. If no session → LoginPage shown
3. `POST /api/login` validates against `config/users.json` → creates session
4. Session cookie sent automatically on subsequent requests
5. `POST /api/logout` destroys session → back to login

**Single-File Component Structure:**
- `src/App.jsx` (757 lines) contains entire UI
- Main component: `HiringAssistant` - manages state and routing
- Two view components: `RecruiterView` and `CandidateView`
- Multiple sub-components for jobs, candidates, interviews, scoring
- State managed via useState, no external state library

**Storage Layer:**
- `src/lib/storage.js` - localStorage wrapper mimicking Anthropic Artifacts API
- All data stored client-side as JSON strings
- Keys: `jobs`, `candidates`

## Development Commands

```bash
# Install dependencies
npm install

# Development (runs both frontend and backend)
npm run dev:full

# Run frontend only (requires backend running separately)
npm run dev

# Run backend only
npm run server

# Production build
npm run build

# Production server (serves built frontend + API)
npm start
```

## Environment Setup

Required: Copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`.

Also required: Copy `config/users.example.json` to `config/users.json` and configure users. Set `SESSION_SECRET` in `.env`.

The server will start without the key but API calls will fail.

## Model Configuration

Backend uses `claude-sonnet-4-20250514` (server.js:29). To change model, edit the `model` field in the `anthropic.messages.create()` call.

## Key Implementation Patterns

**AI Evaluation Flow:**
- Resume evaluation: Parses resume text, matches against job requirements, returns JSON with scores
- Interview generation: Creates tailored questions based on job description and candidate profile
- Follow-up questions: Analyzes candidate answers to generate contextual follow-ups
- Final scoring: Evaluates complete interview transcript across multiple dimensions

**JSON Parsing:**
- Claude responses wrapped in markdown code blocks
- `parseJSON()` function strips ```json markers and extracts JSON object
- Used throughout for structured AI responses

**Error Handling:**
- API errors caught and displayed in red banner at top of page
- User can dismiss errors via X button
- Processing states shown with loading spinners

## Deployment

**Docker:** Builds production bundle, runs on port 3001
**Vercel:** Requires `ANTHROPIC_API_KEY` environment variable

## Tech Stack Notes

- Tailwind CSS for styling (utility-first approach)
- Lucide React for icons
- No routing library (state-based navigation via `page` and `view` state)
- No form library (controlled components with useState)
