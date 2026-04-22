# Access Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add password-based login to the entire application using express-session and a JSON config file for credentials.

**Architecture:** Express backend gains session middleware, auth endpoints (`/api/login`, `/api/logout`, `/api/me`), and a route-protection middleware. React frontend adds a `LoginPage` component and wraps the existing `HiringAssistant` behind an auth check. Credentials are loaded from `config/users.json` at server startup.

**Tech Stack:** express-session, existing Express + React + Vite stack

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `config/users.example.json` | Template for user credentials |
| Create | `config/users.json` | Actual user credentials (gitignored) |
| Modify | `.gitignore` | Add `config/users.json` |
| Modify | `.env.example` | Add `SESSION_SECRET` |
| Modify | `server.js` | Add session middleware, auth endpoints, route protection |
| Create | `src/LoginPage.jsx` | Login form component |
| Modify | `src/App.jsx` | Wrap app in auth check, add logout to header |
| Modify | `package.json` | Add `express-session` dependency (via npm install) |

---

### Task 1: Configuration Files and Dependencies

**Files:**
- Create: `config/users.example.json`
- Create: `config/users.json`
- Modify: `.gitignore`
- Modify: `.env.example`

- [ ] **Step 1: Create `config/users.example.json`**

```json
{
  "users": [
    { "username": "admin", "password": "changeme" }
  ]
}
```

- [ ] **Step 2: Create `config/users.json` with working defaults**

```json
{
  "users": [
    { "username": "admin", "password": "admin123" },
    { "username": "recruiter", "password": "recruit456" }
  ]
}
```

- [ ] **Step 3: Add `config/users.json` to `.gitignore`**

Append to `.gitignore`:
```
config/users.json
```

- [ ] **Step 4: Add `SESSION_SECRET` to `.env.example`**

Add this line to `.env.example`:
```
SESSION_SECRET=change-this-to-a-random-string
```

- [ ] **Step 5: Add `SESSION_SECRET` to local `.env`**

Add to `.env`:
```
SESSION_SECRET=dev-secret-change-in-production
```

- [ ] **Step 6: Install express-session**

Run:
```bash
npm install express-session
```

- [ ] **Step 7: Commit**

```bash
git add config/users.example.json .gitignore .env.example package.json package-lock.json
git commit -m "feat: add auth config files and express-session dependency"
```

---

### Task 2: Backend Auth — Session Middleware and User Loading

**Files:**
- Modify: `server.js:1-15` (imports and setup section)

- [ ] **Step 1: Add imports and user loading to `server.js`**

Add after the existing imports (line 6):

```javascript
import session from 'express-session';
import fs from 'fs';
```

Add after `const PORT = ...` (line 12), replacing the existing middleware section:

```javascript
// Load users from config
const usersConfigPath = path.join(__dirname, 'config', 'users.json');
if (!fs.existsSync(usersConfigPath)) {
  console.error('❌ Missing config/users.json. Copy config/users.example.json and add your users.');
  process.exit(1);
}

let users;
try {
  users = JSON.parse(fs.readFileSync(usersConfigPath, 'utf-8')).users;
} catch (e) {
  console.error('❌ Invalid config/users.json:', e.message);
  process.exit(1);
}

if (!process.env.SESSION_SECRET) {
  console.error('❌ SESSION_SECRET not set in .env');
  process.exit(1);
}
```

- [ ] **Step 2: Add session middleware after `app.use(express.json(...))`**

```javascript
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));
```

- [ ] **Step 3: Verify server starts**

Run:
```bash
node server.js
```
Expected: Server starts without errors (assuming `.env` has `SESSION_SECRET`).

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: add session middleware and user config loading"
```

---

### Task 3: Backend Auth — Login, Logout, Me Endpoints

**Files:**
- Modify: `server.js` (add endpoints before the `/api/claude` route)

- [ ] **Step 1: Add auth endpoints**

Add these routes in `server.js` after the session middleware and before the existing `app.post('/api/claude', ...)`:

```javascript
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  req.session.user = { username: user.username };
  res.json({ username: user.username });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json(req.session.user);
});
```

- [ ] **Step 2: Add auth middleware to protect `/api/claude`**

Add this middleware function before the auth endpoints:

```javascript
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
```

Then modify the existing claude route to use it:

```javascript
app.post('/api/claude', requireAuth, async (req, res) => {
```

- [ ] **Step 3: Test the auth flow manually**

Run:
```bash
node server.js
```

Test login:
```bash
curl -c cookies.txt -X POST http://localhost:3001/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```
Expected: `{"username":"admin"}`

Test /api/me with session:
```bash
curl -b cookies.txt http://localhost:3001/api/me
```
Expected: `{"username":"admin"}`

Test /api/me without session:
```bash
curl http://localhost:3001/api/me
```
Expected: `{"error":"Unauthorized"}` with 401

Test logout:
```bash
curl -b cookies.txt -X POST http://localhost:3001/api/logout
```
Expected: `{"ok":true}`

Clean up:
```bash
rm -f cookies.txt
```

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: add login, logout, me endpoints and route protection"
```

---

### Task 4: Frontend — Login Page Component

**Files:**
- Create: `src/LoginPage.jsx`

- [ ] **Step 1: Create `src/LoginPage.jsx`**

```jsx
import React, { useState } from 'react';
import { Loader2, Sparkles, LogIn } from 'lucide-react';

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Login failed');
        return;
      }
      onLogin(data);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 bg-slate-900 rounded-lg flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Hiring Assistant</h1>
            <p className="text-xs text-slate-500">Sign in to continue</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-slate-700 mb-1.5">Username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
              autoFocus
              autoComplete="username"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
              autoComplete="current-password"
            />
          </div>
          <button
            type="submit"
            disabled={!username.trim() || !password.trim() || loading}
            className="w-full px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in...</> : <><LogIn className="w-4 h-4" /> Sign in</>}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/LoginPage.jsx
git commit -m "feat: add LoginPage component"
```

---

### Task 5: Frontend — Integrate Auth into App.jsx

**Files:**
- Modify: `src/App.jsx:1-136` (imports, state, header)

- [ ] **Step 1: Add import for LoginPage**

At the top of `src/App.jsx`, add after the existing import:

```javascript
import LoginPage from './LoginPage.jsx';
```

Also add `LogOut` to the lucide-react import:

```javascript
import { ..., LogOut } from 'lucide-react';
```

- [ ] **Step 2: Add auth state and check**

Inside the `HiringAssistant` component, add these state variables after the existing ones (after line 13):

```javascript
const [currentUser, setCurrentUser] = useState(null);
const [authChecked, setAuthChecked] = useState(false);
```

Add a `useEffect` for the auth check, right after the existing `useEffect(() => { loadData(); }, []);`:

```javascript
useEffect(() => {
  fetch('/api/me', { credentials: 'include' })
    .then(res => res.ok ? res.json() : Promise.reject())
    .then(user => setCurrentUser(user))
    .catch(() => setCurrentUser(null))
    .finally(() => setAuthChecked(true));
}, []);
```

- [ ] **Step 3: Add credentials to all fetch calls**

In the `callClaude` function, add `credentials: 'include'` to the fetch options:

```javascript
const response = await fetch('/api/claude', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify(body)
});
```

- [ ] **Step 4: Add login/logout rendering logic**

Replace the existing loading check (lines 61-67) with:

```javascript
if (!authChecked) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
    </div>
  );
}

if (!currentUser) {
  return <LoginPage onLogin={(user) => { setCurrentUser(user); loadData(); }} />;
}

if (loading) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
    </div>
  );
}
```

- [ ] **Step 5: Add logout handler**

Add this function inside the `HiringAssistant` component, after the `parseJSON` function:

```javascript
const handleLogout = async () => {
  await fetch('/api/logout', { method: 'POST', credentials: 'include' });
  setCurrentUser(null);
};
```

- [ ] **Step 6: Add user info and logout button to header**

In the header JSX, add a user info section. Replace the existing `<div className="flex bg-slate-100 rounded-lg p-1">` block (the recruiter/candidate toggle) with:

```jsx
<div className="flex items-center gap-3">
  <div className="flex bg-slate-100 rounded-lg p-1">
    <button
      onClick={() => { setView('recruiter'); setPage('jobs'); }}
      className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${view === 'recruiter' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
    >
      <Building2 className="w-4 h-4 inline mr-1.5" />
      Recruiter
    </button>
    <button
      onClick={() => { setView('candidate'); setPage('select'); }}
      className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${view === 'candidate' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
    >
      <User className="w-4 h-4 inline mr-1.5" />
      Candidate
    </button>
  </div>
  <div className="flex items-center gap-2 pl-3 border-l border-slate-200">
    <span className="text-sm text-slate-600">{currentUser.username}</span>
    <button onClick={handleLogout} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100" title="Sign out">
      <LogOut className="w-4 h-4" />
    </button>
  </div>
</div>
```

- [ ] **Step 7: Verify the full flow**

Start the dev server manually:
```bash
npm run dev:full
```

Test in browser at `http://localhost:5173`:
1. Page should show login form
2. Enter wrong credentials → error message
3. Enter `admin` / `admin123` → main app loads
4. Header shows username and logout button
5. Refresh page → stays logged in
6. Click logout → returns to login page
7. Recruiter and candidate views work as before

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx
git commit -m "feat: integrate auth check, login gate, and logout into App"
```

---

### Task 6: Update CORS for Credentials

**Files:**
- Modify: `server.js:14` (cors config)

- [ ] **Step 1: Update CORS to support credentials**

Replace `app.use(cors());` with:

```javascript
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));
```

This is needed because `credentials: 'include'` in fetch requires the server to explicitly allow credentials via CORS.

- [ ] **Step 2: Commit**

```bash
git add server.js
git commit -m "feat: configure CORS to allow credentials for session cookies"
```

---

### Task 7: Update Documentation

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update README.md Quick Start section**

Update the Quick Start to include the new setup steps:

```markdown
## Quick Start

```bash
npm install
cp .env.example .env
# Edit .env: add ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN, set SESSION_SECRET
cp config/users.example.json config/users.json
# Edit config/users.json: add your users
npm run dev:full
```
```

- [ ] **Step 2: Update CLAUDE.md**

Add to the Environment Setup section:

```markdown
Also required: Copy `config/users.example.json` to `config/users.json` and configure users. Set `SESSION_SECRET` in `.env`.
```

Add to the Architecture section under Data Flow:

```markdown
**Authentication Flow:**
1. Browser loads app → `GET /api/me` checks session
2. If no session → LoginPage shown
3. `POST /api/login` validates against `config/users.json` → creates session
4. Session cookie sent automatically on subsequent requests
5. `POST /api/logout` destroys session → back to login
```

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: update README and CLAUDE.md with auth setup instructions"
```
