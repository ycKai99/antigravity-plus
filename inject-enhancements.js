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
    let report = [];

    // 1. TanStack Router 设置弹窗防死锁守护
    if (!window.__antigravity_settings_guard_installed) {
        window.__antigravity_settings_guard_installed = true;

        document.addEventListener("click", (e) => {
            const btn = e.target && e.target.closest && e.target.closest('[data-testid="settings-button"]');
            if (!btn) return;

            const hasDialog = !!document.querySelector('[role="dialog"]');
            const urlHasSettings = window.location.search.includes("settingsOpen=true");

            // 弹窗实际未打开，但 URL 残留了 settingsOpen=true，判定为死锁状态
            if (!hasDialog && urlHasSettings) {
                const url = new URL(window.location.href);
                url.searchParams.delete("settingsOpen");
                url.searchParams.delete("settingsScreen");
                // 必须严格保留 window.history.state，避免破坏 TanStack Router 的 __TSR_key / __TSR_index
                window.history.replaceState(window.history.state, "", url.toString());
            }
        }, true); // 捕获阶段执行，先于 React 事件触发

        report.push("Settings dialog deadlock guard installed");
    } else {
        report.push("Settings deadlock guard already active");
    }

    // 2. React 外观设置防白屏崩溃保护 (localStorage hook)
    if (!window.__ag_preset_hooked) {
        window.__ag_preset_hooked = true;
        try {
            const ALL_CUSTOM_PRESETS = new Set([
                "high-contrast", "claude-desktop-purewhite", "vintage-deep",
                "chuanban-warm-white", "claude-desktop-official", "absoulutely-chuanban",
                "高对比版", "ClaudeDesktop 净白", "复古深色"
            ]);

            const originalGet = localStorage.getItem.bind(localStorage);
            localStorage.getItem = function(k) {
                const val = originalGet(k);
                if (k === "theme-preset-light" && ALL_CUSTOM_PRESETS.has(val)) {
                    return "Default Light";
                }
                return val;
            };

            const originalSet = localStorage.setItem.bind(localStorage);
            localStorage.setItem = function(k, v) {
                if (k === "theme-preset-light" && ALL_CUSTOM_PRESETS.has(v)) {
                    v = "Default Light";
                }
                originalSet(k, v);
            };

            report.push("React white-screen crash guard installed");
        } catch (e) {
            report.push("React crash guard failed: " + e.message);
        }
    } else {
        report.push("React crash guard already active");
    }

    return report.join(", ");
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
      '\n【完成】已成功注入交互增强与稳定性守护！',
    );
    console.log(
      '包含特性: ① 设置弹窗 TanStack Router 死锁修复；② React 外观设置防白屏保护。',
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
