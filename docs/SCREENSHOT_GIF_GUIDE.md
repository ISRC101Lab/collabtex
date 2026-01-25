# 截图与演示 GIF 产出指南

> 目标：用最少步骤产出“可对外展示”的截图与 GIF。

## 推荐工具

- 录屏：Screenity / OBS
- 截图：浏览器自带截图或系统截图
- GIF 转换：`ffmpeg`

## 演示 GIF（15–25 秒）脚本

1) 登录 → 打开一个项目
2) 编辑 `main.tex`，输入一行文字
3) 点击“编译” → PDF 更新
4) 点击“同步 PDF” → PDF 跳转
5) 在 PDF 中点击正文 → 回到源码

## 录制参数建议

- 分辨率：1920x1080
- 帧率：30fps
- 光标：可见
- 浏览器缩放：100%

## GIF 生成

录制完成后得到 `demo.mp4`，运行：

```bash
scripts/make_gif.sh demo.mp4 docs/demo.gif
```

会生成高质量、体积较小的 GIF。

## 截图清单（建议）

- 项目列表页（含项目卡片）
- 三栏编辑界面（文件树 + 编辑器 + PDF 预览）
- 编译成功 + 日志摘要
- SyncTeX 源码 → PDF
- PDF → 源码跳转


## 自动录制脚本（生成 MP4）

需要安装 Playwright + 浏览器：

```bash
npm i -D playwright
npx playwright install chromium
```

运行录制脚本：

```bash
BASE_URL=http://127.0.0.1:3080 \
USERNAME=admin PASSWORD=ChangeMe!2026 \
PROJECT_NAME="" \
./scripts/record_demo.sh
```

输出：
- `docs/demo/demo.webm`
- `docs/demo/demo.mp4`（需 ffmpeg）

