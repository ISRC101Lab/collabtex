#!/usr/bin/env node

/**
 * CSS Modules Compiler
 * 将模块化 CSS 文件编译成单一的 style.css
 */

const fs = require('fs');
const path = require('path');

const MODULES_DIR = path.join(__dirname, 'style-modules');
const OUTPUT_FILE = path.join(__dirname, 'style.css');

// 模块加载顺序（重要！）
const moduleOrder = [
  '00-reset.css',
  '01-variables.css',
  '02-typography.css',
  '10-layout-root.css',
  '11-topbar.css',
  '12-sidebar.css',
  '13-editor.css',
  '14-preview.css',
  '20-buttons.css',
  '21-inputs.css',
  '22-modals.css',
  '23-trees.css',
  '24-menus.css',
  '30-animations.css',
  '31-interactions.css',
  '32-performance.css',
  '33-responsive.css',
  '99-utilities.css'
];

function compileModules() {
  let css = '/* Auto-generated from modular CSS components */\n';
  css += `/* Generated at ${new Date().toISOString()} */\n\n`;

  for (const module of moduleOrder) {
    const modulePath = path.join(MODULES_DIR, module);
    if (fs.existsSync(modulePath)) {
      const content = fs.readFileSync(modulePath, 'utf8');
      css += `/* ===== ${module.replace('.css', '').toUpperCase()} ===== */\n`;
      css += content;
      css += '\n\n';
    }
  }

  fs.writeFileSync(OUTPUT_FILE, css);
  console.log(`✅ CSS compiled: ${OUTPUT_FILE}`);
  console.log(`   Total size: ${(css.length / 1024).toFixed(2)} KB`);
}

compileModules();
