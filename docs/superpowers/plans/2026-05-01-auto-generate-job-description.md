# Auto-Generate Job Description Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "AI 生成" button next to the Job Description label in the NewJob form that lets recruiters input a brief summary, preview Claude's generated full description, then confirm to fill the textarea.

**Architecture:** All changes are in `src/App.jsx`. `callClaude` is threaded from `RecruiterView` → `NewJob`. A new `generateJobDescription` async function is added alongside existing AI helpers. `NewJob` gains local state for the inline drawer UI (`aiState`, `brief`, `generatedDesc`, `aiError`).

**Tech Stack:** React 18, Tailwind CSS, Lucide React icons, existing `callClaude` utility

---

## File Map

| File | Change |
|------|--------|
| `src/App.jsx` | Only file modified — four targeted edits |

---

## Task 1: Thread `callClaude` prop from `RecruiterView` into `NewJob`

**Files:**
- Modify: `src/App.jsx:178` (RecruiterView newJob branch)
- Modify: `src/App.jsx:252` (NewJob function signature)

- [ ] **Step 1: Update the `newJob` branch in `RecruiterView`**

Find this line (around line 178):
```jsx
if (page === 'newJob') return <NewJob onCancel={() => setPage('jobs')} onCreate={async (job) => { await saveJobs([...jobs, job]); setPage('jobs'); }} />;
```

Replace with:
```jsx
if (page === 'newJob') return <NewJob onCancel={() => setPage('jobs')} onCreate={async (job) => { await saveJobs([...jobs, job]); setPage('jobs'); }} callClaude={callClaude} />;
```

- [ ] **Step 2: Update `NewJob` function signature**

Find (around line 252):
```jsx
function NewJob({ onCancel, onCreate }) {
```

Replace with:
```jsx
function NewJob({ onCancel, onCreate, callClaude }) {
```

- [ ] **Step 3: Verify the app still compiles**

```bash
cd /Users/admin/Downloads/hiring-assistant && npm run build 2>&1 | tail -5
```

Expected output: `✓ built in` with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat: thread callClaude prop into NewJob component"
```

---

## Task 2: Add `generateJobDescription` async function

**Files:**
- Modify: `src/App.jsx` (append after last function `evaluateInterview`, around line 794)

- [ ] **Step 1: Append the function at the end of `src/App.jsx`**

After the closing brace of `evaluateInterview` (the last function in the file), add:

```js
async function generateJobDescription(title, brief, callClaude) {
  const prompt = `你是一位专业的 HR，请根据以下信息生成一份完整的岗位描述（中文）。

岗位名称：${title}
简要说明：${brief}

要求：
- 包含岗位职责（5-7 条）
- 包含任职要求（5-7 条）
- 语言专业、简洁，适合发布在招聘平台
- 直接输出岗位描述正文，不要额外说明`;
  return (await callClaude(prompt)).trim();
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ built in` with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "feat: add generateJobDescription AI helper function"
```

---

## Task 3: Add AI state variables and handler to `NewJob`

**Files:**
- Modify: `src/App.jsx:253-258` (inside `NewJob`, after existing useState lines)

- [ ] **Step 1: Add four state variables inside `NewJob`**

Find (inside `NewJob`, after the existing two useState lines):
```js
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
```

Replace with:
```js
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [aiState, setAiState] = useState('idle');
  const [brief, setBrief] = useState('');
  const [generatedDesc, setGeneratedDesc] = useState('');
  const [aiError, setAiError] = useState(null);
```

- [ ] **Step 2: Add `handleGenerate` handler inside `NewJob`, after the `handleSubmit` function**

Find (inside `NewJob`):
```js
  const handleSubmit = () => {
    if (!title.trim() || !description.trim()) return;
    onCreate({ id: `job_${Date.now()}`, title: title.trim(), description: description.trim(), createdAt: Date.now() });
  };
```

Replace with:
```js
  const handleSubmit = () => {
    if (!title.trim() || !description.trim()) return;
    onCreate({ id: `job_${Date.now()}`, title: title.trim(), description: description.trim(), createdAt: Date.now() });
  };
  const handleGenerate = async () => {
    setAiState('generating');
    setAiError(null);
    try {
      const result = await generateJobDescription(title, brief, callClaude);
      setGeneratedDesc(result);
      setAiState('preview');
    } catch (e) {
      setAiError('生成失败：' + e.message);
      setAiState('input');
    }
  };
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ built in` with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat: add AI generation state and handler to NewJob"
```

---

## Task 4: Add AI generation inline drawer UI to `NewJob`

**Files:**
- Modify: `src/App.jsx` — replace the `<div>` containing the description label and textarea

- [ ] **Step 1: Replace the description `<div>` block**

Find this block inside `NewJob`'s return (the description label + textarea):
```jsx
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Job description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Include responsibilities, required skills, experience level..." rows={10} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent resize-none" />
          </div>
```

Replace with:
```jsx
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-slate-700">Job description</label>
              <button
                type="button"
                onClick={() => setAiState('input')}
                disabled={!title.trim()}
                className="flex items-center gap-1 text-xs text-violet-700 hover:text-violet-900 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Sparkles className="w-3 h-3" /> AI 生成
              </button>
            </div>
            {aiState !== 'idle' && (
              <div className="mb-3 border border-slate-200 rounded-lg p-3 bg-slate-50 space-y-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={brief}
                    onChange={e => setBrief(e.target.value)}
                    placeholder="简要说明，例如：5年经验的高级前端工程师，熟悉 React"
                    disabled={aiState === 'generating'}
                    className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent disabled:bg-slate-100"
                  />
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={!brief.trim() || aiState === 'generating'}
                    className="px-3 py-1.5 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    {aiState === 'generating' ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 生成中...</> : '生成'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAiState('idle'); setBrief(''); setGeneratedDesc(''); setAiError(null); }}
                    disabled={aiState === 'generating'}
                    className="px-3 py-1.5 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-white disabled:opacity-50"
                  >
                    取消
                  </button>
                </div>
                {aiError && <p className="text-xs text-red-600">{aiError}</p>}
                {aiState === 'preview' && (
                  <div className="space-y-2">
                    <div className="bg-white border border-slate-200 rounded-lg p-3 text-sm text-slate-700 whitespace-pre-wrap max-h-48 overflow-y-auto">
                      {generatedDesc}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => { setDescription(generatedDesc); setAiState('idle'); setBrief(''); setGeneratedDesc(''); }}
                        className="px-3 py-1.5 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800"
                      >
                        使用此描述
                      </button>
                      <button
                        type="button"
                        onClick={() => setAiState('input')}
                        className="px-3 py-1.5 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-white"
                      >
                        重新生成
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Include responsibilities, required skills, experience level..." rows={10} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent resize-none" />
          </div>
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ built in` with no errors.

- [ ] **Step 3: Manual browser test — happy path**

Start the dev servers:
```bash
npm run dev:full
```

Open `http://localhost:5173`, log in, go to Recruiter → New Role:

1. Leave "Job title" empty → confirm "AI 生成" button is greyed out (disabled)
2. Type a title (e.g. "高级前端工程师") → confirm "AI 生成" button becomes active
3. Click "AI 生成" → confirm inline drawer expands showing brief input + "生成" + "取消"
4. Leave brief empty → confirm "生成" button is disabled
5. Type a brief (e.g. "熟悉 React 和 TypeScript，5年经验，带过小团队") → click "生成"
6. Confirm loading state ("生成中..." spinner) appears
7. Confirm preview appears with generated description text
8. Click "重新生成" → confirm drawer returns to input state with brief still filled
9. Click "生成" again → preview appears
10. Click "使用此描述" → confirm drawer closes, description textarea is filled with generated text
11. Click "取消" at step 3 instead → confirm drawer closes, textarea unchanged

- [ ] **Step 4: Manual browser test — error path**

To simulate an error, temporarily break the brief by checking what happens if the server is down (stop `npm run server`, try generating) — confirm red error message appears inside the drawer (not the global red banner), and state returns to `input`.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "feat: add AI generation inline drawer to NewJob description field"
```
