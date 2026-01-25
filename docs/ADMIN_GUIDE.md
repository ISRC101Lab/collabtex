# 管理员手册（CollabTeX）

## 1. 依赖

- Node.js >= 18.18
- LaTeX 发行版（TeX Live 或 MacTeX）
- 可选：Docker（用于隔离编译）

## 2. 启动

```bash
npm install
npm run build
./run.sh
```

或自定义环境变量：

```bash
DATA_DIR=/data/collabtex \
WEB_HOST=0.0.0.0 WEB_PORT=3080 \
WS_HOST=0.0.0.0 WS_PORT=3081 \
INIT_PASSWORD=ChangeMe!2026 \
node server/index.js
```

## 3. 用户管理

- 查看用户：`node scripts/list_users.js`
- 修改密码：`node scripts/set_password.js user01 'NewPass123!'`

## 4. 数据与备份

- 所有项目在 `collabtex-data/projects/`
- 备份时打包 `collabtex-data/`

## 5. 编译优化

常用环境变量：

- `MAX_COMPILE_JOBS`
- `COMPILE_JOB_MEM_MB`
- `COMPILE_CPU_SHARE`
- `COMPILE_TIMEOUT_MS`

## 6. Docker 编译（可选）

```bash
COMPILE_DOCKER=1
COMPILE_DOCKER_IMAGE=texlive/texlive:latest
```

注意：镜像需包含论文所需 LaTeX 包。

## 7. AI 一键修复（可选）

```bash
export OPENAI_API_KEY="..."
export OPENAI_MODEL="gpt-5.2-codex"
```

## 8. 常见排障

- 编译失败：检查 `collabtex-data/projects/<id>/build/main.log`
- 页面打不开：确认 `3080/3081` 端口可用
- 同步失败：确认 PDF 是最新编译结果

