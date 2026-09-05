/* Page-local demo data. The component library contains no project or account fixtures. */
window.ArtemisWorkspaceFixtures = {
  files: {
    readme: {
      path: "README.md",
      text: "# Artemis\n\n一个专注于任务的工作空间。\n\n## 开始工作\n\n1. 选择本地项目。\n2. 选择计划、执行或审查模式。\n3. 打开右侧工具面板检查结果。\n\n## 检查与交付\n\n查看更改，阅读任务来源，确认目标范围。",
    },
    html: {
      path: "docs/ui-prototype/apple-inspired-ui.html",
      text: '<!-- 工作空间结构示例 -->\n<div class="app-shell">\n  <nav class="activity-bar"></nav>\n  <aside class="sidebar"></aside>\n  <section class="workspace">\n    <header class="workspace-header"></header>\n    <div class="workspace-content">\n      <section class="conversation"></section>\n      <aside class="workspace-dock"></aside>\n    </div>\n  </section>\n</div>',
    },
    css: {
      path: "docs/ui-prototype/component-tokens.css",
      text: '/* 方案 1 · 浅色 */\n[data-direction="a"][data-theme="light"] {\n  --bg: #f5f5f7;\n  --surface: #ffffff;\n  --text: #1d1d1f;\n  --accent: #0071e3;\n}\n',
    },
    package: {
      path: "package.json",
      text: '{\n  "name": "artemis",\n  "version": "1.4.40",\n  "private": true\n}\n',
    },
  },
  reviews: [
    [
      "apple-inspired-ui.html",
      '  <section class="conversation">',
      '    <div class="composer-topbar"></div>',
      '    <div class="composer"></div>',
      "  </section>",
    ],
    [
      "component-tokens.css",
      "  --r-card: 12px;",
      "  --r-card: 16px;",
      "  --r-composer: 18px;",
      "  --text-2: #5a5a60;",
    ],
    [
      "README.md",
      "## UI 原型",
      "## 工作空间原型",
      "主界面与子面板共用组件。",
      "默认方案 1、浅色、标准对比度。",
    ],
  ],
};
