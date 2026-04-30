# 自动生成岗位描述功能设计

**日期：** 2026-05-01  
**状态：** 已批准

## 概述

在新建岗位表单中，招聘人员可以输入简要说明，点击"AI 生成"按钮，由 Claude 自动生成完整的岗位描述，预览确认后填入描述框。

## 涉及文件

- `src/App.jsx` — 唯一需要修改的文件

## UI 布局与交互流程

在 `NewJob` 组件（App.jsx 约第 252 行）的"岗位描述"label 行右侧新增"AI 生成"按钮。点击后，在描述 textarea 上方展开一个行内抽屉区域。

### 交互状态机

| 状态 | 显示内容 |
|------|---------|
| `idle` | 仅显示"AI 生成"按钮（label 右侧） |
| `input` | 展开区域：简要说明输入框 + "生成"按钮 + "取消"按钮 |
| `generating` | 同上，但显示加载动画，所有按钮 disabled |
| `preview` | 展开区域：生成结果预览 + "使用此描述"按钮 + "重新生成"按钮 |

点击"使用此描述" → 将预览文本填入 description state，区域收起回到 `idle`。  
点击"重新生成" → 回到 `input` 状态，保留已填写的 `brief`，用户可修改后再次生成。

## 数据流

### 新增 prop 传递

`RecruiterView`（第 176 行）在 `page === 'newJob'` 分支将 `callClaude` 向下传给 `NewJob`：

```jsx
if (page === 'newJob') return <NewJob
  onCancel={() => setPage('jobs')}
  onCreate={async (job) => { await saveJobs([...jobs, job]); setPage('jobs'); }}
  callClaude={callClaude}
/>;
```

### NewJob 新增 state

```js
const [aiState, setAiState] = useState('idle');  // 'idle'|'input'|'generating'|'preview'
const [brief, setBrief] = useState('');
const [generatedDesc, setGeneratedDesc] = useState('');
const [aiError, setAiError] = useState(null);
```

### 新增函数（文件末尾，与其他 AI 函数并列）

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

返回纯文本，无需 `parseJSON`。

## 错误处理与边界情况

| 情况 | 处理方式 |
|------|---------|
| 岗位名称为空时点击"AI 生成" | 按钮 `disabled={!title.trim()}` |
| 简要说明为空时点击"生成" | 生成按钮 `disabled={!brief.trim()}` |
| AI 调用失败 | 在 AI 生成区内显示红色错误提示，状态回到 `input`，不使用全局 error banner |
| 描述框已有内容时确认使用 | 直接覆盖，用户已在预览步骤确认 |

## 实现范围

- 仅修改 `src/App.jsx`
- 不新增文件，不修改 `server.js`
- 不引入新依赖
