#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');

const DEFAULT_CONFIG_FILE = 'config.json';

// Registered injection modules
const MODULES = {
    limits: {
        id: 'limits',
        file: 'inject-limits.js',
        name: 'Quota Limits Indicator',
        description: 'Real-time quota percentage & detailed reset-time card',
        defaultEnabled: true,
        isDaemon: false,
    },
    rail: {
        id: 'rail',
        file: 'inject-turn-rail.js',
        name: 'Turn Rail Navigator',
        description: 'Sidebar turn navigation timeline',
        defaultEnabled: true,
        isDaemon: false,
    },
    font: {
        id: 'font',
        file: 'inject-font.js',
        name: 'Custom Typography',
        description: 'Google Sans / MiSans & Maple Mono NF',
        defaultEnabled: false,
        isDaemon: false,
    },
    skills: {
        id: 'skills',
        file: 'inject-skills.js',
        name: 'Skill Manager & Daemon',
        description: 'Visual skill manager & local proxy daemon (port 9527)',
        defaultEnabled: true,
        isDaemon: true,
    },
    'theme-contrast': {
        id: 'theme-contrast',
        file: 'inject-theme-contrast.js',
        name: 'High Contrast Theme',
        description: 'Warm oat sidebar + pure white main + high contrast text',
        defaultEnabled: false,
        isDaemon: false,
    },
    'theme-white': {
        id: 'theme-white',
        file: 'inject-theme-purewhite.js',
        name: 'ClaudeDesktop Pure White Theme',
        description: 'Minimal pure white dual-column theme',
        defaultEnabled: false,
        isDaemon: false,
    },
    'theme-vintage': {
        id: 'theme-vintage',
        file: 'inject-theme-vintage.js',
        name: 'Vintage Deep Theme',
        description: 'Parchment & kraft paper warm theme',
        defaultEnabled: false,
        isDaemon: false,
    },
    enhancements: {
        id: 'enhancements',
        file: 'inject-enhancements.js',
        name: 'Interaction Enhancements',
        description: 'Settings dialog deadlock fix & React crash guard',
        defaultEnabled: false,
        isDaemon: false,
    },
};

// Aliases for user convenience
const ALIASES = {
    limit: 'limits',
    quota: 'limits',
    skill: 'skills',
    turnrail: 'rail',
    fonts: 'font',
    contrast: 'theme-contrast',
    'theme:contrast': 'theme-contrast',
    purewhite: 'theme-white',
    white: 'theme-white',
    'theme:white': 'theme-white',
    vintage: 'theme-vintage',
    'theme:vintage': 'theme-vintage',
    enhancement: 'enhancements',
    guard: 'enhancements',
};

function normalizeModuleId(name) {
    const lower = name.toLowerCase().replace(/^--?/, '').replace(/_/g, '-');
    if (MODULES[lower]) return lower;
    if (ALIASES[lower]) return ALIASES[lower];
    return null;
}

// Locate Antigravity's DevToolsActivePort across platforms
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

// Print CLI Help
function printHelp() {
    console.log(`
Antigravity Plus - Multi-Script Injector Runner

Usage:
  node inject.js [options] [modules...]
  npm run inject
  npm run inject:all
  npm run revert

Options:
  -h, --help           Show this help message and exit
  -a, --all            Inject all available modules
  -r, --revert         Revert and remove all injected customizations from Antigravity
  --reload             Reload Antigravity window(s) to pristine state
  -c, --config <file>  Specify custom configuration file (default: config.json)
  --limits             Enable quota limits indicator
  --no-limits          Disable quota limits indicator
  --skills             Enable skill manager & daemon
  --no-skills          Disable skill manager & daemon
  --rail               Enable turn rail navigator
  --no-rail            Disable turn rail navigator
  --font               Enable custom typography
  --no-font            Disable custom typography

Available Modules:
  limits   ${MODULES.limits.name}
           ${MODULES.limits.description}
  skills   ${MODULES.skills.name}
           ${MODULES.skills.description}
  rail     ${MODULES.rail.name}
           ${MODULES.rail.description}
  font     ${MODULES.font.name}
           ${MODULES.font.description}

Examples:
  node inject.js                  # Run modules enabled in config.json
  node inject.js --all            # Run all modules
  node inject.js limits rail      # Run only limits and rail
  node inject.js --no-skills      # Run config.json modules excluding skills
  node inject.js --revert         # Hot-revert all injected modifications
  node inject.js --revert --reload# Revert and reload Antigravity windows
`);
}

// Load or create default configuration
function loadConfig(configPath) {
    const fullPath = path.resolve(process.cwd(), configPath);
    if (!fs.existsSync(fullPath)) {
        const defaultConfig = {};
        for (const [key, def] of Object.entries(MODULES)) {
            defaultConfig[key] = def.defaultEnabled;
        }
        try {
            fs.writeFileSync(fullPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
            console.log(`[Config] Created default configuration at ${path.basename(fullPath)}`);
        } catch (e) {
            console.warn(`[Config] Unable to write default config file: ${e.message}`);
        }
        return defaultConfig;
    }

    try {
        const raw = fs.readFileSync(fullPath, 'utf8');
        const parsed = JSON.parse(raw);
        // Support nested keys like { scripts: { ... } } or { modules: { ... } }
        return parsed.modules || parsed.scripts || parsed;
    } catch (e) {
        console.warn(`[Config] Warning: Failed to parse ${configPath} (${e.message}). Using defaults.`);
        const fallback = {};
        for (const [key, def] of Object.entries(MODULES)) {
            fallback[key] = def.defaultEnabled;
        }
        return fallback;
    }
}

// Revert all hot-injected DOM modifications and listeners
async function revertAll(shouldReload = false) {
    console.log('\n======================================================');
    console.log('         Antigravity Plus - Revert Enhancements');
    console.log('======================================================');

    const portFile = getActivePortPath();
    if (!fs.existsSync(portFile)) {
        console.error('\n\x1b[31m[!] DevToolsActivePort file not found.\x1b[0m');
        console.error('    Please make sure Antigravity 2.0 is running.\n');
        process.exit(1);
    }

    const content = fs.readFileSync(portFile, 'utf8').split('\n');
    const port = content[0].trim();
    console.log(`[Discovered DevTools Port] ${port}`);

    const res = await fetch(`http://127.0.0.1:${port}/json`);
    const targets = await res.json();
    const pages = targets.filter(t => t.type === 'page');

    if (pages.length === 0) {
        console.error('[!] No active rendering pages found.\n');
        process.exit(1);
    }

    const revertScript = `(() => {
        let count = 0;

        // 1. Quota limits
        const limitStyle = document.getElementById('antigravity-custom-limits-style');
        if (limitStyle) { limitStyle.remove(); count++; }
        document.querySelectorAll('.custom-limits-container').forEach(el => { el.remove(); count++; });
        if (window.__antigravity_quota_interval) {
            clearInterval(window.__antigravity_quota_interval);
            window.__antigravity_quota_interval = null;
            count++;
        }
        if (window.__antigravity_quota_observer) {
            window.__antigravity_quota_observer.disconnect();
            window.__antigravity_quota_observer = null;
            count++;
        }

        // 2. Turn rail
        const railStyle = document.getElementById('antigravity-turn-rail-style');
        if (railStyle) { railStyle.remove(); count++; }
        const railRoot = document.getElementById('antigravity-turn-rail-root');
        if (railRoot) { railRoot.remove(); count++; }
        if (window.__antigravity_rail_observer) {
            window.__antigravity_rail_observer.disconnect();
            window.__antigravity_rail_observer = null;
            count++;
        }
        if (window.__antigravity_rail_resize_observer) {
            window.__antigravity_rail_resize_observer.disconnect();
            window.__antigravity_rail_resize_observer = null;
            count++;
        }
        if (window.__antigravity_rail_scroll_handler) {
            const conv = document.querySelector('[data-testid="conversation-view"]');
            if (conv) conv.removeEventListener('scroll', window.__antigravity_rail_scroll_handler);
            window.__antigravity_rail_scroll_handler = null;
            count++;
        }
        if (window.__antigravity_rail_resize_handler) {
            window.removeEventListener('resize', window.__antigravity_rail_resize_handler);
            window.__antigravity_rail_resize_handler = null;
            count++;
        }

        // 3. Custom typography & themes
        const fontStyle = document.getElementById('antigravity-custom-font-style');
        if (fontStyle) { fontStyle.remove(); count++; }
        const themeStyle = document.getElementById('antigravity-custom-theme-style');
        if (themeStyle) { themeStyle.remove(); count++; }

        // 4. Skill manager
        const skillsItem = document.getElementById('antigravity-custom-skills-sidebar-item');
        if (skillsItem) { skillsItem.remove(); count++; }
        const skillsPanel = document.getElementById('antigravity-custom-skills-panel');
        if (skillsPanel) { skillsPanel.remove(); count++; }
        const skillsStyle = document.getElementById('antigravity-custom-skills-style');
        if (skillsStyle) { skillsStyle.remove(); count++; }
        if (window.__antigravity_skills_global_observer) {
            window.__antigravity_skills_global_observer.disconnect();
            window.__antigravity_skills_global_observer = null;
            count++;
        }
        if (window.__antigravity_skills_local_observer) {
            window.__antigravity_skills_local_observer.disconnect();
            window.__antigravity_skills_local_observer = null;
            count++;
        }

        ${shouldReload ? 'window.location.reload();' : ''}

        return count > 0 ? \`Removed \${count} injected elements & observers\` : 'Clean (no active injections found)';
    })()`;

    for (const page of pages) {
        console.log(`Reverting page: "${page.title}"`);
        await new Promise((resolve) => {
            const ws = new WebSocket(page.webSocketDebuggerUrl);
            ws.onopen = () => {
                ws.send(JSON.stringify({
                    id: 1,
                    method: 'Runtime.evaluate',
                    params: {
                        expression: revertScript,
                        returnByValue: true,
                    },
                }));
            };
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.id === 1) {
                    const result = data.result && data.result.result ? data.result.result.value : 'Done';
                    console.log(`  -> Result: ${result}`);
                    ws.close();
                    resolve();
                }
            };
            ws.onerror = (err) => {
                console.error('  [!] Revert error:', err.message);
                resolve();
            };
        });
    }

    console.log('\n======================================================');
    console.log('\x1b[32m✔ Successfully reverted all injected enhancements!\x1b[0m');
    if (shouldReload) {
        console.log('• Windows have been reloaded to pristine state.');
    } else {
        console.log('• Tip: You can also reload Antigravity at any time via Ctrl+R.');
    }
    console.log('======================================================\n');
}

// Track active child processes for graceful shutdown
const activeChildren = new Set();

function cleanupChildren() {
    for (const child of activeChildren) {
        if (!child.killed) {
            try {
                child.kill('SIGINT');
            } catch (_) {}
        }
    }
    activeChildren.clear();
}

process.on('SIGINT', () => {
    console.log('\n[Antigravity Plus] Received interrupt signal. Stopping background processes...');
    cleanupChildren();
    process.exit(0);
});

process.on('SIGTERM', () => {
    cleanupChildren();
    process.exit(0);
});

// Run a single module script via child_process.fork
function runChildScript(modDef) {
    return new Promise((resolve) => {
        const scriptPath = path.resolve(__dirname, modDef.file);
        if (!fs.existsSync(scriptPath)) {
            console.error(`  [!] Script not found: ${modDef.file}`);
            return resolve({ success: false, isDaemon: false });
        }

        const child = fork(scriptPath, [], {
            stdio: 'inherit',
        });

        activeChildren.add(child);

        child.on('exit', (code) => {
            activeChildren.delete(child);
            resolve({ success: code === 0, isDaemon: false });
        });

        child.on('error', (err) => {
            activeChildren.delete(child);
            console.error(`  [!] Failed to execute ${modDef.file}:`, err.message);
            resolve({ success: false, isDaemon: false });
        });

        // For daemon modules that keep running (like inject-skills.js),
        // we allow other logic to continue if needed after a short grace period
        if (modDef.isDaemon) {
            setTimeout(() => {
                if (activeChildren.has(child)) {
                    resolve({ success: true, isDaemon: true });
                }
            }, 800);
        }
    });
}

async function main() {
    const args = process.argv.slice(2);

    if (args.includes('-h') || args.includes('--help')) {
        printHelp();
        process.exit(0);
    }

    // Check for revert command
    const isRevert = args.includes('-r') || args.includes('--revert') || args.includes('revert');
    const shouldReload = args.includes('--reload');
    if (isRevert) {
        await revertAll(shouldReload);
        process.exit(0);
    }

    // Parse custom config file path if specified
    let configFilePath = DEFAULT_CONFIG_FILE;
    const configFlagIdx = args.findIndex(a => a === '-c' || a === '--config');
    if (configFlagIdx !== -1 && args[configFlagIdx + 1]) {
        configFilePath = args[configFlagIdx + 1];
    }

    const config = loadConfig(configFilePath);

    // Determine enabled modules
    const selected = {};
    const positionalModules = [];
    const forceAll = args.includes('-a') || args.includes('--all');

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '-c' || arg === '--config') {
            i++; // skip value
            continue;
        }
        if (arg === '-a' || arg === '--all') continue;
        if (arg === '--reload') continue;

        if (arg.startsWith('--no-')) {
            const id = normalizeModuleId(arg.slice(5));
            if (id) selected[id] = false;
        } else if (arg.startsWith('--')) {
            const id = normalizeModuleId(arg.slice(2));
            if (id) selected[id] = true;
        } else if (!arg.startsWith('-')) {
            const id = normalizeModuleId(arg);
            if (id) positionalModules.push(id);
        }
    }

    // Decision matrix for module selection:
    // 1. If positional arguments provided (e.g. `node inject.js limits rail`), run ONLY those
    // 2. If --all provided, enable all
    // 3. Otherwise, use config.json values overridden by any explicit --module or --no-module flags
    const finalEnabled = {};
    if (positionalModules.length > 0) {
        for (const key of Object.keys(MODULES)) {
            finalEnabled[key] = positionalModules.includes(key);
        }
    } else if (forceAll) {
        for (const key of Object.keys(MODULES)) {
            finalEnabled[key] = true;
        }
    } else {
        for (const key of Object.keys(MODULES)) {
            if (selected[key] !== undefined) {
                finalEnabled[key] = selected[key];
            } else if (config[key] !== undefined) {
                finalEnabled[key] = Boolean(config[key]);
            } else {
                finalEnabled[key] = MODULES[key].defaultEnabled;
            }
        }
    }

    const enabledList = Object.keys(MODULES).filter(key => finalEnabled[key]);

    console.log('\n======================================================');
    console.log('            Antigravity Plus Runner');
    console.log('======================================================');

    if (enabledList.length === 0) {
        console.log('No modules enabled. Check your config.json or pass --all.');
        console.log('Run "node inject.js --help" for available options.\n');
        process.exit(0);
    }

    console.log(`Config file : ${configFilePath}`);
    console.log('Modules     : ' + enabledList.map(k => `\x1b[32m${k}\x1b[0m`).join(', '));
    console.log('------------------------------------------------------');

    // Pre-flight check: ensure Antigravity 2.0 is running
    try {
        const portFile = getActivePortPath();
        if (!fs.existsSync(portFile)) {
            console.error('\n\x1b[31m[!] DevToolsActivePort file not found.\x1b[0m');
            console.error('    Please make sure Antigravity 2.0 client is running.\n');
            process.exit(1);
        }
    } catch (e) {
        console.error(`\n[!] Error checking Antigravity port: ${e.message}\n`);
        process.exit(1);
    }

    // Separate modules into one-shot injectors and long-running daemons
    const oneShotModules = [];
    const daemonModules = [];

    for (const key of enabledList) {
        const modDef = MODULES[key];
        if (modDef.isDaemon) {
            daemonModules.push(modDef);
        } else {
            oneShotModules.push(modDef);
        }
    }

    // 1. Run one-shot modules sequentially
    for (let i = 0; i < oneShotModules.length; i++) {
        const mod = oneShotModules[i];
        console.log(`\n[${i + 1}/${enabledList.length}] Injecting ${mod.name} (${mod.file})...`);
        await runChildScript(mod);
    }

    // 2. Run daemon modules (like inject-skills.js)
    let hasRunningDaemon = false;
    for (let i = 0; i < daemonModules.length; i++) {
        const mod = daemonModules[i];
        const stepNum = oneShotModules.length + i + 1;
        console.log(`\n[${stepNum}/${enabledList.length}] Launching ${mod.name} (${mod.file})...`);
        const result = await runChildScript(mod);
        if (result.isDaemon) {
            hasRunningDaemon = true;
        }
    }

    console.log('\n======================================================');
    if (hasRunningDaemon) {
        console.log('\x1b[32m✔ All selected modules injected successfully!\x1b[0m');
        console.log('• Skill Manager daemon is active in background.');
        console.log('• Press Ctrl+C at any time to exit.');
        console.log('======================================================\n');
        // Keep process open waiting for interrupt
    } else {
        console.log('\x1b[32m✔ All selected modules injected successfully!\x1b[0m');
        console.log('======================================================\n');
        process.exit(0);
    }
}

main().catch((err) => {
    console.error('\n[!] Unexpected error:', err);
    cleanupChildren();
    process.exit(1);
});
