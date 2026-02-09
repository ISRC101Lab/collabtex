# Aitex

AI 驱动的协作式 LaTeX 在线编辑器，类似 Overleaf 的自托管方案。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Vite |
| 编辑器 | CodeMirror 6 (LaTeX 语法高亮、自动补全、代码折叠) |
| 状态管理 | Zustand |
| 路由 | React Router v6 |
| 后端 | Express + Node.js (>=18.18) |
| 协作 | Hocuspocus (Yjs WebSocket) |
| AI | OpenAI 兼容 API (SSE 流式) |
| PDF | pdfjs-dist |

## 项目结构

```
aitex/
├── client/                  # 前端源码
│   ├── src/
│   │   ├── api/             # API 客户端
│   │   ├── components/
│   │   │   ├── ai/          # AI 聊天面板、Diff 视图
│   │   │   ├── collab/      # 协作管理器
│   │   │   ├── common/      # 通用组件 (Button, Modal, Toast...)
│   │   │   ├── editor/      # 代码编辑器、TabBar、搜索面板
│   │   │   ├── filetree/    # 文件树 (右键菜单、拖拽上传)
│   │   │   ├── layout/      # Header、ResizeHandle、OnlineUsers
│   │   │   └── pdf/         # PDF 预览、编译日志
│   │   ├── lib/             # LaTeX 补全、代码片段、日志解析
│   │   ├── pages/           # 页面 (Login, ProjectList, Editor)
│   │   ├── stores/          # Zustand stores
│   │   └── styles/          # 全局样式
│   └── index.html
├── server/                  # 后端源码
│   ├── index.js             # 入口 (Express + Hocuspocus)
│   ├── collab.js            # 协作服务
│   ├── lib/                 # 工具库 (用户、项目、会话、路径)
│   └── routes/              # API 路由
│       ├── ai.js            # AI 聊天 (SSE)
│       ├── auth.js          # 认证
│       ├── compile.js       # LaTeX 编译
│       ├── download.js      # ZIP 下载
│       ├── files.js         # 文件 CRUD
│       ├── projects.js      # 项目管理
│       ├── search.js        # 全文搜索
│       └── upload.js        # 文件上传
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## 功能特性

- **LaTeX 编辑器** — CodeMirror 6，支持语法高亮、命令/环境自动补全、`\ref`/`\cite` 补全、代码折叠、代码片段
- **多编译器** — pdfLaTeX / XeLaTeX / LuaLaTeX / Latexmk 一键切换
- **PDF 预览** — 编译后实时预览，支持 SyncTeX 跳转到源码行
- **AI 助手** — SSE 流式对话，支持读取/写入/编辑项目文件，Accept/Reject 变更审查
- **文件管理** — 文件树右键菜单（新建、重命名、删除、移动），拖拽上传，ZIP 下载
- **协作** — 项目分享、在线用户显示、协作管理器
- **多项目** — 创建/删除/导入（ZIP）项目，项目列表页
- **面板布局** — 侧栏/PDF/AI 面板可拖拽调整宽度，可独立开关

## 前置要求

- Node.js >= 18.18
- TeX Live（需要 `pdflatex`、`xelatex`、`lualatex`、`latexmk` 中至少一个）

## 安装

```bash
git clone git@github.com:ISRC101Lab/collabtex.git
cd collabtex
git checkout aitex
npm install
```

## 运行

**开发模式**（前后端同时启动）：

```bash
npm run dev
```

**生产模式**：

```bash
npm run build
npm start
```

| 服务 | 地址 |
|------|------|
| Web | `http://127.0.0.1:4092` |
| WebSocket | `ws://127.0.0.1:4093` |
| 数据目录 | `./aitex-data/` |
