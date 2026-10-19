const fs = require('fs');
const path = require('path');
const http = require('http');

const API_PORT = 9527;

// ==========================================
// 1. 本地 Node.js 代理服务 (用于读写本地技能文件)
// ==========================================

function getGlobalRoot() {
    const home = process.env.USERPROFILE || process.env.HOME;
    return path.join(home, '.gemini', 'config');
}

function parseSkillFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const yamlRegex = /^---\r?\n([\s\S]+?)\r?\n---/;
        const match = content.match(yamlRegex);
        let name = path.basename(path.dirname(filePath));
        let description = '';
        let body = content;

        if (match) {
            const yamlStr = match[1];
            body = content.replace(match[0], '').trim();
            
            const nameMatch = yamlStr.match(/name:\s*(.+)/);
            const descMatch = yamlStr.match(/description:\s*(.+)/);
            if (nameMatch) name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
            if (descMatch) description = descMatch[1].trim().replace(/^['"]|['"]$/g, '');
        }
        return { name, description, body };
    } catch (e) {
        console.error(`解析技能失败: ${filePath}`, e);
        return null;
    }
}

function scanSkillsDir(dirPath) {
    const skills = [];
    if (!fs.existsSync(dirPath)) return skills;
    const items = fs.readdirSync(dirPath);
    for (const item of items) {
        const itemPath = path.join(dirPath, item);
        if (fs.statSync(itemPath).isDirectory()) {
            const skillMdPath = path.join(itemPath, 'SKILL.md');
            if (fs.existsSync(skillMdPath)) {
                const parsed = parseSkillFile(skillMdPath);
                if (parsed) {
                    skills.push({
                        id: item,
                        displayName: parsed.name,
                        description: parsed.description,
                        body: parsed.body,
                        path: skillMdPath
                    });
                }
            }
        }
    }
    return skills;
}

function handleGetSkills(workspacePath) {
    const globalRoot = getGlobalRoot();
    const globalSkillsDir = path.join(globalRoot, 'skills');
    const globalSkills = scanSkillsDir(globalSkillsDir).map(s => ({ ...s, scope: 'global' }));

    let workspaceSkills = [];
    if (workspacePath && fs.existsSync(workspacePath)) {
        const wsSkillsDir = path.join(workspacePath, '.agents', 'skills');
        workspaceSkills = scanSkillsDir(wsSkillsDir).map(s => ({ ...s, scope: 'workspace' }));
    }

    let globalExclude = [];
    const globalJsonPath = path.join(globalRoot, 'skills.json');
    if (fs.existsSync(globalJsonPath)) {
        try {
            const config = JSON.parse(fs.readFileSync(globalJsonPath, 'utf8'));
            if (config.exclude) globalExclude = config.exclude;
        } catch (e) {}
    }

    let wsExclude = [];
    if (workspacePath && fs.existsSync(workspacePath)) {
        const wsJsonPath = path.join(workspacePath, '.agents', 'skills.json');
        if (fs.existsSync(wsJsonPath)) {
            try {
                const config = JSON.parse(fs.readFileSync(wsJsonPath, 'utf8'));
                if (config.exclude) wsExclude = config.exclude;
            } catch (e) {}
        }
    }

    const all = [
        ...globalSkills.map(s => ({ ...s, enabled: !globalExclude.includes(s.id) })),
        ...workspaceSkills.map(s => ({ ...s, enabled: !wsExclude.includes(s.id) }))
    ];
    return all;
}

function handleToggleSkill(data) {
    const { id, scope, enabled, workspace } = data;
    let configPath;
    if (scope === 'global') {
        configPath = path.join(getGlobalRoot(), 'skills.json');
    } else if (scope === 'workspace' && workspace && fs.existsSync(workspace)) {
        configPath = path.join(workspace, '.agents', 'skills.json');
    } else {
        throw new Error('无效的 scope 或 workspace 路径');
    }

    const parentDir = path.dirname(configPath);
    if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
    }

    let config = { exclude: [] };
    if (fs.existsSync(configPath)) {
        try {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (e) {}
    }
    if (!config.exclude) config.exclude = [];

    if (enabled) {
        config.exclude = config.exclude.filter(item => item !== id);
    } else {
        if (!config.exclude.includes(id)) {
            config.exclude.push(id);
        }
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    return { success: true, config };
}

function handleSaveSkill(data) {
    const { id, displayName, description, body, scope, workspace } = data;
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
        throw new Error('技能 ID 不合法，只能包含字母、数字、下划线和中划线。');
    }

    let skillDir;
    if (scope === 'global') {
        skillDir = path.join(getGlobalRoot(), 'skills', id);
    } else if (scope === 'workspace' && workspace && fs.existsSync(workspace)) {
        skillDir = path.join(workspace, '.agents', 'skills', id);
    } else {
        throw new Error('无效的 scope 或 workspace 路径');
    }

    if (!fs.existsSync(skillDir)) {
        fs.mkdirSync(skillDir, { recursive: true });
    }

    const skillMdPath = path.join(skillDir, 'SKILL.md');
    const skillContent = `---
name: "${displayName.replace(/"/g, '\\"')}"
description: "${description.replace(/"/g, '\\"')}"
---

${body}`;

    fs.writeFileSync(skillMdPath, skillContent, 'utf8');
    return { success: true, path: skillMdPath };
}

function startApiServer() {
    const server = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        const url = new URL(req.url, `http://${req.headers.host}`);
        
        if (req.method === 'GET' && url.pathname === '/api/skills') {
            const workspace = url.searchParams.get('workspace');
            try {
                const skills = handleGetSkills(workspace);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, skills }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: err.message }));
            }
        } 
        else if (req.method === 'POST' && url.pathname === '/api/skills/toggle') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    const result = handleToggleSkill(data);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                } catch (err) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: err.message }));
                }
            });
        }
        else if (req.method === 'POST' && url.pathname === '/api/skills/save') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    const result = handleSaveSkill(data);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                } catch (err) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: err.message }));
                }
            });
        }
        else {
            res.writeHead(404);
            res.end('Not Found');
        }
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`[Local API Server] Port ${API_PORT} is already in use, assuming it is already running.`);
        } else {
            console.error('[Local API Server] Error:', err);
        }
    });

    server.listen(API_PORT, '127.0.0.1', () => {
        console.log(`[Local API Server] Running on http://127.0.0.1:${API_PORT}`);
    });
}

// ==========================================
// 2. 客户端注入代码 (JS / UI 结构和样式)
// ==========================================

const injectionScript = `(() => {
    // 避免重复注入
    const prevSidebarItem = document.getElementById('antigravity-custom-skills-sidebar-item');
    if (prevSidebarItem) prevSidebarItem.remove();

    const prevPanel = document.getElementById('antigravity-custom-skills-panel');
    if (prevPanel) prevPanel.remove();

    const prevStyle = document.getElementById('antigravity-custom-skills-style');
    if (prevStyle) prevStyle.remove();

    if (window.__antigravity_skills_global_observer) {
        window.__antigravity_skills_global_observer.disconnect();
        window.__antigravity_skills_global_observer = null;
    }
    if (window.__antigravity_skills_local_observer) {
        window.__antigravity_skills_local_observer.disconnect();
        window.__antigravity_skills_local_observer = null;
    }

    // 1. 注入全新侧边栏和双栏布局的 CSS 样式
    const styleEl = document.createElement('style');
    styleEl.id = 'antigravity-custom-skills-style';
    styleEl.textContent = \`
        #antigravity-custom-skills-sidebar-item.active {
            background: rgba(255, 255, 255, 0.08) !important;
            color: #38bdf8 !important;
            font-weight: 600;
        }

        .skills-panel {
            display: none;
            flex-direction: column;
            width: 100%;
            height: 100%;
            background: rgba(13, 13, 20, 0.98);
            font-family: inherit;
            color: #cbd5e1;
            overflow: hidden;
            box-sizing: border-box;
        }

        .skills-panel-header {
            padding: 16px 24px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-shrink: 0;
        }
        .skills-panel-title {
            font-size: 15px;
            font-weight: 700;
            color: #f8fafc;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .workspace-area {
            display: flex;
            align-items: center;
            gap: 8px;
            background: rgba(255, 255, 255, 0.03);
            padding: 5px 12px;
            border-radius: 6px;
            border: 1px solid rgba(255, 255, 255, 0.06);
        }
        .workspace-input {
            background: transparent;
            border: none;
            font-size: 11px;
            color: #f1f5f9;
            outline: none;
            width: 280px;
        }
        .workspace-input:focus {
            color: #ffffff;
        }

        .skills-panel-body {
            display: flex;
            flex: 1;
            overflow: hidden;
        }

        .skills-panel-left-col {
            width: 320px;
            border-right: 1px solid rgba(255, 255, 255, 0.06);
            display: flex;
            flex-direction: column;
            background: rgba(0, 0, 0, 0.15);
            flex-shrink: 0;
        }
        .skills-list-container {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .skills-list-actions {
            padding: 12px 16px;
            border-top: 1px solid rgba(255, 255, 255, 0.06);
            background: rgba(0, 0, 0, 0.2);
        }

        .skill-card {
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.04);
            border-radius: 8px;
            padding: 12px;
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            cursor: pointer;
            transition: all 0.15s ease;
        }
        .skill-card:hover {
            background: rgba(255, 255, 255, 0.04);
            border-color: rgba(255, 255, 255, 0.08);
        }
        .skill-card.selected {
            background: rgba(14, 165, 233, 0.05);
            border-color: rgba(14, 165, 233, 0.2);
        }
        .skill-card-info {
            flex: 1;
            padding-right: 8px;
        }
        .skill-card-header {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 4px;
        }
        .skill-card-name {
            font-size: 11.5px;
            font-weight: 600;
            color: #f1f5f9;
        }
        .scope-badge {
            font-size: 8.5px;
            padding: 0px 4px;
            border-radius: 4px;
            font-weight: 500;
        }
        .scope-badge.global {
            background: rgba(14, 165, 233, 0.15);
            color: #38bdf8;
            border: 1px solid rgba(14, 165, 233, 0.25);
        }
        .scope-badge.workspace {
            background: rgba(168, 85, 247, 0.15);
            color: #c084fc;
            border: 1px solid rgba(168, 85, 247, 0.25);
        }
        .skill-card-desc {
            font-size: 10.5px;
            color: #94a3b8;
            line-height: 1.4;
        }

        .switch {
            position: relative;
            display: inline-block;
            width: 28px;
            height: 16px;
            flex-shrink: 0;
        }
        .switch input {
            opacity: 0;
            width: 0;
            height: 0;
        }
        .slider {
            position: absolute;
            cursor: pointer;
            top: 0; left: 0; right: 0; bottom: 0;
            background-color: rgba(255, 255, 255, 0.1);
            transition: .2s;
            border-radius: 34px;
        }
        .slider:before {
            position: absolute;
            content: "";
            height: 12px; width: 12px;
            left: 2px; bottom: 2px;
            background-color: #94a3b8;
            transition: .2s;
            border-radius: 50%;
        }
        input:checked + .slider {
            background-color: #0ea5e9;
            box-shadow: 0 0 6px rgba(14, 165, 233, 0.4);
        }
        input:checked + .slider:before {
            transform: translateX(12px);
            background-color: #ffffff;
        }

        .skills-panel-right-col {
            flex: 1;
            display: flex;
            flex-direction: column;
            background: rgba(0, 0, 0, 0.05);
            position: relative;
            overflow: hidden;
        }
        .editor-placeholder {
            position: absolute;
            inset: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: #64748b;
            font-size: 12px;
            padding: 24px;
            text-align: center;
        }

        .edit-form-view {
            display: flex;
            flex-direction: column;
            height: 100%;
            padding: 24px;
            box-sizing: border-box;
            gap: 14px;
            overflow-y: auto;
        }
        .form-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .form-group label {
            font-size: 11px;
            font-weight: 600;
            color: #94a3b8;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .form-control {
            background: rgba(0, 0, 0, 0.25);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 6px;
            padding: 8px 12px;
            font-size: 12px;
            color: #f1f5f9;
            outline: none;
            transition: all 0.15s;
            font-family: inherit;
        }
        .form-control:focus {
            border-color: #38bdf8;
        }
        .form-textarea {
            resize: none;
            flex: 1;
            font-family: 'Consolas', 'Courier New', monospace;
            font-size: 11px;
            line-height: 1.5;
            background: rgba(0, 0, 0, 0.35);
        }
        .form-row {
            display: flex;
            gap: 12px;
        }
        .form-row .form-group {
            flex: 1;
        }
        .form-actions {
            display: flex;
            justify-content: flex-end;
            gap: 12px;
            padding-top: 10px;
            border-top: 1px solid rgba(255, 255, 255, 0.04);
            flex-shrink: 0;
        }

        .btn-primary {
            background: #0ea5e9;
            border: none;
            color: #ffffff;
            font-size: 11.5px;
            font-weight: 600;
            padding: 6px 14px;
            border-radius: 6px;
            cursor: pointer;
            transition: background 0.15s;
        }
        .btn-primary:hover {
            background: #0284c7;
        }
        .btn-secondary {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.08);
            color: #cbd5e1;
            font-size: 11.5px;
            padding: 6px 14px;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.15s;
        }
        .btn-secondary:hover {
            background: rgba(255, 255, 255, 0.08);
            color: #f1f5f9;
        }

        .toast-msg {
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%) translateY(-20px);
            background: rgba(14, 165, 233, 0.9);
            color: #ffffff;
            padding: 6px 16px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 500;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 100002;
            opacity: 0;
            transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            pointer-events: none;
        }
        .toast-msg.show {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
    \`;
    document.head.appendChild(styleEl);

    // 2. 创建 Toast 提示
    const toastEl = document.createElement('div');
    toastEl.className = 'toast-msg';
    document.body.appendChild(toastEl);

    function showToast(msg) {
        toastEl.textContent = msg;
        toastEl.classList.add('show');
        setTimeout(() => {
            toastEl.classList.remove('show');
        }, 2000);
    }

    // 3. 创建主体 Panel (占满屏幕的双栏布局)
    const panelEl = document.createElement('div');
    panelEl.id = 'antigravity-custom-skills-panel';
    panelEl.className = 'skills-panel';
    panelEl.innerHTML = \`
        <div class="skills-panel-header">
            <span class="skills-panel-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:16px; height:16px; color:#38bdf8;">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                </svg>
                Antigravity Skill Studio
            </span>
            <div class="workspace-area">
                <span style="font-size:10px; color:#64748b; font-weight:600;">WORKSPACE:</span>
                <input class="workspace-input" placeholder="输入工作区路径以加载 Workspace 技能..." value="">
            </div>
        </div>
        
        <div class="skills-panel-body">
            <div class="skills-panel-left-col">
                <div class="skills-list-container">
                    <!-- 列表卡片 -->
                </div>
                <div class="skills-list-actions">
                    <button class="btn-primary" id="btn-add-skill" style="width: 100%;">+ New Skill</button>
                </div>
            </div>
            
            <div class="skills-panel-right-col">
                <div class="editor-placeholder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:48px; height:48px; color:rgba(255,255,255,0.06); margin-bottom:12px;">
                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                    </svg>
                    <span>请在左侧选择技能，或点击“New Skill”新建，即可在此进行编辑。</span>
                </div>
                
                <div class="edit-form-view" style="display: none;">
                    <h3 style="margin-top:0; font-size:13.5px; font-weight:600; color:#f8fafc;" id="form-title">新建技能</h3>
                    <div class="form-group">
                        <label>技能 ID (英文目录名，不可修改)</label>
                        <input type="text" id="field-id" class="form-control" placeholder="如: code-reviewer">
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>显示名称 (YAML Name)</label>
                            <input type="text" id="field-name" class="form-control" placeholder="如: Code Reviewer">
                        </div>
                        <div class="form-group">
                            <label>作用域范围 (Scope)</label>
                            <select id="field-scope" class="form-control">
                                <option value="workspace">Workspace (当前工作区)</option>
                                <option value="global">Global (全局配置)</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>触发描述 (YAML Description)</label>
                        <input type="text" id="field-desc" class="form-control" placeholder="描述此技能在何种情况下被激活">
                    </div>
                    <div class="form-group" style="flex:1;">
                        <label>指令说明正文 (SKILL.md Markdown Body)</label>
                        <textarea id="field-body" class="form-control form-textarea" placeholder="在此输入此技能触发后的系统 Prompt..."></textarea>
                    </div>
                    <div class="form-actions">
                        <button class="btn-secondary" id="btn-form-cancel">取消</button>
                        <button class="btn-primary" id="btn-form-save">保存配置</button>
                    </div>
                </div>
            </div>
        </div>
    \`;

    const wsInput = panelEl.querySelector('.workspace-input');
    if (localStorage.getItem('antigravity_workspace_path')) {
        wsInput.value = localStorage.getItem('antigravity_workspace_path');
    }

    let activeSkillId = null;

    async function loadSkills() {
        const workspace = wsInput.value.trim();
        if (workspace) {
            localStorage.setItem('antigravity_workspace_path', workspace);
        } else {
            localStorage.removeItem('antigravity_workspace_path');
        }

        const listContainer = panelEl.querySelector('.skills-list-container');
        listContainer.innerHTML = '<div style="text-align:center; font-size:11px; color:#64748b; margin-top:20px;">正在加载技能中...</div>';

        try {
            const res = await fetch(\`http://127.0.0.1:9527/api/skills?workspace=\${encodeURIComponent(workspace)}\`);
            const data = await res.json();
            if (!data.success) {
                listContainer.innerHTML = \`<div style="text-align:center; font-size:11px; color:#ef4444; margin-top:20px;">加载失败: \${data.error}</div>\`;
                return;
            }

            const skills = data.skills;
            if (skills.length === 0) {
                listContainer.innerHTML = '<div style="text-align:center; font-size:11px; color:#64748b; margin-top:20px;">未发现可用技能。</div>';
                return;
            }

            listContainer.innerHTML = '';
            skills.forEach(skill => {
                const card = document.createElement('div');
                card.className = 'skill-card';
                if (activeSkillId === skill.id) card.classList.add('selected');
                
                card.innerHTML = \`
                    <div class="skill-card-info">
                        <div class="skill-card-header">
                            <span class="skill-card-name">\${escapeHtml(skill.displayName)}</span>
                            <span class="scope-badge \${skill.scope}">\${skill.scope.toUpperCase()}</span>
                        </div>
                        <div class="skill-card-desc">\${escapeHtml(skill.description || '暂无描述')}</div>
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px;">
                        <label class="switch" onclick="event.stopPropagation();">
                            <input type="checkbox" class="toggle-switch" data-id="\${skill.id}" data-scope="\${skill.scope}" \${skill.enabled ? 'checked' : ''}>
                            <span class="slider"></span>
                        </label>
                    </div>
                \`;

                card.querySelector('.toggle-switch').addEventListener('change', async (e) => {
                    const isChecked = e.target.checked;
                    try {
                        const toggleRes = await fetch('http://127.0.0.1:9527/api/skills/toggle', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                id: skill.id,
                                scope: skill.scope,
                                enabled: isChecked,
                                workspace: workspace
                            })
                        });
                        const toggleData = await toggleRes.json();
                        if (toggleData.success) {
                            showToast(\`技能 "\${skill.displayName}" 已\${isChecked ? '启用' : '禁用'}\`);
                        } else {
                            showToast(\`操作失败: \${toggleData.error}\`);
                            e.target.checked = !isChecked;
                        }
                    } catch (err) {
                        showToast('无法连接本地代理服务');
                        e.target.checked = !isChecked;
                    }
                });

                card.addEventListener('click', () => {
                    activeSkillId = skill.id;
                    panelEl.querySelectorAll('.skill-card').forEach(c => c.classList.remove('selected'));
                    card.classList.add('selected');
                    openEditForm(skill);
                });

                listContainer.appendChild(card);
            });

        } catch (err) {
            listContainer.innerHTML = '<div style="text-align:center; font-size:11px; color:#ef4444; margin-top:20px;">本地代理未运行，请确认是否执行 \\\`node inject-skills.js\\\`。</div>';
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    const placeholderEl = panelEl.querySelector('.editor-placeholder');
    const formView = panelEl.querySelector('.edit-form-view');

    function openEditForm(skill = null) {
        const titleEl = panelEl.querySelector('#form-title');
        const idInput = panelEl.querySelector('#field-id');
        const nameInput = panelEl.querySelector('#field-name');
        const descInput = panelEl.querySelector('#field-desc');
        const scopeSelect = panelEl.querySelector('#field-scope');
        const bodyInput = panelEl.querySelector('#field-body');

        if (skill) {
            titleEl.textContent = '编辑技能';
            idInput.value = skill.id;
            idInput.disabled = true;
            nameInput.value = skill.displayName;
            descInput.value = skill.description;
            scopeSelect.value = skill.scope;
            scopeSelect.disabled = true;
            bodyInput.value = skill.body;
        } else {
            titleEl.textContent = '新建技能';
            idInput.value = '';
            idInput.disabled = false;
            nameInput.value = '';
            descInput.value = '';
            scopeSelect.value = 'workspace';
            scopeSelect.disabled = false;
            bodyInput.value = '';
            
            activeSkillId = null;
            panelEl.querySelectorAll('.skill-card').forEach(c => c.classList.remove('selected'));
        }

        placeholderEl.style.display = 'none';
        formView.style.display = 'flex';
    }

    function closeForm() {
        formView.style.display = 'none';
        placeholderEl.style.display = 'flex';
        
        activeSkillId = null;
        panelEl.querySelectorAll('.skill-card').forEach(c => c.classList.remove('selected'));
    }

    panelEl.querySelector('#btn-add-skill').addEventListener('click', () => openEditForm(null));
    panelEl.querySelector('#btn-form-cancel').addEventListener('click', closeForm);
    panelEl.querySelector('#btn-form-save').addEventListener('click', async () => {
        const id = panelEl.querySelector('#field-id').value.trim();
        const displayName = panelEl.querySelector('#field-name').value.trim();
        const description = panelEl.querySelector('#field-desc').value.trim();
        const scope = panelEl.querySelector('#field-scope').value;
        const body = panelEl.querySelector('#field-body').value.trim();
        const workspace = wsInput.value.trim();

        if (!id || !displayName) {
            showToast('技能 ID 和名称不能为空！');
            return;
        }

        try {
            const res = await fetch('http://127.0.0.1:9527/api/skills/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, displayName, description, body, scope, workspace })
            });
            const data = await res.json();
            if (data.success) {
                showToast('保存成功！');
                closeForm();
                loadSkills();
            } else {
                showToast(\`保存失败: \${data.error}\`);
            }
        } catch (err) {
            showToast('保存失败，无法连接本地服务');
        }
    });

    wsInput.addEventListener('blur', loadSkills);
    wsInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') loadSkills();
    });

    // 7. 定位侧边栏与右侧主屏幕大容器
    // 侧栏根容器是 div[role="navigation"].bg-sidebar
    // 其内部结构: [spacer, buttons-container, separator, projects-list, separator, settings]
    // buttons-container 内有: New Conversation, Conversation History, Scheduled Tasks
    let sidebarNav = null;
    let mainHost = null;

    function locateLayout() {
        // 精确定位：侧栏有 role="navigation" 属性
        sidebarNav = document.querySelector('[role="navigation"]');
        if (!sidebarNav) return false;

        // 主屏幕大容器：从 sidebarNav 向上找到与主屏幕并列的层级
        // 结构: ... > DIV.flex > [DIV(sidebar-wrapper) , DIV(main-content)]
        let sidebarWrapper = sidebarNav;
        while (sidebarWrapper && sidebarWrapper.parentElement) {
            const parent = sidebarWrapper.parentElement;
            if (parent.children.length > 1) {
                // 找到有多个子节点的父级，另一个子节点就是主内容区
                const sibling = Array.from(parent.children).find(c => c !== sidebarWrapper && c.offsetWidth > 200);
                if (sibling) {
                    mainHost = sibling;
                    return true;
                }
            }
            sidebarWrapper = parent;
        }
        return false;
    }

    function activateSkillsView() {
        if (!mainHost) {
            locateLayout();
        }
        if (!mainHost) return;

        if (panelEl.parentElement !== mainHost) {
            mainHost.appendChild(panelEl);
        }

        // 隐藏大屏幕下的所有直接原生子节点
        Array.from(mainHost.children).forEach(child => {
            if (child === panelEl) return;
            if (!child.hasAttribute('data-skills-orig-display')) {
                const origDisplay = window.getComputedStyle(child).display || '';
                child.setAttribute('data-skills-orig-display', origDisplay);
            }
            child.style.setProperty('display', 'none', 'important');
        });

        panelEl.style.display = 'flex';
        loadSkills();
    }

    function deactivateSkillsView() {
        if (!mainHost) return;

        panelEl.style.display = 'none';

        // 还原显示
        Array.from(mainHost.children).forEach(child => {
            if (child === panelEl) return;
            const origDisplay = child.getAttribute('data-skills-orig-display');
            if (origDisplay !== null) {
                child.style.display = origDisplay;
            } else {
                child.style.display = '';
            }
        });
    }

    function insertSidebarBtn() {
        if (!sidebarNav) {
            locateLayout();
        }
        if (!sidebarNav) return;

        if (sidebarNav.querySelector('#antigravity-custom-skills-sidebar-item')) return;

        // 在侧栏内部精确查找 Scheduled Tasks 按钮 (只搜索 button 标签)
        const buttons = Array.from(sidebarNav.querySelectorAll('button'));
        const schedBtn = buttons.find(btn => btn.textContent.trim() === 'Scheduled Tasks');
        if (!schedBtn) return;

        const skillsBtn = document.createElement('BUTTON');
        skillsBtn.className = schedBtn.className;
        skillsBtn.id = 'antigravity-custom-skills-sidebar-item';

        // 克隆 innerHTML 并替换文字和图标
        let inner = schedBtn.innerHTML.replace('Scheduled Tasks', 'Skills');

        const skillsSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:15px; height:15px; flex-shrink:0; color:#38bdf8;"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" opacity="0.85" /><path d="M2 12l10 5 10-5" opacity="0.5" /><path d="M19 3v4M17 5h4" stroke-width="1.6" /></svg>';

        // 用 DOM 方式替换 SVG 图标（避免正则转义问题）
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = inner;
        const oldSvg = tempDiv.querySelector('svg');
        if (oldSvg) {
            const newSvgContainer = document.createElement('div');
            newSvgContainer.innerHTML = skillsSvg;
            oldSvg.replaceWith(newSvgContainer.firstChild);
            inner = tempDiv.innerHTML;
        } else {
            inner = skillsSvg + inner;
        }
        skillsBtn.innerHTML = inner;

        skillsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // 移除侧栏中其他按钮的 active 样式
            sidebarNav.querySelectorAll('button').forEach(btn => {
                if (btn !== skillsBtn) {
                    btn.setAttribute('data-active', 'false');
                }
            });
            skillsBtn.setAttribute('data-active', 'true');

            activateSkillsView();
        });

        // 插入在 Scheduled Tasks 按钮的后面
        schedBtn.parentNode.insertBefore(skillsBtn, schedBtn.nextSibling);
    }

    // 8. 捕获阶段监听侧栏其他项点击，点击切回原生界面
    document.addEventListener('click', (e) => {
        const clickedBtn = e.target.closest('button');
        if (clickedBtn && 
            clickedBtn.id !== 'antigravity-custom-skills-sidebar-item' && 
            sidebarNav && 
            sidebarNav.contains(clickedBtn)) {
            
            deactivateSkillsView();
            
            const skillsBtn = document.getElementById('antigravity-custom-skills-sidebar-item');
            if (skillsBtn) {
                skillsBtn.setAttribute('data-active', 'false');
            }
        }
    }, true);

    // 9. 智能双重 Observer 挂载逻辑
    function setupGlobalObserver() {
        if (window.__antigravity_skills_global_observer) return;
        window.__antigravity_skills_global_observer = new MutationObserver(() => {
            insertSidebarBtn();
            if (sidebarNav) {
                window.__antigravity_skills_global_observer.disconnect();
                window.__antigravity_skills_global_observer = null;
                setupLocalObserver();
            }
        });
        window.__antigravity_skills_global_observer.observe(document.body, { childList: true, subtree: true });
    }

    function setupLocalObserver() {
        if (window.__antigravity_skills_local_observer || !sidebarNav) return;
        window.__antigravity_skills_local_observer = new MutationObserver(() => {
            insertSidebarBtn();
        });
        window.__antigravity_skills_local_observer.observe(sidebarNav, { childList: true, subtree: true });
    }

    function initObserver() {
        insertSidebarBtn();
        if (sidebarNav) {
            setupLocalObserver();
        } else {
            setupGlobalObserver();
        }
    }

    initObserver();
    return "Successfully injected Skills into sidebar!";
})();`;

// ==========================================
// 3. 执行连接并注入的逻辑
// ==========================================

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
        
        startApiServer();

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
        console.log('\n【完成】已成功在所有渲染页面中启用 Skill 管理器组件！');
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
                if (data.result && data.result.exceptionDetails) {
                    console.error("  -> 注入异常:", data.result.exceptionDetails.exception.description);
                } else if (data.result && data.result.result) {
                    console.log(`  -> 结果: ${data.result.result.value}`);
                } else {
                    console.log("  -> 结果: 未知响应格式", data);
                }
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
