const fs = require("fs");
const path = require("path");

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

const injectionScript = `(() => {
    // 移除历史主题样式，支持热替换
    const prevStyle = document.getElementById('antigravity-custom-theme-style');
    if (prevStyle) prevStyle.remove();

    const styleEl = document.createElement('style');
    styleEl.id = 'antigravity-custom-theme-style';
    styleEl.textContent = \`
        /* ========================================================
           Antigravity 主题预设 1：高对比版 (High Contrast)
           仅在浅色模式生效，深色模式自动隔离保持官方深色
           ======================================================== */
        body.theme-light {
            --background: #FCFCFB !important;
            --foreground: #1F1E1D !important;
            --sidebar: #F7F5F0 !important;
            --sidebar-secondary: #ECE9E1 !important;
            --sidebar-border: rgba(0, 0, 0, 0.35) !important;
            --border: rgba(0, 0, 0, 0.38) !important;
            --card: #F9F7F2 !important;
            --card-border: rgba(0, 0, 0, 0.35) !important;
            --secondary-foreground: #0A0A0A !important;
        }

        body.theme-light .bg-sidebar {
            background-color: var(--sidebar) !important;
        }

        body.theme-light .bg-border {
            background-color: rgba(0, 0, 0, 0.28) !important;
        }

        body.theme-light a[class*="inline-flex"],
        body.theme-light .bg-sidebar a {
            border-color: rgba(0, 0, 0, 0.32) !important;
        }

        /* 输入框底部模型切换栏与状态图标纯黑墨色化（去除 0.7 模糊灰度滤镜） */
        body.theme-light [id="antigravity.agentSidePanelInputBox"] span,
        body.theme-light [id="antigravity.agentSidePanelInputBox"] button,
        body.theme-light [id="antigravity.agentSidePanelInputBox"] [class*="text-secondary-foreground"] {
            color: #0A0A0A !important;
            opacity: 1 !important;
            font-weight: 500 !important;
        }

        /* 侧栏文字扎实度与微润墨感 (Solid Ink) */
        body.theme-light .bg-sidebar a,
        body.theme-light .bg-sidebar button,
        body.theme-light .bg-sidebar [class*="truncate"],
        body.theme-light .bg-sidebar [class*="text-sm"],
        body.theme-light .bg-sidebar [class*="text-xs"],
        body.theme-light aside a,
        body.theme-light aside button {
            font-weight: 450 !important;
            letter-spacing: -0.012em !important;
            color: #262422 !important;
            text-rendering: optimizeLegibility;
            text-shadow: 0 0 0.2px rgba(38, 36, 34, 0.35);
        }

        body.theme-light [data-testid="conversation-row-sidebar"][data-selected="true"],
        body.theme-light [data-testid="conversation-row-sidebar"][data-selected="true"] span,
        body.theme-light .bg-sidebar [data-active="true"],
        body.theme-light .bg-sidebar [data-active="true"] span,
        body.theme-light .bg-sidebar [aria-selected="true"] {
            font-weight: 520 !important;
            color: #0A0A0A !important;
            text-shadow: 0 0 0.25px rgba(10, 10, 10, 0.4);
        }

        /* 字体体系：英文 Anthropic Sans，中文 Sarasa UI SC */
        body, button, input, textarea, select,
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

        /* 等宽代码字体体系：Maple Mono NF */
        :root {
            --monaco-monospace-font: 'Maple Mono NF', 'Maple Mono', monospace !important;
            --code-font-family: 'Maple Mono NF', 'Maple Mono', monospace !important;
            --vscode-editor-font-family: 'Maple Mono NF', 'Maple Mono', monospace !important;
        }
        .monaco-editor,
        .monaco-editor * {
            font-family: 'Maple Mono NF', 'Maple Mono', Consolas, "Courier New", monospace !important;
        }
        pre, code, pre *, code *, kbd, samp, .monospace, [class*="code-"],
        .leading-relaxed.select-text pre,
        .leading-relaxed.select-text code,
        .leading-relaxed.select-text pre *,
        .leading-relaxed.select-text code * {
            font-family: 'Maple Mono NF', 'Maple Mono', Consolas, "Courier New", monospace !important;
        }
    \`;

    document.head.appendChild(styleEl);
    return "Successfully injected theme: High Contrast (高对比版)!";
})();`;

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
      '\n【完成】已成功应用主题：高对比版 (High Contrast)！',
    );
    console.log(
      '视觉特征: 暖燕麦色侧栏 + 纯白主区 + 纯黑墨色字，深色模式自动隔离保护。',
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
