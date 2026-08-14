const fs = require("fs");
const path = require("path");

// 1. 根据不同操作系统，自动定位 Antigravity 的用户数据目录和 DevToolsActivePort 文件
function getActivePortPath() {
  const home = process.env.HOME || process.env.USERPROFILE;
  switch (process.platform) {
    case "win32":
      return path.join(
        process.env.APPDATA,
        "Antigravity",
        "DevToolsActivePort",
      );
    case "darwin":
      return path.join(
        home,
        "Library",
        "Application Support",
        "Antigravity",
        "DevToolsActivePort",
      );
    case "linux":
      return path.join(home, ".config", "Antigravity", "DevToolsActivePort");
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

// 2. 将要注入到 Antigravity 界面中的核心 JS 脚本，用以修改代码字体为 Maple Mono NF
const injectionScript = `(() => {
    // 移除历史注入的字体样式，避免冲突
    const prevStyle = document.getElementById('antigravity-custom-font-style');
    if (prevStyle) prevStyle.remove();
    
    // 创建新的样式元素
    const styleEl = document.createElement('style');
    styleEl.id = 'antigravity-custom-font-style';
    styleEl.textContent = \`
        /* 0. 仅将 AI 输出的消息内容区域的中文字体替换为 MiSans */
        .leading-relaxed.select-text,
        .leading-relaxed.select-text p,
        .leading-relaxed.select-text span,
        .leading-relaxed.select-text li,
        .leading-relaxed.select-text blockquote,
        .leading-relaxed.select-text h1,
        .leading-relaxed.select-text h2,
        .leading-relaxed.select-text h3,
        .leading-relaxed.select-text h4 {
            font-family: 'Google Sans', ui-sans-serif, system-ui, -apple-system, sans-serif !important;
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
    \`;
    
    document.head.appendChild(styleEl);
    return "Successfully injected custom code font: Maple Mono NF!";
})();`;

// 3. 执行连接并注入的逻辑
async function run() {
  try {
    const activePortFile = getActivePortPath();
    if (!fs.existsSync(activePortFile)) {
      console.error(
        "未找到 DevToolsActivePort 文件，请确认 Antigravity 2.0 是否正在运行。",
      );
      return;
    }

    const content = fs.readFileSync(activePortFile, "utf8").split("\n");
    const port = content[0].trim();
    console.log(`[Discovered DevTools Port] ${port}`);

    const res = await fetch(`http://127.0.0.1:${port}/json`);
    const targets = await res.json();

    const pages = targets.filter((t) => t.type === "page");
    if (pages.length === 0) {
      console.error("未找到活动渲染窗口！");
      return;
    }

    for (const page of pages) {
      console.log(`正在注入页面: "${page.title}" (${page.url})`);
      await inject(page.webSocketDebuggerUrl);
    }
    console.log(
      '\n【完成】已成功在所有渲染页面中应用自定义字体 (中文字体: "Google Sans", 代码字体: "Maple Mono NF")！',
    );
    console.log(
      '温馨提示: 请确保您的操作系统中已经安装了 "Google Sans" 和 "Maple Mono NF" 字体。',
    );
  } catch (err) {
    console.error("注入出错:", err);
  }
}

function inject(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            expression: injectionScript,
            returnByValue: true,
          },
        }),
      );
    };
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.id === 1) {
        console.log(`  -> 结果: ${data.result.result.value}`);
        ws.close();
        resolve();
      }
    };
    ws.onerror = (err) => {
      reject(err);
    };
  });
}

run();
