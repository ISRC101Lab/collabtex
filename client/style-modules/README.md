# 模块化 CSS 结构

将 CSS 分为独立的模块，每个模块负责特定的功能区域。

## 模块清单

### 核心模块
- `00-variables.css` - CSS 变量和设计令牌
- `01-reset.css` - 基础重置和标准化
- `02-typography.css` - 字体和文本样式

### 布局模块
- `10-layout.css` - 主容器和网格系统
- `11-topbar.css` - 顶部工具栏
- `12-sidebar.css` - 左侧边栏
- `13-editor.css` - 编辑器区域
- `14-preview.css` - PDF 预览区域

### 组件模块
- `20-buttons.css` - 按钮样式
- `21-inputs.css` - 输入框和表单
- `22-modals.css` - 模态框和对话框
- `23-trees.css` - 文件树组件
- `24-menus.css` - 菜单和下拉框

### 功能模块
- `30-animations.css` - 动画和过渡
- `31-interactions.css` - 悬停、焦点等交互
- `32-performance.css` - GPU 加速、containment
- `33-responsive.css` - 响应式设计

## 使用方法

### 编译所有模块
```bash
cat style-modules/00-variables.css \
    style-modules/01-reset.css \
    style-modules/02-typography.css \
    ... > compiled.css
```

### 在 style.css 中导入
```css
@import "style-modules/00-variables.css";
@import "style-modules/01-reset.css";
/* 其他模块 */
```

## 优势

1. **可维护性** - 每个模块独立，易于修改
2. **可复用性** - 模块可在多个项目间共享
3. **性能** - 按需加载，减少 CSS 冗余
4. **团队协作** - 多人可并行开发不同模块
5. **版本控制** - 更容易追踪变更

## 开发指南

- 每个模块保持在 300 行以内
- 使用 BEM 命名约定
- 避免在模块间使用硬编码颜色，优先使用 CSS 变量
- 添加注释说明模块功能和用法
