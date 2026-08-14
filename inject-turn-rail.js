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

// 2. 注入到 Antigravity 界面中的核心脚本
const injectionScript = `(() => {
    // 清除历史注入实例与监听器，避免冲突
    const prevStyle = document.getElementById('antigravity-turn-rail-style');
    if (prevStyle) prevStyle.remove();
    const prevContainer = document.getElementById('antigravity-turn-rail-root');
    if (prevContainer) prevContainer.remove();

    if (window.__antigravity_rail_observer) {
        window.__antigravity_rail_observer.disconnect();
    }
    if (window.__antigravity_rail_resize_observer) {
        window.__antigravity_rail_resize_observer.disconnect();
    }
    if (window.__antigravity_rail_scroll_handler) {
        const conv = document.querySelector('[data-testid="conversation-view"]');
        if (conv) conv.removeEventListener('scroll', window.__antigravity_rail_scroll_handler);
    }
    if (window.__antigravity_rail_resize_handler) {
        window.removeEventListener('resize', window.__antigravity_rail_resize_handler);
    }

    // 1. 注入 CSS 样式
    const styleEl = document.createElement('style');
    styleEl.id = 'antigravity-turn-rail-style';
    styleEl.textContent = \`
        #antigravity-turn-rail-root {
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            left: 8px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 7px;
            padding: 6px 10px 6px 4px;
            user-select: none;
            pointer-events: auto;
            transition: opacity 0.15s ease;
        }

        .agy-rail-item {
            position: relative;
            display: flex;
            align-items: center;
            height: 12px;
            cursor: pointer;
        }

        /* 1. 基础默认横线：暗淡半透明 */
        .agy-rail-dash {
            width: 10px;
            height: 2px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 1px;
            transition: width 0.16s cubic-bezier(0.25, 1, 0.5, 1), 
                        background-color 0.16s ease, 
                        box-shadow 0.16s ease;
        }

        /* 2. 默认状态下的最新/当前激活横线：微弱柔和 highlight */
        .agy-rail-item.active .agy-rail-dash {
            width: 10px;
            background: rgba(255, 255, 255, 0.55);
            box-shadow: 0 0 3px rgba(255, 255, 255, 0.15);
        }

        /* 3. 悬停波浪动效：当前悬停项（最长最亮） */
        .agy-rail-item.fisheye-0 .agy-rail-dash {
            width: 24px !important;
            background: #ffffff !important;
            box-shadow: 0 0 6px rgba(255, 255, 255, 0.45);
        }

        /* 4. 悬停波浪动效：上下直接相邻项（次长，过渡平滑） */
        .agy-rail-item.fisheye-1 .agy-rail-dash {
            width: 16px !important;
            background: rgba(255, 255, 255, 0.48) !important;
        }

        /* 5. 悬停波浪动效：相隔两项目（微长，边缘柔和收拢） */
        .agy-rail-item.fisheye-2 .agy-rail-dash {
            width: 12px !important;
            background: rgba(255, 255, 255, 0.3) !important;
        }

        /* 悬浮预览卡片 (Tooltip Card) - 紧凑小巧化 */
        .agy-rail-tooltip {
            position: absolute;
            left: calc(100% + 8px);
            top: 50%;
            transform: translateY(-50%) translateX(-4px);
            width: 270px;
            background: rgba(28, 30, 36, 0.96);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 9px;
            padding: 9px 11px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
            pointer-events: none;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.16s cubic-bezier(0.4, 0, 0.2, 1), 
                        transform 0.16s cubic-bezier(0.4, 0, 0.2, 1), 
                        visibility 0.16s;
            z-index: 10000;
        }

        .agy-rail-item.fisheye-0 .agy-rail-tooltip {
            opacity: 1;
            visibility: visible;
            transform: translateY(-50%) translateX(0);
        }

        /* 标题（用户提问摘要） */
        .agy-rail-title {
            font-size: 12px;
            font-weight: 600;
            color: #f8fafc;
            line-height: 1.35;
            margin-bottom: 4px;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            word-break: break-word;
        }

        /* 回复摘要 */
        .agy-rail-preview {
            font-size: 11px;
            color: #94a3b8;
            line-height: 1.45;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
            word-break: break-word;
        }

        /* 跳转目标卡片的聚焦闪烁光效（减淡柔和） */
        @keyframes agyPulseHighlight {
            0% { outline: 1.5px solid rgba(56, 189, 248, 0.6); box-shadow: 0 0 10px rgba(56, 189, 248, 0.2); }
            50% { outline: 1.5px solid rgba(96, 165, 250, 0.8); box-shadow: 0 0 12px rgba(96, 165, 250, 0.3); }
            100% { outline: 1.5px solid transparent; box-shadow: none; }
        }

        .agy-target-highlight {
            animation: agyPulseHighlight 1.5s ease-out forwards !important;
            border-radius: 10px;
        }
    \`;
    document.head.appendChild(styleEl);

    // 2. 创建 UI 容器
    const railContainer = document.createElement('div');
    railContainer.id = 'antigravity-turn-rail-root';

    let turns = [];

    // 原生容器级对齐：直接挂载在主对话面板的左侧外沿，由浏览器 CSS 引擎实现 0ms 零延迟实时跟随
    function ensureMounted() {
        const convView = document.querySelector('[data-testid="conversation-view"]');
        if (!convView) return false;

        const targetContainer = convView.parentElement || convView;
        if (window.getComputedStyle(targetContainer).position === 'static') {
            targetContainer.style.position = 'relative';
        }

        if (railContainer.parentElement !== targetContainer) {
            targetContainer.appendChild(railContainer);
        }
        return true;
    }

    function updatePosition() {
        const mounted = ensureMounted();
        if (!mounted || turns.length === 0) {
            railContainer.style.opacity = '0';
            railContainer.style.pointerEvents = 'none';
            return;
        }

        railContainer.style.opacity = '1';
        railContainer.style.pointerEvents = 'auto';
    }

    // 提取当前对话的所有问答 Turn 数据
    function extractTurns() {
        const userSteps = Array.from(document.querySelectorAll('[data-testid="user-input-step"]'));
        
        turns = userSteps.map((userStep, idx) => {
            const userTextEl = userStep.querySelector('.whitespace-pre-wrap') || userStep;
            let fullText = userTextEl.innerText.trim();
            
            // 提炼第一行或前 40 字作为标题
            let title = fullText.split('\\n')[0].replace(/^[-*•\\d.\\s]+/, '').trim() || fullText.slice(0, 35);
            
            // 查找助手回复节点
            let userArticle = userStep.closest('[role="article"]') || userStep.parentElement;
            let nextNode = userArticle ? userArticle.nextElementSibling : null;
            let assistantText = '';
            
            while (nextNode) {
                if (nextNode.querySelector && nextNode.querySelector('[data-testid="user-input-step"]')) {
                    break;
                }
                const mdEls = nextNode.querySelectorAll ? nextNode.querySelectorAll('.leading-relaxed, [class*="markdown"], p') : [];
                if (mdEls.length > 0) {
                    for (const el of mdEls) {
                        const t = el.innerText.trim();
                        if (t && !t.startsWith('Thought for') && !t.startsWith('Worked for')) {
                            assistantText += (assistantText ? ' ' : '') + t;
                        }
                    }
                } else if (nextNode.innerText) {
                    const t = nextNode.innerText.trim();
                    if (t && !t.startsWith('Thought for') && !t.startsWith('Worked for')) {
                        assistantText += (assistantText ? ' ' : '') + t;
                    }
                }
                if (assistantText.length > 260) break;
                nextNode = nextNode.nextElementSibling;
            }

            return {
                idx: idx + 1,
                title: title,
                fullQuestion: fullText,
                assistantSnippet: assistantText.trim() || '（回复生成中...）',
                element: userStep,
                article: userArticle
            };
        });

        renderRail();
        updateActiveTurn();
    }

    function renderRail() {
        railContainer.innerHTML = '';
        if (turns.length === 0) {
            updatePosition();
            return;
        }

        const allItemEls = [];

        turns.forEach((turn, i) => {
            const itemEl = document.createElement('div');
            itemEl.className = 'agy-rail-item';
            itemEl.setAttribute('data-turn-idx', i);

            itemEl.innerHTML = \`
                <div class="agy-rail-dash"></div>
                <div class="agy-rail-tooltip">
                    <div class="agy-rail-title">\${escapeHtml(turn.title)}</div>
                    <div class="agy-rail-preview">\${escapeHtml(turn.assistantSnippet)}</div>
                </div>
            \`;

            // 悬停波浪过渡动效
            itemEl.addEventListener('mouseenter', () => {
                applyFisheye(i);
            });

            itemEl.addEventListener('click', () => {
                jumpToTurn(turn);
            });

            allItemEls.push(itemEl);
            railContainer.appendChild(itemEl);
        });

        function applyFisheye(centerIdx) {
            allItemEls.forEach((el, idx) => {
                const dist = Math.abs(idx - centerIdx);
                el.classList.remove('fisheye-0', 'fisheye-1', 'fisheye-2');
                if (dist === 0) {
                    el.classList.add('fisheye-0');
                } else if (dist === 1) {
                    el.classList.add('fisheye-1');
                } else if (dist === 2) {
                    el.classList.add('fisheye-2');
                }
            });
        }

        function clearFisheye() {
            allItemEls.forEach(el => {
                el.classList.remove('fisheye-0', 'fisheye-1', 'fisheye-2');
            });
        }

        railContainer.onmouseleave = clearFisheye;

        updatePosition();
    }

    function escapeHtml(str) {
        return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function jumpToTurn(turn) {
        if (!turn || !turn.element) return;
        const target = turn.article || turn.element;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // 触发高亮聚焦动画
        turn.element.classList.remove('agy-target-highlight');
        void turn.element.offsetWidth;
        turn.element.classList.add('agy-target-highlight');
        setTimeout(() => {
            turn.element.classList.remove('agy-target-highlight');
        }, 2000);
    }

    // 根据滚动高度自动切换激活的横线
    function updateActiveTurn() {
        if (turns.length === 0) return;
        const items = railContainer.querySelectorAll('.agy-rail-item');
        if (items.length === 0) return;

        let activeIdx = 0;
        const triggerY = window.innerHeight * 0.4;

        for (let i = 0; i < turns.length; i++) {
            const node = turns[i].article || turns[i].element;
            if (node) {
                const rect = node.getBoundingClientRect();
                if (rect.top <= triggerY) {
                    activeIdx = i;
                }
            }
        }

        items.forEach((item, idx) => {
            if (idx === activeIdx) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    // 绑定滚动监听
    const convView = document.querySelector('[data-testid="conversation-view"]');
    if (convView) {
        window.__antigravity_rail_scroll_handler = () => {
            updateActiveTurn();
        };
        convView.addEventListener('scroll', window.__antigravity_rail_scroll_handler, { passive: true });
    }

    // 窗口尺寸变化
    window.__antigravity_rail_resize_handler = updatePosition;
    window.addEventListener('resize', window.__antigravity_rail_resize_handler);

    // 监听 DOM 树变化与尺寸变化（自动响应新问答、回复生成、拖拽 sidebar 与对话切换）
    const ro = new ResizeObserver(() => {
        ensureMounted();
        updateActiveTurn();
    });
    if (convView) {
        ro.observe(convView);
        if (convView.parentElement) ro.observe(convView.parentElement);
    }
    window.__antigravity_rail_resize_observer = ro;

    let currentCascadeId = convView ? convView.getAttribute('data-cascade-id') : null;
    const observer = new MutationObserver(() => {
        const currentConv = document.querySelector('[data-testid="conversation-view"]');
        const cascadeId = currentConv ? currentConv.getAttribute('data-cascade-id') : null;
        
        if (cascadeId !== currentCascadeId) {
            currentCascadeId = cascadeId;
            extractTurns();
            return;
        }

        const count = document.querySelectorAll('[data-testid="user-input-step"]').length;
        if (count !== turns.length) {
            extractTurns();
        } else {
            updatePosition();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.__antigravity_rail_observer = observer;

    extractTurns();
    return "Successfully injected Antigravity Turn Rail Navigator!";
})();`;

// 3. 执行热注入
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
        console.log('\n【完成】已成功启用对话时间轴导航（位于 Sidebar 右侧居中）！');
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
