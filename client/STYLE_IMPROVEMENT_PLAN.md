# CollabTeX CSS 改进方案

## 现状
- 单一 style.css 文件 3351 行
- 功能完整但维护困难
- 存在多个 z-index、pointer-events 问题

## 改进策略

### 方案 A: 最小改动（推荐）
保持现有 style.css，在关键位置添加修复：

1. **tree-actions 修复**
   ```css
   .tree-actions {
     display: flex;  /* 不要用 display: none */
     opacity: 0;
     pointer-events: none;
   }
   .tree-row:hover .tree-actions {
     opacity: 1;
     pointer-events: auto;
   }
   ```

2. **modal z-index 确保**
   ```css
   .modal-overlay { z-index: 1000; }
   .modal { pointer-events: auto; }
   ```

3. **PDF 操作栏 z-index**
   ```css
   .pdf-action-bar { z-index: 50; }
   ```

### 方案 B: 模块化重构
分离 style.css 为多个模块：

```
style-modules/
├── 00-variables.css      /* CSS 变量 */
├── 01-reset.css           /* 重置和基础 */
├── 10-layout.css          /* 布局 */
├── 20-components.css      /* 组件 */
├── 30-interactions.css     /* 交互 */
└── 40-performance.css     /* 性能优化 */
```

### 方案 C: 增量优化
逐步优化，每次改进一个功能区域：

1. 第1周：修复 tree-actions 和 modal 问题
2. 第2周：优化颜色和间距
3. 第3周：性能优化（GPU加速、containment）
4. 第4周：响应式改进

## 推荐执行

建议 **方案 A + 模块化记录**：
- 先用最小改动修复所有 bug
- 创建 style-modules 目录，记录最佳实践
- 留给未来重构的标准化指南

## 关键修复清单

- [ ] tree-actions: display flex + pointer-events
- [ ] modal-overlay: z-index 1000+
- [ ] pdf-action-bar: z-index 明确
- [ ] 所有 hover 状态: pointer-events 正确
- [ ] GPU 加速: 关键交互元素
- [ ] CSS Containment: 大列表性能

## 开发建议

1. **测试流程**
   - 修改每个CSS规则后立即测试
   - 使用 npm run build && 刷新浏览器
   - 检查特定功能是否仍可用

2. **版本控制**
   - 每个修复创建单独的 commit
   - 使用 git stash 尝试版本
   - 保留 rollback 能力

3. **性能监控**
   - Chrome DevTools Performance 面板
   - 关注 FPS 和 Long Tasks
   - 预期改进 10-20%
