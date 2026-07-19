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
        
        /* Settings Button & Dropdown */
        .limits-settings-btn {
            background: none;
            border: none;
            color: rgba(255, 255, 255, 0.4);
            font-size: 11px;
            cursor: pointer;
            padding: 2px;
            margin-left: 2px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            transition: color 0.15s ease, transform 0.3s ease;
        }
        .limits-settings-btn:hover {
            color: rgba(255, 255, 255, 0.85);
            transform: rotate(45deg);
        }
        .limits-settings-dropdown {
            position: absolute;
            bottom: 30px;
            right: 0;
            background: rgba(20, 20, 30, 0.98);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 6px;
            padding: 4px;
            box-shadow: 0 8px 20px rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            display: none;
            flex-direction: column;
            z-index: 100000;
            min-width: 100px;
        }
        .limits-settings-dropdown.show {
            display: flex;
        }
        .dropdown-item {
            padding: 5px 10px;
            font-size: 10px;
            color: rgba(255, 255, 255, 0.7);
            cursor: pointer;
            border-radius: 4px;
            transition: all 0.15s ease;
            white-space: nowrap;
            text-align: left;
        }
        .dropdown-item:hover {
            background: rgba(255, 255, 255, 0.08);
            color: #ffffff;
        }
        .dropdown-item.active {
            background: rgba(255, 255, 255, 0.12);
            color: #10b981;
            font-weight: 600;
        }

        /* 1. Classic Pill Skin Styles */
        .custom-limits-container.skin-classic .quota-indicator {
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
        .custom-limits-container.skin-classic .quota-indicator:hover {
            background: rgba(255, 255, 255, 0.08);
            border-color: rgba(255, 255, 255, 0.1);
        }
        .custom-limits-container.skin-classic .dot {
            display: inline-block;
            width: 5px;
            height: 5px;
            border-radius: 50%;
            background-color: #94a3b8;
        }
        .custom-limits-container.skin-classic .quota-indicator.safe .dot {
            background-color: #10b981;
            box-shadow: 0 0 6px #10b981;
        }
        .custom-limits-container.skin-classic .quota-indicator.warning .dot {
            background-color: #f59e0b;
            box-shadow: 0 0 6px #f59e0b;
        }
        .custom-limits-container.skin-classic .quota-indicator.danger .dot {
            background-color: #ef4444;
            box-shadow: 0 0 6px #ef4444;
        }
        .custom-limits-container.skin-classic .pill-label {
            display: inline;
            opacity: 0.6;
        }
        .custom-limits-container.skin-classic .pill-value {
            display: inline;
            opacity: 0.95;
            font-weight: 600;
        }
        
        /* Hide battery parts in classic skin */
        .custom-limits-container.skin-classic .battery-label,
        .custom-limits-container.skin-classic .battery-body {
            display: none;
        }
        
        /* 2. Battery Layout Base (For Modern, Minimal, Compact) */
        .custom-limits-container:not(.skin-classic) .dot,
        .custom-limits-container:not(.skin-classic) .pill-label,
        .custom-limits-container:not(.skin-classic) .pill-value {
            display: none;
        }
        .custom-limits-container:not(.skin-classic) .quota-indicator {
            display: inline-flex;
            align-items: center;
            gap: 5px;
        }
        .custom-limits-container:not(.skin-classic) .battery-body {
            position: relative;
            width: 40px;
            height: 18px;
            border-radius: 5px;
            padding: 1.5px;
            box-sizing: border-box;
            display: inline-flex;
            align-items: center;
            transition: all 0.2s ease;
            overflow: visible; /* 确保极耳不被剪切 */
        }
        .custom-limits-container:not(.skin-classic) .battery-body::after {
            content: '';
            position: absolute;
            top: 50%;
            left: 41px; /* 默认现代与极简版极耳位置 */
            width: 2.6px;
            height: 6px;
            transform: translateY(-50%);
            clip-path: ellipse(100% 50% at -15% 50%); /* 穹顶状极耳 */
            transition: all 0.2s ease;
        }
        .custom-limits-container:not(.skin-classic) .battery-fill {
            height: 100%;
            border-radius: 2.5px;
            transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1), background 0.3s ease;
        }
        .custom-limits-container:not(.skin-classic) .battery-text {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 8px;
            font-weight: 700;
            line-height: 1;
            pointer-events: none;
            white-space: nowrap;
            z-index: 1;
        }
        .custom-limits-container:not(.skin-classic) .battery-label {
            font-size: 9.5px;
            font-weight: 600;
            color: rgba(255, 255, 255, 0.5);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            transition: color 0.15s ease;
        }
        .custom-limits-container:not(.skin-classic) .quota-indicator:hover .battery-label {
            color: rgba(255, 255, 255, 0.85);
        }
        
        .quota-indicator:active {
            transform: scale(0.96);
            transition: transform 80ms ease-out;
        }

        /* SKIN: Compact (White Battery, Dark Text, No %, matching test.html) */
        .custom-limits-container.skin-compact .quota-indicator {
            gap: 6px;
        }
        .custom-limits-container.skin-compact .battery-body {
            width: 27px; /* 105px * 0.26 */
            height: 14px; /* 54px * 0.26 */
            border-radius: 5px; /* 20px * 0.26 = 5.2px */
            background: rgba(255, 255, 255, 0.12);
            border: 1px solid rgba(255, 255, 255, 0.5); /* 白色边框 */
            padding: 1px;
        }
        .custom-limits-container.skin-compact .battery-body::after {
            left: 28.2px; /* 110px * 0.26 = 28.6px, gap: 1.2px */
            width: 2px; /* 8px * 0.26 = 2px */
            height: 5px; /* 18px * 0.26 = 4.6px */
            background: #ffffff;
            z-index: 2;
        }
        .custom-limits-container.skin-compact .battery-text {
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: 8.5px; /* 32px * 0.26 = 8.3px */
            font-weight: 700;
            line-height: 1;
            font-variant-numeric: tabular-nums;
            letter-spacing: 0.1px; /* positive tracking for tiny text legibility */
            color: #ffffff;
            mix-blend-mode: difference;
            z-index: 3;
        }
        .custom-limits-container.skin-compact .battery-fill {
            background: #ffffff;
            border-radius: 3px;
        }
        .custom-limits-container.skin-compact .quota-indicator:hover .battery-body {
            background: rgba(255, 255, 255, 0.2);
        }
        
        /* Danger State for Compact */
        .custom-limits-container.skin-compact .quota-indicator.danger .battery-fill {
            background: #ef4444;
        }
        .custom-limits-container.skin-compact .quota-indicator.danger .battery-body::after {
            background: #ef4444;
        }
        .custom-limits-container.skin-compact .quota-indicator.danger .battery-body {
            animation: battery-low-pulse-compact 1.5s infinite alternate;
        }

        @keyframes battery-low-pulse-compact {
            0% { border-color: rgba(239, 68, 68, 0.4); }
            100% { border-color: rgba(239, 68, 68, 1); }
        }
        
        @media (prefers-reduced-motion: reduce) {
            .custom-limits-container.skin-compact .quota-indicator.danger .battery-body {
                animation: none;
            }
        }

        /* ================= LIGHT MODE ADAPTATION ================= */

        /* Classic Pill in Light Mode */
        .vscode-light .custom-limits-container.skin-classic .quota-indicator,
        .theme-light .custom-limits-container.skin-classic .quota-indicator {
            background: rgba(0, 0, 0, 0.04);
            border-color: rgba(0, 0, 0, 0.1);
            color: rgba(0, 0, 0, 0.8);
        }
        .vscode-light .custom-limits-container.skin-classic .quota-indicator:hover,
        .theme-light .custom-limits-container.skin-classic .quota-indicator:hover {
            background: rgba(0, 0, 0, 0.08);
            border-color: rgba(0, 0, 0, 0.15);
        }

        /* Compact Battery in Light Mode */
        .vscode-light .custom-limits-container.skin-compact .battery-body,
        .theme-light .custom-limits-container.skin-compact .battery-body {
            background: rgba(0, 0, 0, 0.06);
            border-color: rgba(0, 0, 0, 0.35);
        }
        .vscode-light .custom-limits-container.skin-compact .battery-body::after,
        .theme-light .custom-limits-container.skin-compact .battery-body::after {
            background: #333333; /* 浅色模式下为深色极耳 */
        }
        .vscode-light .custom-limits-container.skin-compact .battery-fill,
        .theme-light .custom-limits-container.skin-compact .battery-fill {
            background: #333333; /* 浅色模式下为深色电量 */
        }
        .vscode-light .custom-limits-container.skin-compact .quota-indicator:hover .battery-body,
        .theme-light .custom-limits-container.skin-compact .quota-indicator:hover .battery-body {
            background: rgba(0, 0, 0, 0.12);
        }
        
        /* Battery labels in Light Mode */
        .vscode-light .custom-limits-container:not(.skin-classic) .battery-label,
        .theme-light .custom-limits-container:not(.skin-classic) .battery-label {
            color: rgba(0, 0, 0, 0.5);
        }
        .vscode-light .custom-limits-container:not(.skin-classic) .quota-indicator:hover .battery-label,
        .theme-light .custom-limits-container:not(.skin-classic) .quota-indicator:hover .battery-label {
            color: rgba(0, 0, 0, 0.85);
        }

        /* Danger state in Light Mode */
        .vscode-light .custom-limits-container.skin-compact .quota-indicator.danger .battery-fill,
        .theme-light .custom-limits-container.skin-compact .quota-indicator.danger .battery-fill {
            background: #ef4444; /* 保持红色 */
        }
        .vscode-light .custom-limits-container.skin-compact .quota-indicator.danger .battery-body::after,
        .theme-light .custom-limits-container.skin-compact .quota-indicator.danger .battery-body::after {
            background: #ef4444;
        }

        /* Settings button in Light Mode */
        .vscode-light .limits-settings-btn,
        .theme-light .limits-settings-btn {
            color: rgba(0, 0, 0, 0.4);
        }
        .vscode-light .limits-settings-btn:hover,
        .theme-light .limits-settings-btn:hover {
            color: rgba(0, 0, 0, 0.8);
        }

        /* Settings Dropdown in Light Mode */
        .vscode-light .limits-settings-dropdown,
        .theme-light .limits-settings-dropdown {
            background: rgba(248, 250, 252, 0.85); /* Frosted glass material */
            backdrop-filter: blur(16px) saturate(140%);
            -webkit-backdrop-filter: blur(16px) saturate(140%);
            border-color: rgba(0, 0, 0, 0.08);
            box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08);
        }
        .vscode-light .dropdown-item,
        .theme-light .dropdown-item {
            color: rgba(0, 0, 0, 0.7);
        }
        .vscode-light .dropdown-item:hover,
        .theme-light .dropdown-item:hover {
            background: rgba(0, 0, 0, 0.04);
            color: #000000;
        }
        .vscode-light .dropdown-item.active,
        .theme-light .dropdown-item.active {
            background: rgba(0, 0, 0, 0.06);
            color: #10b981;
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
            letter-spacing: 0.02em;
            color: #64748b;
            margin-top: 1px;
        }

        .quota-indicator:active {
            transform: scale(0.98);
        }

        @media (prefers-reduced-transparency: reduce) {
            .limits-settings-dropdown,
            .custom-limits-tooltip {
                background: #1e293b !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
            }
            .vscode-light .limits-settings-dropdown,
            .theme-light .limits-settings-dropdown,
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
            
            // 获取当前皮肤类型
            const container = document.querySelector('.custom-limits-container');
            const isCompact = container && container.classList.contains('skin-compact');

            const weeklyPill = document.querySelector('.quota-indicator.weekly .pill-value');
            const hourlyPill = document.querySelector('.quota-indicator.hourly .pill-value');
            const weeklyText = document.querySelector('.quota-indicator.weekly .battery-text');
            const hourlyText = document.querySelector('.quota-indicator.hourly .battery-text');
            
            if (weeklyBucket) {
                const pct = Math.round(weeklyBucket.remainingFraction * 100);
                if (weeklyPill) weeklyPill.textContent = \`\${pct}%\`;
                if (weeklyText) weeklyText.textContent = isCompact ? \`\${pct}\` : \`\${pct}%\`;
                
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
                
                // 更新电池/胶囊宽度和状态
                const wBatteryFill = document.querySelector('.quota-indicator.weekly .battery-fill');
                if (wBatteryFill) wBatteryFill.style.width = \`\${pct}%\`;

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
                if (hourlyText) hourlyText.textContent = isCompact ? \`\${pct}\` : \`\${pct}%\`;
                
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
                
                // 更新电池/胶囊宽度和状态
                const hBatteryFill = document.querySelector('.quota-indicator.hourly .battery-fill');
                if (hBatteryFill) hBatteryFill.style.width = \`\${pct}%\`;

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
        
        // 读取保存的皮肤，默认为 compact，并验证是否为允许的值
        let savedSkin = localStorage.getItem('antigravity_quota_skin') || 'compact';
        if (savedSkin !== 'classic' && savedSkin !== 'compact') savedSkin = 'compact';
        localStorage.setItem('antigravity_quota_skin', savedSkin);
        
        container.className = \`custom-limits-container skin-\${savedSkin}\`;
        
        container.innerHTML = \`
            <!-- Weekly Indicator -->
            <div class="quota-indicator weekly safe">
                <span class="dot"></span>
                <span class="pill-label">Weekly:</span>
                <span class="pill-value">--%</span>
                
                <span class="battery-label">W</span>
                <div class="battery-body">
                    <div class="battery-fill weekly-fill" style="width: 0%"></div>
                    <span class="battery-text weekly-text">--%</span>
                </div>
            </div>
            
            <!-- Hourly Indicator -->
            <div class="quota-indicator hourly safe">
                <span class="dot"></span>
                <span class="pill-label">5-Hour:</span>
                <span class="pill-value">--%</span>
                
                <span class="battery-label">5H</span>
                <div class="battery-body">
                    <div class="battery-fill hourly-fill" style="width: 0%"></div>
                    <span class="battery-text hourly-text">--%</span>
                </div>
            </div>
            
            <!-- Settings Button -->
            <button class="limits-settings-btn" title="切换皮肤">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" style="width: 12px; height: 12px;">
                    <path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd" />
                </svg>
            </button>
            
            <!-- Settings Dropdown -->
            <div class="limits-settings-dropdown">
                <div class="dropdown-item" data-skin="classic">经典胶囊</div>
                <div class="dropdown-item" data-skin="compact">数字电池</div>
            </div>
            
            <!-- Tooltip -->
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

        // 绑定 settings 点击事件
        const settingsBtn = container.querySelector('.limits-settings-btn');
        const dropdown = container.querySelector('.limits-settings-dropdown');
        
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('show');
            
            // 更新 active 项
            const activeSkin = localStorage.getItem('antigravity_quota_skin') || 'compact';
            dropdown.querySelectorAll('.dropdown-item').forEach(item => {
                if (item.getAttribute('data-skin') === activeSkin) {
                    item.classList.add('active');
                } else {
                    item.classList.remove('active');
                }
            });
        });
        
        dropdown.querySelectorAll('.dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const skin = item.getAttribute('data-skin');
                localStorage.setItem('antigravity_quota_skin', skin);
                
                // 切换样式类名
                container.className = \`custom-limits-container skin-\${skin}\`;
                dropdown.classList.remove('show');
                updateQuotaData();
            });
        });

        agentInputEl.parentNode.insertBefore(container, agentInputEl.nextSibling);
        updateQuotaData();
    }

    // 4. 监听 DOM 树变化，确保标签持久挂载
    const observer = new MutationObserver(() => {
        insertLimitsUI();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // 全局点击关闭下拉菜单
    document.addEventListener('click', (e) => {
        const dropdown = document.querySelector('.limits-settings-dropdown');
        const btn = document.querySelector('.limits-settings-btn');
        if (dropdown && btn && !btn.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.remove('show');
        }
    });

    insertLimitsUI();
    window.__antigravity_quota_interval = setInterval(updateQuotaData, 5000);
    return "Successfully injected limits UI with Skin Manager!";
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
        console.log('\n【完成】已成功在所有渲染页面中启用限额提示组件！');
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
