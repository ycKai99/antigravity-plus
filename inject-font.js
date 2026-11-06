const { getTargets, evaluate } = require('./cdp');

// Shared by the standalone font injector and the managed theme on reconnect.
const fontCss = `
        /* 0. 仅将 AI 输出的消息内容区域替换字体：英文 Anthropic Sans，中文 Sarasa UI SC */
        .leading-relaxed.select-text,
        .leading-relaxed.select-text p,
        .leading-relaxed.select-text span,
        .leading-relaxed.select-text li,
        .leading-relaxed.select-text blockquote,
        .leading-relaxed.select-text h1,
        .leading-relaxed.select-text h2,
        .leading-relaxed.select-text h3,
        .leading-relaxed.select-text h4 {
            font-family: 'Anthropic Sans', 'Anthropic Sans Web Text', 'Sarasa UI SC', '更纱黑体 UI SC', '更纱黑体 SC', ui-sans-serif, system-ui, -apple-system, sans-serif !important;
        }

        /* 1. 覆盖 CSS 变量，Monaco Editor 等组件可能会使用这些变量 */
        :root {
            --monaco-monospace-font: 'Maple Mono NF', 'Maple Mono', monospace !important;
            --code-font-family: 'Maple Mono NF', 'Maple Mono', monospace !important;
            --vscode-editor-font-family: 'Maple Mono NF', 'Maple Mono', monospace !important;
        }
        
        /* 2. 覆盖 Monaco Editor 的各层级元素字体 */
        .monaco-editor,
        .monaco-editor .view-line,
        .monaco-editor .lines-content,
        .monaco-editor .margin-view-overlays,
        .monaco-editor .view-lines,
        .monaco-editor .cursor,
        .monaco-editor .editor-container,
        .monaco-editor-background,
        .monaco-editor * {
            font-family: 'Maple Mono NF', 'Maple Mono', Consolas, "Courier New", monospace !important;
        }
        
        /* 3. 覆盖 Markdown 预览、大模型输出结果中的代码块、代码行样式 */
        pre, 
        code, 
        pre *, 
        code *,
        kbd, 
        samp, 
        .monospace, 
        [class*="code-"],
        .leading-relaxed.select-text pre,
        .leading-relaxed.select-text code,
        .leading-relaxed.select-text pre *,
        .leading-relaxed.select-text code * {
            font-family: 'Maple Mono NF', 'Maple Mono', Consolas, "Courier New", monospace !important;
        }
`;

const injectionScript = `(() => {
    const prevStyle = document.getElementById('antigravity-custom-font-style');
    if (prevStyle) prevStyle.remove();
    const styleEl = document.createElement('style');
    styleEl.id = 'antigravity-custom-font-style';
    styleEl.textContent = ${JSON.stringify(fontCss)};
    document.head.appendChild(styleEl);
    return "Successfully injected custom code font: Maple Mono NF!";
})();`;

// 3. 执行连接并注入的逻辑
async function run() {
  try {
    const pages = await getTargets();

    for (const page of pages) {
      console.log(`正在注入页面: "${page.title}" (${page.url})`);
      await inject(page.webSocketDebuggerUrl);
    }
    console.log(
      '\n【完成】已成功在所有渲染页面中应用自定义字体 (英文字体: "Anthropic Sans Web Text", 中文字体: "Sarasa UI SC", 代码字体: "Maple Mono NF")！',
    );
    console.log(
      '温馨提示: 请确保您的操作系统中已经安装了 "Anthropic Sans Web Text"、"Sarasa UI SC" 和 "Maple Mono NF" 字体。',
    );
  } catch (err) {
    console.error("注入出错:", err);
    process.exitCode = 1;
  }
}

async function inject(wsUrl) {
    const result = await evaluate(wsUrl, injectionScript);
    console.log(`  -> 结果: ${result}`);
}

module.exports = { fontCss };
if (require.main === module) run();
