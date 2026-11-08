const fs = require('fs');
const path = require('path');

function isWorkbench(target) {
    if (target.type !== 'page' || !target.webSocketDebuggerUrl || String(target.title).includes('Launchpad')) return false;
    try {
        const url = new URL(target.url);
        return url.protocol === 'vscode-file:' ||
            (['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost'].includes(url.hostname));
    } catch {
        return false;
    }
}

async function isWorkbenchReady(target) {
    return await evaluate(target.webSocketDebuggerUrl,
        '(document.readyState === "complete" && !!document.title.trim() && ' +
        '!!document.querySelector(".monaco-workbench, [id=\\"antigravity.agentSidePanelInputBox\\"], [data-testid=\\"home-greeting\\"]"))') === true;
}

// Both release channels use the same injection contract.
async function getTargets() {
    const home = process.env.HOME || process.env.USERPROFILE;
    const base = process.platform === 'win32' ? process.env.APPDATA :
        process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support') :
        process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    const ports = new Set();
    for (const [name, settings, fallback] of [
        ['Antigravity', '.antigravity', 9222],
        ['Antigravity - Insiders', '.antigravity-insiders', 9223]
    ]) {
        const portFile = path.join(base, name, 'DevToolsActivePort');
        if (fs.existsSync(portFile)) {
            const port = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
            if (Number.isInteger(port) && port > 0) ports.add(port);
        }
        const argvFile = path.join(home, settings, 'argv.json');
        if (fs.existsSync(argvFile)) {
            const match = fs.readFileSync(argvFile, 'utf8').match(/"remote-debugging-port"\s*:\s*(\d+)/);
            ports.add(match ? Number(match[1]) : fallback);
        }
    }
    const pages = new Map();
    for (const port of ports) {
        let response;
        try {
            response = await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(1500) });
        } catch (error) {
            if (error instanceof TypeError || error.name === 'TimeoutError') continue;
            throw error;
        }
        if (!response.ok) continue;
        const targets = await response.json();
        if (!Array.isArray(targets)) throw new Error('Invalid CDP target list on port ' + port);
        for (const target of targets.filter(isWorkbench)) {
            if (await isWorkbenchReady(target)) pages.set(target.webSocketDebuggerUrl, target);
        }
    }
    if (!pages.size) {
        const error = new Error('No Antigravity workbench found. Start Antigravity with remote debugging enabled.');
        error.code = 'NO_WORKBENCH';
        throw error;
    }
    return [...pages.values()];
}

function evaluate(wsUrl, expression) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const timer = setTimeout(() => {
            ws.close();
            reject(new Error('CDP evaluation timed out'));
        }, 5000);
        ws.onopen = () => ws.send(JSON.stringify({
            id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true }
        }));
        ws.onmessage = event => {
            try {
                const data = JSON.parse(event.data);
                if (data.id !== 1) return;
                clearTimeout(timer);
                ws.close();
                if (data.error || data.result?.exceptionDetails) {
                    reject(new Error(data.error?.message || data.result.exceptionDetails.exception?.description || data.result.exceptionDetails.text));
                } else resolve(data.result?.result?.value);
            } catch (error) {
                clearTimeout(timer);
                ws.close();
                reject(error);
            }
        };
        ws.onerror = () => {
            clearTimeout(timer);
            reject(new Error('CDP connection failed'));
        };
    });
}

module.exports = { getTargets, evaluate, isWorkbenchReady };

