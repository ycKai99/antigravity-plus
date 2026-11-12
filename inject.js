#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { getTargets } = require('./cdp');
const { readPresetArg } = require('./theme/presets.cjs');

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
    font: {
        id: 'font',
        file: 'inject-font.js',
        name: 'Custom Typography',
        description: 'Anthropic Sans / Sarasa UI SC & Maple Mono NF',
        defaultEnabled: true,
        isDaemon: false,
    },
    theme: {
        id: 'theme',
        file: 'inject-theme.mjs',
        name: 'Theme & Session Metrics',
        description: 'Light/dark presets, native composer styling & local session metrics',
        defaultEnabled: true,
        isDaemon: false,
    },
};

// Aliases for user convenience
const ALIASES = {
    limit: 'limits',
    quota: 'limits',
    fonts: 'font',
};

const REMOVED_MODULES = new Set([
    'rail', 'turnrail',
    'skills', 'skill', 'theme-contrast', 'contrast', 'theme:contrast',
    'theme-white', 'purewhite', 'white', 'theme:white',
    'theme-vintage', 'vintage', 'theme:vintage', 'enhancements', 'enhancement', 'guard',
]);

function normalizeModuleId(name) {
    const lower = name.toLowerCase().replace(/^--?/, '').replace(/_/g, '-');
    if (MODULES[lower]) return lower;
    if (ALIASES[lower]) return ALIASES[lower];
    if (REMOVED_MODULES.has(lower)) {
        if (lower === 'rail' || lower === 'turnrail') {
            throw new Error(`Module "${lower}" has been removed because Antigravity now supports conversation turn navigation natively.`);
        }
        throw new Error(`Module "${lower}" has been removed. Use "theme" for presets and interaction fixes; the skills manager is no longer included.`);
    }
    throw new Error(`Unknown module or option "${name}". Run node inject.js --help for available options.`);
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
  --theme              Inject theme & session metrics snapshot
  --no-theme           Disable theme & session metrics daemon
  --preset <name>      Override the theme preset for this run
                       high-contrast | claude-desktop-purewhite | vintage-deep | high-contrast-dark
  --safe-mode          Start theme without user customizations
  --wait-for-client    Wait for Antigravity before injecting (used by autostart)
  --font               Enable custom typography
  --no-font            Disable custom typography

Available Modules:
  limits   ${MODULES.limits.name}
           ${MODULES.limits.description}
  font     ${MODULES.font.name}
           ${MODULES.font.description}
  theme    ${MODULES.theme.name}
           ${MODULES.theme.description}

Examples:
  node inject.js                  # Run modules enabled in config.json
  node inject.js --all            # Run all modules
  node inject.js limits font      # Run only limits and font
  node inject.js --no-theme       # Run config.json modules excluding theme
  node inject.js theme --safe-mode # Run the bundled theme without user customizations
  node inject.js --preset high-contrast-dark # Use warm dark colors without editing config
  node inject.js --revert         # Hot-revert all injected modifications
  node inject.js --revert --reload # Revert and reload Antigravity windows
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
        throw new Error(`Cannot read configuration ${fullPath}: ${e.message}`);
    }
}

// Revert all hot-injected DOM modifications and listeners
async function revertAll(shouldReload = false) {
    console.log('\n======================================================');
    console.log('         Antigravity Plus - Revert Enhancements');
    console.log('======================================================');

    await (await import('./theme/control.mjs')).requestStop();

    const pages = await getTargets();

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

        // 4. Theme runtime, hooks and observers
        if (typeof window.__antigravity_theme_dispose === 'function') {
            window.__antigravity_theme_dispose();
            count++;
        }

        ${shouldReload ? 'window.location.reload();' : ''}

        return count > 0 ? \`Removed \${count} injected elements & observers\` : 'Clean (no active injections found)';
    })()`;

    for (const page of pages) {
        console.log(`Reverting page: "${page.title}"`);
        await new Promise((resolve, reject) => {
            const ws = new WebSocket(page.webSocketDebuggerUrl);
            const timer = setTimeout(() => {
                ws.close();
                reject(new Error(`Timed out reverting page "${page.title}".`));
            }, 5000);
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
                try {
                    const data = JSON.parse(event.data);
                    if (data.id !== 1) return;
                    clearTimeout(timer);
                    ws.close();
                    if (data.error || data.result?.exceptionDetails) {
                        const message = data.error?.message || data.result.exceptionDetails.text;
                        reject(new Error(`Unable to revert page "${page.title}": ${message}`));
                        return;
                    }
                    console.log(`  -> Result: ${data.result?.result?.value || 'Done'}`);
                    resolve();
                } catch (err) {
                    clearTimeout(timer);
                    ws.close();
                    reject(err);
                }
            };
            ws.onerror = (err) => {
                clearTimeout(timer);
                reject(new Error(`Unable to connect to page "${page.title}" for revert: ${err.message}`));
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
let activeThemeChild = null;
let shuttingDown = false;

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

async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n[Antigravity Plus] Stopping background processes...');
    try {
        if (activeThemeChild && activeChildren.has(activeThemeChild)) {
            await (await import('./theme/control.mjs')).requestStop();
        }
    } catch (err) {
        console.error(`  [!] Unable to stop theme cleanly: ${err.message}`);
        process.exitCode = 1;
    }
    cleanupChildren();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Run a single module script via child_process.fork
function runChildScript(modDef, scriptArgs = []) {
    return new Promise((resolve) => {
        const scriptPath = path.resolve(__dirname, modDef.file);
        if (!fs.existsSync(scriptPath)) {
            console.error(`  [!] Script not found: ${modDef.file}`);
            return resolve({ success: false, isDaemon: false });
        }

        const child = fork(scriptPath, scriptArgs, {
            stdio: 'inherit',
        });

        activeChildren.add(child);
        if (modDef.id === 'theme') activeThemeChild = child;
        let settled = false;
        let startupTimer = null;

        const finish = (result) => {
            if (settled) return;
            settled = true;
            if (startupTimer) clearTimeout(startupTimer);
            resolve(result);
        };

        child.on('exit', (code) => {
            activeChildren.delete(child);
            if (activeThemeChild === child) activeThemeChild = null;
            if (settled && code !== 0 && !shuttingDown) {
                console.error(`  [!] ${modDef.name} exited with code ${code}.`);
                process.exitCode = 1;
                cleanupChildren();
            }
            finish({ success: !modDef.isDaemon && code === 0, isDaemon: false });
        });

        child.on('error', (err) => {
            activeChildren.delete(child);
            if (activeThemeChild === child) activeThemeChild = null;
            console.error(`  [!] Failed to execute ${modDef.file}:`, err.message);
            finish({ success: false, isDaemon: false });
        });

        if (modDef.isDaemon) {
            child.on('message', (message) => {
                if (message && message.type === 'ready') {
                    finish({ success: true, isDaemon: false });
                }
            });
            startupTimer = setTimeout(() => {
                console.error(`  [!] ${modDef.name} did not become ready within 10 seconds.`);
                finish({ success: false, isDaemon: false });
            }, 10000);
        }
    });
}

async function main() {
    const args = process.argv.slice(2);

    if (args.includes('-h') || args.includes('--help')) {
        printHelp();
        process.exit(0);
    }

    const preset = readPresetArg(args);

    // Check for revert command
    const isRevert = args.includes('-r') || args.includes('--revert') || args.includes('revert');
    const shouldReload = args.includes('--reload');
    if (isRevert) {
        if (preset !== null) throw new Error('--preset cannot be combined with --revert.');
        await revertAll(shouldReload);
        process.exit(0);
    }

    // Parse custom config file path if specified
    let configFilePath = DEFAULT_CONFIG_FILE;
    const configFlagIdx = args.findIndex(a => a === '-c' || a === '--config');
    if (configFlagIdx !== -1) {
        if (!args[configFlagIdx + 1] || args[configFlagIdx + 1].startsWith('-')) {
            throw new Error('--config requires a configuration file path.');
        }
        configFilePath = args[configFlagIdx + 1];
    }

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
        if (arg === '--preset') {
            i++; // value was validated by readPresetArg
            continue;
        }
        if (arg.startsWith('--preset=')) continue;
        if (arg === '-a' || arg === '--all') continue;
        if (arg === '--reload' || arg === '--safe-mode' || arg === '--wait-for-client') continue;

        if (arg.startsWith('--no-')) {
            const id = normalizeModuleId(arg.slice(5));
            if (id) selected[id] = false;
        } else if (arg.startsWith('--')) {
            const id = normalizeModuleId(arg.slice(2));
            if (id) selected[id] = true;
        } else if (!arg.startsWith('-')) {
            const id = normalizeModuleId(arg);
            if (id) positionalModules.push(id);
        } else {
            throw new Error(`Unknown option "${arg}". Run node inject.js --help for available options.`);
        }
    }

    const config = loadConfig(configFilePath);

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
    if (args.includes('--safe-mode') && !finalEnabled.theme) {
        throw new Error('--safe-mode requires the theme module. Use node inject.js theme --safe-mode.');
    }
    if (preset !== null && !finalEnabled.theme) {
        throw new Error('--preset requires the theme module. Use node inject.js theme --preset ' + preset + '.');
    }

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

    // One-shot modules require a live window; the theme can wait and reconnect.
    if (enabledList.some(key => !MODULES[key].isDaemon)) {
        if (args.includes('--wait-for-client')) {
            const { waitForClient } = await import('./theme/control.mjs');
            if (!await waitForClient(getTargets, () => shuttingDown)) return;
        } else await getTargets();
    }

    for (let i = 0; i < enabledList.length; i++) {
        const mod = MODULES[enabledList[i]];
        console.log(`Injecting ${mod.name} (${mod.file})...`);
        const scriptArgs = [];
        if (mod.id === 'theme') {
            if (preset !== null) scriptArgs.push('--preset', preset);
            if (args.includes('--safe-mode')) scriptArgs.push('--safe-mode');
            if (!finalEnabled.font) scriptArgs.push('--no-font');
        }
        const result = await runChildScript(mod, scriptArgs);
        if (!result.success) throw new Error(`${mod.name} failed. Remaining modules were not started.`);
    }
    console.log('All selected modules injected successfully.');

}

main().catch(async (err) => {
    console.error('\n[!] Unexpected error:', err);
    process.exitCode = 1;
    await shutdown();
});
