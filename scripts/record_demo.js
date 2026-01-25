import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:3080";
const username = process.env.USERNAME || "admin";
const password = process.env.PASSWORD || "ChangeMe!2026";
const projectName = process.env.PROJECT_NAME || "";
const recordDir = process.env.RECORD_DIR || "docs/demo/raw";
const outputWebm = process.env.OUTPUT_WEBM || "docs/demo/demo.webm";
const outputMp4 = process.env.OUTPUT_MP4 || "docs/demo/demo.mp4";
const width = Number(process.env.WIDTH || 1280);
const height = Number(process.env.HEIGHT || 720);
const headful = process.env.HEADFUL === "1";
const convertMp4 = process.env.CONVERT_MP4 !== "0";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

function pickLocator(page, selectors) {
  for (const sel of selectors) {
    const loc = page.locator(sel);
    return loc;
  }
  return null;
}

async function fillIfVisible(locator, value) {
  if (!locator) return false;
  if (await locator.count()) {
    const first = locator.first();
    if (await first.isVisible()) {
      await first.fill(value);
      return true;
    }
  }
  return false;
}

async function clickIfVisible(locator) {
  if (!locator) return false;
  if (await locator.count()) {
    const first = locator.first();
    if (await first.isVisible()) {
      await first.click();
      return true;
    }
  }
  return false;
}

async function main() {
  await ensureDir(recordDir);
  await ensureDir(path.dirname(outputWebm));
  await ensureDir(path.dirname(outputMp4));

  const browser = await chromium.launch({ headless: !headful });
  const context = await browser.newContext({
    viewport: { width, height },
    recordVideo: { dir: recordDir, size: { width, height } },
  });
  const page = await context.newPage();

  let nextPromptValue = null;
  page.on("dialog", async (dialog) => {
    const type = dialog.type();
    if (type === "prompt") {
      await dialog.accept(nextPromptValue || "demo-note.tex");
      nextPromptValue = null;
      return;
    }
    await dialog.accept();
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });

  // If login screen is visible, log in.
  const loginBtn = page.getByRole("button", { name: /登录|Log in/i });
  if (await loginBtn.count()) {
    const userInput = page.locator('input[placeholder*="用户名"], input[placeholder*="Username"]');
    const passInput = page.locator('input[placeholder*="密码"], input[placeholder*="Password"]');
    await fillIfVisible(userInput, username);
    await fillIfVisible(passInput, password);
    await clickIfVisible(loginBtn);
  }

  // Wait for project list.
  await page.waitForSelector("#projectList", { timeout: 30000 });

  if (projectName) {
    const filterInput = page.locator('input[placeholder*="搜索项目"], input[placeholder*="Search projects"]');
    await fillIfVisible(filterInput, projectName);
    await wait(400);
  }

  const openBtn = projectName
    ? page.locator('.project-row').filter({ hasText: projectName }).locator('button:has-text("打开"), button:has-text("Open")')
    : page.locator('.project-row').first().locator('button:has-text("打开"), button:has-text("Open")');
  await openBtn.first().click();

  // Wait for editor and file tree.
  await page.waitForSelector("#editorHost", { timeout: 30000 });
  await page.waitForSelector("#fileTree", { timeout: 30000 });

  // Open main.tex if present.
  const mainBtn = page.getByRole("button", { name: /main\.tex/i });
  if (await mainBtn.count()) {
    await mainBtn.first().click();
  } else {
    const firstFile = page.locator('.tree-row.file .tree-filebtn').first();
    if (await firstFile.count()) await firstFile.click();
  }

  // Type a small edit.
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.type(`\n% demo line ${new Date().toISOString()}`);

  // Compile and wait for success.
  await page.click('#compileBtn');
  await page.waitForFunction(() => {
    const el = document.getElementById('compileStatus');
    return el && el.getAttribute('data-status') === 'success';
  }, { timeout: 180000 });

  // Wait for PDF to render.
  await page.waitForSelector('#pdfPages canvas', { timeout: 60000 });

  // Sync source -> PDF.
  const syncBtn = page.getByRole('button', { name: /同步 PDF|Sync PDF/i });
  if (await syncBtn.count()) await syncBtn.first().click();
  await wait(800);

  // Click inside PDF to jump back to source.
  const pdfViewer = page.locator('#pdfViewer');
  const box = await pdfViewer.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  }
  await wait(800);

  // Open logs tab then back to PDF.
  const logsTab = page.getByRole('button', { name: /日志|Log/i });
  if (await logsTab.count()) await logsTab.first().click();
  await wait(600);
  const pdfTab = page.getByRole('button', { name: /PDF 预览|PDF Preview/i });
  if (await pdfTab.count()) await pdfTab.first().click();
  await wait(600);

  // Create and delete a temp file to demonstrate file management.
  const newFileBtn = page.getByRole('button', { name: /\+ 新文件|New File/i });
  if (await newFileBtn.count()) {
    nextPromptValue = 'demo-note.tex';
    await newFileBtn.first().click();
    await wait(800);

    const tempRow = page.locator('.tree-row.file').filter({ hasText: 'demo-note.tex' });
    if (await tempRow.count()) {
      const deleteBtn = tempRow.first().locator('button:has-text("删除"), button:has-text("Delete")');
      if (await deleteBtn.count()) await deleteBtn.first().click();
      await wait(500);
    }
  }

  // Finish.
  await wait(1000);
  const video = page.video();
  await page.close();
  await context.close();
  await browser.close();

  if (!video) return;
  const videoPath = await video.path();
  if (videoPath) {
    await fs.rename(videoPath, outputWebm).catch(async () => {
      // if cross-device rename fails, copy+unlink
      const data = await fs.readFile(videoPath);
      await fs.writeFile(outputWebm, data);
      await fs.unlink(videoPath);
    });
  }

  if (convertMp4) {
    const ff = spawnSync('ffmpeg', [
      '-y',
      '-i', outputWebm,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      outputMp4,
    ], { stdio: 'inherit' });
    if (ff.status !== 0) {
      console.error('ffmpeg failed; keeping webm output only');
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
