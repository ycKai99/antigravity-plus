const fs = require('fs');
const path = require('path');

// 1. 根据不同操作系统，自动定位 Antigravity 的用户数据目录和 DevToolsActivePort 文件
function getActivePortPath() {
    const home = process.env.HOME || process.env.USERPROFILE;
    switch (process.platform) {
        case 'win32':
            return path.join(process.env.APPDATA, 'Antigravity', 'DevToolsActivePort');
        case 'darwin':
            return path.join(home, 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort');
        case 'linux':
            return path.join(home, '.config', 'Antigravity', 'DevToolsActivePort');
        default:
            throw new Error(`Unsupported platform: ${process.platform}`);
    }
}

// 2. 将要注入到 Antigravity 界面中的核心 JS 脚本
const injectionScript = `(() => {
    // 移除历史注入，避免冲突
    const prevStyle = document.getElementById('antigravity-custom-limits-style');
    if (prevStyle) prevStyle.remove();
    
    const prevContainers = document.querySelectorAll('.custom-limits-container');
    prevContainers.forEach(c => c.remove());
    
    if (window.__antigravity_quota_interval) {
        clearInterval(window.__antigravity_quota_interval);
    }

    // 1. 注入 CSS 样式（玻璃拟态与悬浮动画）
    const styleEl = document.createElement('style');
    styleEl.id = 'antigravity-custom-limits-style';
    styleEl.textContent = \`
        .custom-limits-container {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            margin-left: 6px;
            position: relative;
            font-family: inherit;
            vertical-align: middle;
        }
        .custom-limit-pill {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 6px;
            padding: 2px 7px;
            font-size: 10.5px;
            font-weight: 500;
            color: rgba(255, 255, 255, 0.85);
            cursor: pointer;
            transition: all 0.15s ease;
            user-select: none;
            height: 22px;
            line-height: 1;
        }
        .custom-limit-pill:hover {
            background: rgba(255, 255, 255, 0.08);
            border-color: rgba(255, 255, 255, 0.1);
        }
        .custom-limit-pill .dot {
            width: 5px;
            height: 5px;
            border-radius: 50%;
            background-color: #94a3b8;
        }
        
        .custom-limit-pill.safe .dot {
            background-color: #10b981;
            box-shadow: 0 0 6px #10b981;
        }
        .custom-limit-pill.warning .dot {
            background-color: #f59e0b;
            box-shadow: 0 0 6px #f59e0b;
        }
        .custom-limit-pill.danger .dot {
            background-color: #ef4444;
            box-shadow: 0 0 6px #ef4444;
        }
        
        .custom-limit-pill .label {
            opacity: 0.6;
        }
        .custom-limit-pill .value {
            opacity: 0.95;
            font-weight: 600;
        }
        
        .custom-limits-tooltip {
            position: absolute;
            bottom: 30px;
            left: 0;
            width: 250px;
            background: rgba(20, 20, 30, 0.96);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            padding: 12px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.6), 
                        inset 0 1px 1px rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            opacity: 0;
            visibility: hidden;
            transform: translateY(6px);
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            z-index: 99999;
            pointer-events: none;
            text-align: left;
        }
        .custom-limits-tooltip::after {
            content: '';
            position: absolute;
            top: 100%;
            left: 20px;
            border-width: 5px;
            border-style: solid;
            border-color: rgba(20, 20, 30, 0.96) transparent transparent transparent;
        }
        .custom-limits-container:hover .custom-limits-tooltip {
            opacity: 1;
            visibility: visible;
            transform: translateY(0);
        }
        .tooltip-title {
            font-size: 11.5px;
            font-weight: 600;
            margin-bottom: 6px;
            color: #f8fafc;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .tooltip-divider {
            height: 1px;
            background: rgba(255, 255, 255, 0.08);
            margin: 6px 0;
        }
        .tooltip-row {
            display: flex;
            flex-direction: column;
            gap: 3px;
        }
        .row-info {
            display: flex;
            justify-content: space-between;
            font-size: 10.5px;
        }
        .row-bar {
            height: 3px;
            background: rgba(255, 255, 255, 0.08);
            border-radius: 99px;
            overflow: hidden;
        }
        .row-fill {
            height: 100%;
            border-radius: 99px;
            transition: width 0.3s ease;
        }
        .row-fill.weekly {
            background: linear-gradient(90deg, #d97706, #fbbf24);
        }
        .row-fill.hourly {
            background: linear-gradient(90deg, #059669, #10b981);
        }
        .row-reset {
            font-size: 9.5px;
            color: #64748b;
            margin-top: 1px;
        }
    \`;
    document.head.appendChild(styleEl);

    // 获取当前的选择模型按钮（不依赖固定文本，支持 Gemini/Claude/GPT 切换）
    function getModelButton() {
        return document.querySelector('button[aria-label*="Select model"]') || 
               Array.from(document.querySelectorAll('button')).find(
                   b => b.textContent && (
                       b.textContent.includes('Gemini') || 
                       b.textContent.includes('Claude') || 
                       b.textContent.includes('GPT') || 
                       b.textContent.includes('Sonnet') || 
                       b.textContent.includes('Opus')
                   )
               );
    }

    // 2. 定期向后台请求真实额度数据 (连接 gRPC-web)
    async function updateQuotaData() {
        try {
            const csrfToken = window.__APP_CONFIG__.csrfToken;
            const body = new Uint8Array([0, 0, 0, 0, 2, 123, 125]); // gRPC 封装的空包
            const r = await fetch('/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary', {
                method: 'POST',
                headers: {
                    'content-type': 'application/grpc-web+json',
                    'x-codeium-csrf-token': csrfToken,
                    'x-grpc-web': '1',
                    'x-user-agent': 'CONNECT_ES_USER_AGENT'
                },
                body: body
            });
            const buf = await r.arrayBuffer();
            const bytes = new Uint8Array(buf);
            if (bytes.length < 5) return;
            const len = (bytes[1] << 24) | (bytes[2] << 16) | (bytes[3] << 8) | bytes[4];
            const jsonBytes = bytes.slice(5, 5 + len);
            const jsonText = new TextDecoder().decode(jsonBytes);
            const data = JSON.parse(jsonText);
            
            // 获取当前所选模型的文本，决定查询 Gemini Models 还是 Claude/GPT Models 组
            const modelBtn = getModelButton();
            const modelText = modelBtn ? modelBtn.textContent : '';
            const isThirdParty = modelText.includes('Claude') || modelText.includes('GPT') || modelText.includes('Opus') || modelText.includes('Sonnet');
            const targetGroupDisplayName = isThirdParty ? 'Claude and GPT models' : 'Gemini Models';
            
            const group = data.response.groups.find(g => g.displayName === targetGroupDisplayName) || data.response.groups[0];
            if (!group) return;
            
            const weeklyBucket = group.buckets.find(b => b.window === 'weekly');
            const hourlyBucket = group.buckets.find(b => b.window === '5h');
            
            const weeklyPill = document.querySelector('.custom-limit-pill.weekly .value');
            const hourlyPill = document.querySelector('.custom-limit-pill.hourly .value');
            
            if (weeklyBucket) {
                const pct = Math.round(weeklyBucket.remainingFraction * 100);
                if (weeklyPill) weeklyPill.textContent = \`\${pct}%\`;
                const wDetail = document.querySelector('.tooltip-row.weekly .metric-detail');
                const wFill = document.querySelector('.row-fill.weekly');
                const wReset = document.querySelector('.tooltip-row.weekly .row-reset');
                if (wDetail) wDetail.textContent = \`剩余 \${pct}%\`;
                if (wFill) wFill.style.width = \`\${pct}%\`;
                if (wReset) {
                    const hoursLeft = Math.round((new Date(weeklyBucket.resetTime) - Date.now()) / (1000 * 60 * 60));
                    if (hoursLeft > 24) {
                        wReset.textContent = \`\${Math.floor(hoursLeft/24)}天\${hoursLeft%24}小时后重置\`;
                    } else if (hoursLeft > 0) {
                        wReset.textContent = \`\${hoursLeft}小时后重置\`;
                    } else {
                        wReset.textContent = \`即将重置\`;
                    }
                }
                
                const wPillEl = document.querySelector('.custom-limit-pill.weekly');
                if (wPillEl) {
                    wPillEl.className = 'custom-limit-pill weekly';
                    if (weeklyBucket.remainingFraction < 0.2) wPillEl.classList.add('danger');
                    else if (weeklyBucket.remainingFraction < 0.5) wPillEl.classList.add('warning');
                    else wPillEl.classList.add('safe');
                }
            }
            
            if (hourlyBucket) {
                const pct = Math.round(hourlyBucket.remainingFraction * 100);
                if (hourlyPill) hourlyPill.textContent = \`\${pct}%\`;
                const hDetail = document.querySelector('.tooltip-row.hourly .metric-detail');
                const hFill = document.querySelector('.row-fill.hourly');
                const hReset = document.querySelector('.tooltip-row.hourly .row-reset');
                if (hDetail) hDetail.textContent = \`剩余 \${pct}%\`;
                if (hFill) hFill.style.width = \`\${pct}%\`;
                if (hReset) {
                    const minutesLeft = Math.round((new Date(hourlyBucket.resetTime) - Date.now()) / (1000 * 60));
                    if (minutesLeft > 60) {
                        hReset.textContent = \`\${Math.floor(minutesLeft/60)}小时\${minutesLeft%60}分钟后重置\`;
                    } else if (minutesLeft > 0) {
                        hReset.textContent = \`\${minutesLeft}分钟后重置\`;
                    } else {
                        hReset.textContent = \`即将重置\`;
                    }
                }
                
                const hPillEl = document.querySelector('.custom-limit-pill.hourly');
                if (hPillEl) {
                    hPillEl.className = 'custom-limit-pill hourly';
                    if (hourlyBucket.remainingFraction < 0.2) hPillEl.classList.add('danger');
                    else if (hourlyBucket.remainingFraction < 0.5) hPillEl.classList.add('warning');
                    else hPillEl.classList.add('safe');
                }
            }
        } catch (e) {
            console.error('Error updating quota:', e);
        }
    }

    // 3. 寻找正确的位置并插入标签
    function insertLimitsUI() {
        const modelBtn = getModelButton();
        if (!modelBtn) return;
        
        const agentInputEl = modelBtn.closest('.no-focus-agent-input');
        if (!agentInputEl || !agentInputEl.parentNode) return;

        const sibling = agentInputEl.nextElementSibling;
        if (sibling && sibling.classList.contains('custom-limits-container')) return;

        // 清理所有可能残留的标签
        const prevContainers = document.querySelectorAll('.custom-limits-container');
        prevContainers.forEach(c => c.remove());

        const container = document.createElement('div');
        container.className = 'custom-limits-container';
        container.innerHTML = \`
            <div class="custom-limit-pill weekly safe">
                <span class="dot"></span>
                <span class="label">Weekly:</span>
                <span class="value">--%</span>
            </div>
            <div class="custom-limit-pill hourly safe">
                <span class="dot"></span>
                <span class="label">5-Hour:</span>
                <span class="value">--%</span>
            </div>
            <div class="custom-limits-tooltip">
                <div class="tooltip-title">
                    <span>额度使用详情</span>
                    <span style="color: #10b981; font-size: 9.5px;">正常</span>
                </div>
                <div class="tooltip-row weekly">
                    <div class="row-info">
                        <span style="color: #cbd5e1;">Weekly Limit</span>
                        <span class="metric-detail" style="color: #94a3b8;">剩余 --%</span>
                    </div>
                    <div class="row-bar">
                        <div class="row-fill weekly" style="width: 0%"></div>
                    </div>
                    <div class="row-reset">计算中...</div>
                </div>
                <div class="tooltip-divider"></div>
                <div class="tooltip-row hourly">
                    <div class="row-info">
                        <span style="color: #cbd5e1;">5-Hour Limit</span>
                        <span class="metric-detail" style="color: #94a3b8;">剩余 --%</span>
                    </div>
                    <div class="row-bar">
                        <div class="row-fill hourly" style="width: 0%"></div>
                    </div>
                    <div class="row-reset">计算中...</div>
                </div>
            </div>
        \`;

        agentInputEl.parentNode.insertBefore(container, agentInputEl.nextSibling);
        updateQuotaData();
    }

    // 4. 监听 DOM 树变化，确保标签持久挂载
    const observer = new MutationObserver(() => {
        insertLimitsUI();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    insertLimitsUI();
    window.__antigravity_quota_interval = setInterval(updateQuotaData, 5000);
    return "Successfully injected limits UI!";
})();`;

// 3. 执行连接并注入的逻辑
async function run() {
    try {
        const activePortFile = getActivePortPath();
        if (!fs.existsSync(activePortFile)) {
            console.error('未找到 DevToolsActivePort 文件，请确认 Antigravity 2.0 是否正在运行。');
            return;
        }
        
        const content = fs.readFileSync(activePortFile, 'utf8').split('\n');
        const port = content[0].trim();
        console.log(`[Discovered DevTools Port] ${port}`);
        
        const res = await fetch(`http://127.0.0.1:${port}/json`);
        const targets = await res.json();
        
        const pages = targets.filter(t => t.type === 'page');
        if (pages.length === 0) {
            console.error('未找到活动渲染窗口！');
            return;
        }
        
        for (const page of pages) {
            console.log(`正在注入页面: "${page.title}" (${page.url})`);
            await inject(page.webSocketDebuggerUrl);
        }
        console.log('\\n【完成】已成功在所有渲染页面中启用限额提示组件！');
    } catch (err) {
        console.error('注入出错:', err);
    }
}

function inject(wsUrl) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        ws.onopen = () => {
            ws.send(JSON.stringify({
                id: 1,
                method: 'Runtime.evaluate',
                params: {
                    expression: injectionScript,
                    returnByValue: true
                }
            }));
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
