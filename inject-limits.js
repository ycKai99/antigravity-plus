const { getTargets, evaluate } = require('./cdp');

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
    if (window.__antigravity_quota_observer) {
        window.__antigravity_quota_observer.disconnect();
    }

    // 1. 注入 CSS 样式
    const styleEl = document.createElement('style');
    styleEl.id = 'antigravity-custom-limits-style';
    styleEl.textContent = \`
        .custom-limits-container {
            display: inline-flex;
            align-items: center;
            gap: 12px;
            margin-left: 8px;
            position: relative;
            font-family: inherit;
            vertical-align: middle;
        }
        
        /* 1. Classic Pill Skin Styles */
        .custom-limits-container .quota-indicator {
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
        .custom-limits-container .quota-indicator:hover {
            background: rgba(255, 255, 255, 0.08);
            border-color: rgba(255, 255, 255, 0.1);
        }
        .custom-limits-container .dot {
            display: inline-block;
            width: 5px;
            height: 5px;
            border-radius: 50%;
            background-color: #94a3b8;
        }
        .custom-limits-container .quota-indicator.safe .dot {
            background-color: #10b981;
            box-shadow: 0 0 6px #10b981;
        }
        .custom-limits-container .quota-indicator.warning .dot {
            background-color: #f59e0b;
            box-shadow: 0 0 6px #f59e0b;
        }
        .custom-limits-container .quota-indicator.danger .dot {
            background-color: #ef4444;
            box-shadow: 0 0 6px #ef4444;
        }
        .custom-limits-container .pill-label {
            display: inline;
            opacity: 0.6;
        }
        .custom-limits-container .pill-value {
            display: inline;
            opacity: 0.95;
            font-weight: 600;
        }
        
        /* ================= LIGHT MODE ADAPTATION ================= */

        /* Classic Pill in Light Mode */
        .vscode-light .custom-limits-container .quota-indicator,
        .theme-light .custom-limits-container .quota-indicator {
            background: rgba(0, 0, 0, 0.04);
            border-color: rgba(0, 0, 0, 0.1);
            color: rgba(0, 0, 0, 0.8);
        }
        .vscode-light .custom-limits-container .quota-indicator:hover,
        .theme-light .custom-limits-container .quota-indicator:hover {
            background: rgba(0, 0, 0, 0.08);
            border-color: rgba(0, 0, 0, 0.15);
        }

        /* Tooltip in Light Mode */
        .vscode-light .custom-limits-tooltip,
        .theme-light .custom-limits-tooltip {
            background: rgba(255, 255, 255, 0.98);
            border-color: rgba(0, 0, 0, 0.08);
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.12);
        }
        .vscode-light .custom-limits-tooltip::after,
        .theme-light .custom-limits-tooltip::after {
            border-color: rgba(255, 255, 255, 0.98) transparent transparent transparent;
        }
        .vscode-light .tooltip-title,
        .theme-light .tooltip-title {
            color: #0f172a;
        }
        .vscode-light .tooltip-divider,
        .theme-light .tooltip-divider {
            background: rgba(0, 0, 0, 0.08);
        }
        .vscode-light .tooltip-row span,
        .theme-light .tooltip-row span {
            color: #334155 !important;
        }
        .vscode-light .tooltip-row .row-reset,
        .theme-light .tooltip-row .row-reset {
            color: #64748b !important;
        }
        .vscode-light .row-bar,
        .theme-light .row-bar {
            background: rgba(0, 0, 0, 0.08);
        }
        
        /* Tooltip & Other Details */
        .custom-limits-tooltip {
            position: fixed;
            inset: auto;
            margin: 0;
            width: 250px;
            background: rgba(20, 20, 30, 0.96);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            padding: 12px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.6), 
                        inset 0 1px 1px rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            z-index: 99999;
            pointer-events: auto;
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
            letter-spacing: 0.02em;
            color: #64748b;
            margin-top: 1px;
        }

        .quota-indicator:active {
            transform: scale(0.98);
        }

        @media (prefers-reduced-transparency: reduce) {
            .custom-limits-tooltip {
                background: #1e293b !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
            }
            .vscode-light .custom-limits-tooltip,
            .theme-light .custom-limits-tooltip {
                background: #ffffff !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
            }
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
            
            // 格式化重置时间辅助函数 (包含精确时间点与相对倒计时)
            function formatResetTime(resetTimeStr, isWeekly = false) {
                if (!resetTimeStr) return '未知';
                const target = new Date(resetTimeStr);
                const now = new Date();
                const diffMs = target - now;
                if (diffMs <= 0) return '即将重置';

                const pad = (n) => String(n).padStart(2, '0');
                const timeStr = \`\${pad(target.getHours())}:\${pad(target.getMinutes())}\`;
                
                if (isWeekly) {
                    const dateStr = \`\${target.getMonth() + 1}月\${target.getDate()}日 \${timeStr}\`;
                    const hoursLeft = Math.floor(diffMs / (1000 * 60 * 60));
                    const daysLeft = Math.floor(hoursLeft / 24);
                    const remainingHours = hoursLeft % 24;
                    let relative = '';
                    if (daysLeft > 0) {
                        relative = remainingHours > 0 ? \`\${daysLeft}天\${remainingHours}小时后\` : \`\${daysLeft}天后\`;
                    } else if (hoursLeft > 0) {
                        relative = \`\${hoursLeft}小时后\`;
                    } else {
                        const mins = Math.max(1, Math.round(diffMs / (1000 * 60)));
                        relative = \`\${mins}分钟后\`;
                    }
                    return \`\${dateStr} 重置 (\${relative})\`;
                } else {
                    const totalMins = Math.round(diffMs / (1000 * 60));
                    const hours = Math.floor(totalMins / 60);
                    const mins = totalMins % 60;
                    let relative = '';
                    if (hours > 0) {
                        relative = mins > 0 ? \`\${hours}小时\${mins}分后\` : \`\${hours}小时后\`;
                    } else if (totalMins > 0) {
                        relative = \`\${totalMins}分钟后\`;
                    } else {
                        return '即将重置';
                    }
                    return \`\${timeStr} 重置 (\${relative})\`;
                }
            }

            const weeklyPill = document.querySelector('.quota-indicator.weekly .pill-value');
            const hourlyPill = document.querySelector('.quota-indicator.hourly .pill-value');
            
            if (weeklyBucket) {
                const pct = Math.round(weeklyBucket.remainingFraction * 100);
                if (weeklyPill) weeklyPill.textContent = \`\${pct}%\`;
                
                const wDetail = document.querySelector('.tooltip-row.weekly .metric-detail');
                const wFill = document.querySelector('.row-fill.weekly');
                const wReset = document.querySelector('.tooltip-row.weekly .row-reset');
                if (wDetail) wDetail.textContent = \`剩余 \${pct}%\`;
                if (wFill) wFill.style.width = \`\${pct}%\`;
                if (wReset) {
                    wReset.textContent = formatResetTime(weeklyBucket.resetTime, true);
                }
                

                const wIndicatorEl = document.querySelector('.quota-indicator.weekly');
                if (wIndicatorEl) {
                    wIndicatorEl.className = 'quota-indicator weekly';
                    if (weeklyBucket.remainingFraction < 0.2) wIndicatorEl.classList.add('danger');
                    else if (weeklyBucket.remainingFraction < 0.5) wIndicatorEl.classList.add('warning');
                    else wIndicatorEl.classList.add('safe');
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
                    hReset.textContent = formatResetTime(hourlyBucket.resetTime, false);
                }
                

                const hIndicatorEl = document.querySelector('.quota-indicator.hourly');
                if (hIndicatorEl) {
                    hIndicatorEl.className = 'quota-indicator hourly';
                    if (hourlyBucket.remainingFraction < 0.2) hIndicatorEl.classList.add('danger');
                    else if (hourlyBucket.remainingFraction < 0.5) hIndicatorEl.classList.add('warning');
                    else hIndicatorEl.classList.add('safe');
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
            <!-- Weekly Indicator -->
            <button type="button" class="quota-indicator weekly safe" aria-label="查看周额度详情" aria-expanded="false">
                <span class="dot"></span>
                <span class="pill-label">Weekly:</span>
                <span class="pill-value">--%</span>
                
            </button>
            
            <!-- Hourly Indicator -->
            <button type="button" class="quota-indicator hourly safe" aria-label="查看五小时额度详情" aria-expanded="false">
                <span class="dot"></span>
                <span class="pill-label">5-Hour:</span>
                <span class="pill-value">--%</span>
                
            </button>
            
            <!-- Tooltip -->
            <div class="custom-limits-tooltip" popover="auto">
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

        const tooltip = container.querySelector('.custom-limits-tooltip');
        const indicators = container.querySelectorAll('.quota-indicator');
        let hideTimer;
        function positionTooltip(indicator) {
            const rect = indicator.getBoundingClientRect();
            tooltip.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 284)) + 'px';
            tooltip.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
        }
        function scheduleHide() {
            hideTimer = setTimeout(() => tooltip.hidePopover(), 150);
        }
        indicators.forEach(indicator => {
            indicator.addEventListener('mouseenter', () => {
                clearTimeout(hideTimer);
                positionTooltip(indicator);
                tooltip.showPopover();
            });
            indicator.addEventListener('mouseleave', scheduleHide);
            indicator.addEventListener('click', event => {
                event.stopPropagation();
                clearTimeout(hideTimer);
                positionTooltip(indicator);
                tooltip.togglePopover();
            });
        });
        tooltip.addEventListener('mouseenter', () => clearTimeout(hideTimer));
        tooltip.addEventListener('mouseleave', scheduleHide);
        tooltip.addEventListener('toggle', () => {
            indicators.forEach(indicator => indicator.setAttribute('aria-expanded', String(tooltip.matches(':popover-open'))));
        });
        agentInputEl.parentNode.insertBefore(container, agentInputEl.nextSibling);
        updateQuotaData();
    }

    // 4. 监听 DOM 树变化，确保标签持久挂载
    if (window.__antigravity_quota_observer) {
        window.__antigravity_quota_observer.disconnect();
    }
    window.__antigravity_quota_observer = new MutationObserver(() => {
        insertLimitsUI();
    });
    window.__antigravity_quota_observer.observe(document.body, { childList: true, subtree: true });

    insertLimitsUI();
    window.__antigravity_quota_interval = setInterval(updateQuotaData, 5000);
    return "Successfully injected limits UI!";
})();`;

// 3. 执行连接并注入的逻辑
async function run() {
    try {
        const pages = await getTargets();

        for (const page of pages) {
            console.log(`正在注入页面: "${page.title}" (${page.url})`);
            await inject(page.webSocketDebuggerUrl);
        }
        console.log('\n【完成】已成功在所有渲染页面中启用限额提示组件！');
    } catch (err) {
        console.error('注入出错:', err);
        process.exitCode = 1;
    }
}

async function inject(wsUrl) {
    const result = await evaluate(wsUrl, injectionScript);
    console.log(`  -> 结果: ${result}`);
}

run();
