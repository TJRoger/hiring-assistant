# Access Control Design

## Goal

Add password-based access control to the entire application. Users must log in before accessing any page. User credentials are loaded from a JSON configuration file.

## Requirements

- Protect the entire application behind login
- Load username and password pairs from a JSON config file
- Use server-side session and cookie based authentication
- Store passwords in plaintext in the config file
- Keep the existing recruiter and candidate views unchanged after login
- Show a login page when the user is not authenticated

## Configuration

Add a new file at `config/users.json`:

```json
{
  "users": [
    { "username": "admin", "password": "admin123" },
    { "username": "recruiter", "password": "recruit456" }
  ]
}
```

Also provide `config/users.example.json` as a template.

`config/users.json` should be gitignored so real credentials are not committed.

## Backend Design

### User loading

The server loads and parses `config/users.json` at startup. If the file is missing or invalid, startup should fail with a clear error message because authentication is required for the app to function.

### Session management

Use `express-session` with the default in-memory store.

Session settings:
- `httpOnly: true`
- `secure: false` in development
- `sameSite: 'lax'`
- `maxAge: 24 hours`

A fixed session secret will not be hardcoded. It should come from environment configuration, with `.env.example` documenting the variable.

### Authentication endpoints

#### `POST /api/login`
Request body:
```json
{ "username": "admin", "password": "admin123" }
```

Behavior:
- Validate both fields are present
- Compare against loaded users from config
- On success, store `{ username }` in the session
- Return current user info
- On failure, return 401

#### `POST /api/logout`
Behavior:
- Destroy the session
- Clear the session cookie
- Return success response

#### `GET /api/me`
Behavior:
- Return authenticated user info when session exists
- Return 401 when not logged in

### Route protection

Add an auth middleware for `/api/*` routes except `/api/login`.

Protected routes:
- `/api/claude`
- `/api/logout`
- `/api/me`

Unauthenticated requests return:
```json
{ "error": "Unauthorized" }
```
with HTTP 401.

## Frontend Design

### Auth state

Add auth state to `App.jsx`:
- `authChecked`
- `currentUser`
- `loginForm`

On app startup, call `GET /api/me`.
- If 200, render the existing app
- If 401, render the login page

All fetch requests must include credentials so the browser sends the session cookie.

### Login UI

Add a login screen before the existing app shell.

Fields:
- username
- password

Actions:
- Submit button
- Error message on login failure
- Loading state while authenticating

### Logged-in UI changes

Keep existing recruiter/candidate flows unchanged.

In the header, add:
- current username
- logout button

Logout behavior:
- call `POST /api/logout`
- clear frontend auth state
- return to login page

## Data Flow

1. Browser loads app
2. Frontend calls `GET /api/me`
3. If unauthenticated, login form is shown
4. User submits credentials to `POST /api/login`
5. Server validates config-based credentials and creates session
6. Browser stores session cookie
7. Frontend renders the main app
8. Authenticated API calls continue using the cookie automatically
9. On logout, session is destroyed and app returns to login screen

## Error Handling

- Missing `config/users.json`: server startup fails with clear message
- Invalid JSON in config: server startup fails with clear message
- Missing session secret: server startup fails with clear message
- Wrong username/password: show inline login error
- Expired/missing session: frontend falls back to login page on 401 from auth check

## Testing

Manual verification:
- unauthenticated user cannot access app content
- valid login succeeds
- invalid login fails with error
- page refresh keeps the session
- logout returns to login page
- authenticated user can still use existing Claude-backed workflows

## Scope Boundaries

This design does not include:
- password hashing
- multi-role authorization
- user management UI
- persistent session store
- rate limiting or lockout policy

Those can be added later if needed, but are intentionally out of scope for this change.
