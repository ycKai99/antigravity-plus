#!/usr/bin/env node
/**
 * Antigravity Plus managed theme and session metrics daemon.
 * Adapted from Chuanban v5.0.0; see ../UPSTREAM.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pidFile, stopFile, stateDir, requestStop } from '../control.mjs';
import { createMetricsReader } from './metrics.mjs';
import fontModule from '../../inject-font.js';
import presetOptions from '../presets.cjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const CORE_DIR = path.join(ROOT_DIR, 'core');
const USER_DIR = path.join(ROOT_DIR, 'user');

// ============================================================================
// 0. 动态探测 node:sqlite（Node >= 22.13 自动解锁，低版本优雅降级）
// ============================================================================
let DatabaseSync = null;
try {
  const sqliteMod = await import('node:sqlite').catch(() => null);
  if (sqliteMod && typeof sqliteMod.DatabaseSync === 'function') {
    DatabaseSync = sqliteMod.DatabaseSync;
  }
} catch {
  DatabaseSync = null;
}

// ============================================================================
// 1. CLI 参数解析（同时兼容 --flag value 与 --flag=value）与跨平台路径探测
// ============================================================================
const args = process.argv.slice(2);
const hasFlag = (f) => args.some((a) => a === f || a.startsWith(f + '='));
function getArg(flag, fallback = null) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) return args[i + 1];
    if (args[i].startsWith(flag + '=')) return args[i].slice(flag.length + 1);
  }
  return fallback;
}

const SAFE_MODE = hasFlag('--safe-mode');
const RUN_ONCE = hasFlag('--once');
const CLI_CHANNEL = getArg('--channel', null);
const CLI_PRESET = presetOptions.readPresetArg(args);

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (error) { throw new Error('Cannot read JSON ' + filePath + ': ' + error.message); }
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

const DEFAULT_MODULES = {
  metrics: true, composerWaxSeal: true, deadlockHealer: true, customCss: true, customJs: true
};
const { PRESETS } = presetOptions;

function loadUserConfig() {
  const user = SAFE_MODE ? {} : readJson(path.join(USER_DIR, 'config.json'));
  if (!user || typeof user !== 'object' || Array.isArray(user)) throw new Error('Theme config must be an object');
  const cfg = {
    enabled: true, channel: 'auto', preset: 'high-contrast', contextLimit: 256000,
    themeVars: {}, selectors: {}, ...user,
    modules: { ...DEFAULT_MODULES, ...user.modules }
  };
  if (CLI_PRESET !== null) cfg.preset = CLI_PRESET;
  if (typeof cfg.enabled !== 'boolean') throw new Error('Theme enabled must be boolean');
  if (!['auto', 'stable', 'insiders'].includes(cfg.channel)) throw new Error('Invalid theme channel: ' + cfg.channel);
  if (!PRESETS.includes(cfg.preset)) throw new Error('Invalid theme preset: ' + cfg.preset);
  if (!Number.isSafeInteger(cfg.contextLimit) || cfg.contextLimit <= 0) throw new Error('contextLimit must be a positive integer');
  if (user.modules !== undefined && (!user.modules || typeof user.modules !== 'object' || Array.isArray(user.modules))) {
    throw new Error('Theme modules must be an object');
  }
  for (const [key, value] of Object.entries(cfg.modules)) {
    if (!(key in DEFAULT_MODULES) || typeof value !== 'boolean') throw new Error('Invalid theme module: ' + key);
  }
  if (!cfg.themeVars || typeof cfg.themeVars !== 'object' || Array.isArray(cfg.themeVars)) throw new Error('themeVars must be an object');
  for (const [key, value] of Object.entries(cfg.themeVars)) {
    if (!/^--[a-zA-Z0-9_-]+$/.test(key) || typeof value !== 'string') throw new Error('Invalid theme variable: ' + key);
  }
  if (!cfg.selectors || typeof cfg.selectors !== 'object' || Array.isArray(cfg.selectors)) throw new Error('selectors must be an object');
  for (const [key, value] of Object.entries(cfg.selectors)) {
    if (!['inputBoxId', 'branchPillInBox', 'homeGreeting'].includes(key) || typeof value !== 'string' || !value.trim()) {
      throw new Error('Invalid theme selector: ' + key);
    }
  }
  return cfg;
}

function resolveChannelPaths(singleChannel = 'stable', userCfg = {}) {
  const home = os.homedir();
  const isInsiders = singleChannel === 'insiders';
  const appDirName = isInsiders ? 'Antigravity - Insiders' : 'Antigravity';
  const geminiSubDir = isInsiders ? '.gemini/antigravity-insiders' : '.gemini/antigravity';

  let defaultPortFile;
  if (process.platform === 'darwin') {
    defaultPortFile = path.join(home, 'Library', 'Application Support', appDirName, 'DevToolsActivePort');
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    defaultPortFile = path.join(appData, appDirName, 'DevToolsActivePort');
  } else {
    const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    defaultPortFile = path.join(xdgConfig, appDirName, 'DevToolsActivePort');
  }

  const defaultConvDir = path.join(home, geminiSubDir, 'conversations');
  const dotDir = path.join(home, isInsiders ? '.antigravity-insiders' : '.antigravity');
  const argvPath = path.join(dotDir, 'argv.json');
  let fallbackPort = isInsiders ? 9223 : 9222;
  try {
    if (fs.existsSync(argvPath)) {
      const m = fs.readFileSync(argvPath, 'utf8').match(/"remote-debugging-port"\s*:\s*(\d+)/);
      if (m && parseInt(m[1], 10) > 0) fallbackPort = parseInt(m[1], 10);
    }
  } catch {}

  const portFile = getArg('--port-file', userCfg.portFile || defaultPortFile);
  const channelInstalled =
    fs.existsSync(portFile) || fs.existsSync(path.dirname(defaultPortFile)) || fs.existsSync(dotDir);

  return {
    channel: singleChannel,
    portFile,
    fallbackPort: Number(userCfg.fallbackPort) > 0 ? Number(userCfg.fallbackPort) : fallbackPort,
    channelInstalled,
    conversationsDir: getArg('--conversations-dir', userCfg.conversationsDir || defaultConvDir)
  };
}

function resolveActiveChannelEndpoints(channelMode = 'auto', userCfg = {}) {
  const explicitPortFile = getArg('--port-file', userCfg.portFile || '');
  if (explicitPortFile) {
    const ch = channelMode === 'insiders' ? 'insiders' : 'stable';
    return [resolveChannelPaths(ch, userCfg)];
  }
  if (channelMode === 'stable') {
    return [resolveChannelPaths('stable', userCfg)];
  }
  if (channelMode === 'insiders') {
    return [resolveChannelPaths('insiders', userCfg)];
  }
  // 'auto' 或 'both'：同时轮询 Stable 与 Insiders 两个通道，互不抢占
  return [resolveChannelPaths('stable', userCfg), resolveChannelPaths('insiders', userCfg)];
}

// ============================================================================
// 2. 动态构建注入载荷（支持 core/ + user/ 实时合并与热更新签名）
// ============================================================================
const BASE_VERSION = 'antigravity-plus-theme-v1';
let cachedBundleSig = '';
let cachedInjectScript = '';
let cachedPatchVersion = '';
let activeConfig;

function getFileMtimeSig(filePath) {
  try {
    if (!fs.existsSync(filePath)) return '0:0';
    const st = fs.statSync(filePath);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return '0:0';
  }
}

function rebuildBundleIfNeeded() {
  const coreFiles = [
    path.join(CORE_DIR, 'theme.css'),
    path.join(CORE_DIR, 'runtime.js')
  ];
  const userFiles = SAFE_MODE
    ? []
    : [
        path.join(USER_DIR, 'config.json'),
        path.join(USER_DIR, 'custom.css'),
        path.join(USER_DIR, 'custom.js')
      ];

  const sig = [...coreFiles, ...userFiles].map(getFileMtimeSig).join('|') + `|safe:${SAFE_MODE}|cli:${CLI_CHANNEL || ''}|preset:${CLI_PRESET || ''}`;
  if (sig === cachedBundleSig && cachedInjectScript) {
    return false;
  }

  const userCfg = loadUserConfig();
  const { enabled, preset, contextLimit, themeVars } = userCfg;
  const channel = CLI_CHANNEL || userCfg.channel;
  if (!['auto', 'stable', 'insiders'].includes(channel)) throw new Error('Invalid channel: ' + channel);
  const modules = { ...userCfg.modules };
  if (!DatabaseSync) modules.metrics = false;
  const endpoints = resolveActiveChannelEndpoints(channel, userCfg);
  activeConfig = { ...userCfg, enabled, channel, preset, contextLimit, modules, themeVars,
    endpoints
  };
  const baseCss = readText(path.join(CORE_DIR, 'theme.css'));
  const customCss = !SAFE_MODE && modules.customCss ? readText(path.join(USER_DIR, 'custom.css')) : '';
  const customJs = !SAFE_MODE && modules.customJs ? readText(path.join(USER_DIR, 'custom.js')) : '';
  const runtimeTemplate = readText(path.join(CORE_DIR, 'runtime.js'));

  const hash = crypto
    .createHash('sha256')
    .update(String(enabled))
    .update(runtimeTemplate)
    .update(baseCss)
    .update(hasFlag('--no-font') ? '' : fontModule.fontCss)
    .update(customCss)
    .update(customJs)
    .update(JSON.stringify({ preset, contextLimit, modules, themeVars, selectors: activeConfig.selectors }))
    .digest('hex')
    .slice(0, 8);

  cachedPatchVersion = `${BASE_VERSION}-${channel}-${hash}`;

  const bootPayload = {
    version: cachedPatchVersion,
    platform: process.platform,
    enabled,
    preset,
    cssText: baseCss,
    fontCss: hasFlag('--no-font') ? '' : fontModule.fontCss,
    customCss,
    themeVars,
    modules,
    selectors: activeConfig.selectors,
    config: {
      enabled,
      channel,
      preset,
      contextLimit,
      modules,
      themeVars
    },
    customJs
  };

  cachedInjectScript = runtimeTemplate.replace('})(__AG_BOOT_PAYLOAD__);', () => `})(${JSON.stringify(bootPayload)});`);
  cachedBundleSig = sig;
  return true;
}

rebuildBundleIfNeeded();

// ============================================================================
// 3. 单实例 PID 锁（防止重复启动守护进程）
// ============================================================================
if (!RUN_ONCE) {
  await requestStop();
  fs.rmSync(stopFile, { force: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(pidFile, String(process.pid), { flag: 'wx' });
}
function cleanPid() {
  if (fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').trim() === String(process.pid)) fs.unlinkSync(pidFile);
}
process.on('exit', cleanPid);
process.on('SIGINT', () => { shutdown().catch(error => { console.error(error); process.exit(1); }); });
process.on('SIGTERM', () => { shutdown().catch(error => { console.error(error); process.exit(1); }); });

// ============================================================================
// 4. SQLite + Protobuf 实时会话指标解析器（读取 ~/.gemini/antigravity/conversations/<id>.db）
// ============================================================================
const { signature: getDbSignature, read: parseConversationMetrics } = createMetricsReader(DatabaseSync);

// ============================================================================
// 5. CDP 目标发现、WebSocket 会话挂载与热更新推送
// ============================================================================
const attachedTargets = new Map();

function readPort(portFile) {
  try {
    if (!fs.existsSync(portFile)) return null;
    const raw = fs.readFileSync(portFile, 'utf8').trim();
    const lines = raw.split(/\r?\n/);
    const port = parseInt(lines[0], 10);
    return Number.isFinite(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

function fetchTargets(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/json/list', timeout: 1500 },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve([]);
          }
        });
      }
    );
    req.on('error', () => resolve([]));
    req.on('timeout', () => {
      req.destroy();
      resolve([]);
    });
  });
}

function isAllowedOrigin(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  try {
    const url = new URL(urlStr);
    return url.protocol === 'vscode-file:' ||
      (['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost'].includes(url.hostname));
  } catch { return false; }
}

function attachTarget(target, endpoint) {
  const wsUrl = target.webSocketDebuggerUrl;
  if (!wsUrl) return Promise.resolve(false);

  return new Promise((resolveAttach) => {
    let settled = false;
    const finishAttach = (ok) => {
      if (!settled) {
        settled = true;
        resolveAttach(ok);
      }
    };
    const attachTimeout = setTimeout(() => finishAttach(false), 2500);

    try {
      const ws = new WebSocket(wsUrl);
      let msgId = 1;
      let activeCascadeId = '';
      let lastPushedHash = '';
      let newDocumentScriptId = null;
      const updateDocumentScript = async () => {
        if (newDocumentScriptId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: newDocumentScriptId });
        const response = await send('Page.addScriptToEvaluateOnNewDocument', { source: cachedInjectScript });
        newDocumentScriptId = response?.result?.identifier || null;
        if (!newDocumentScriptId) throw new Error('Failed to register theme document script');
      };
      const pendingCallbacks = new Map();

      const send = (method, params = {}) =>
        new Promise((resolve) => {
          if (ws.readyState !== WebSocket.OPEN) return resolve(null);
          const id = msgId++;
          const timer = setTimeout(() => {
            pendingCallbacks.delete(id);
            resolve(null);
          }, 2500);
          pendingCallbacks.set(id, (msg) => {
            clearTimeout(timer);
            resolve(msg);
          });
          ws.send(JSON.stringify({ id, method, params }));
        });

      const inject = async () => {
        const res = await send('Runtime.evaluate', {
          expression: cachedInjectScript,
          returnByValue: true
        });
        if (!res) {
          console.error(`[Theme] Injection timed out on ${target.id}`);
          return false;
        } else if (res.error) {
          console.error(`[Daemon] Injection error on ${target.id}:`, res.error.message || res.error);
          return false;
        } else if (res?.result?.exceptionDetails) {
          console.error(
            `[Daemon] Injection failed on ${target.id}: Script Exception:`,
            res.result.exceptionDetails.exception?.description || res.result.exceptionDetails.text
          );
          return false;
        } else {
          console.log(`[Daemon] Injected (${cachedPatchVersion}) into target ${target.id} [${endpoint.channel}]`);
          return true;
        }
      };

      const syncMetricsForSession = async (force = false) => {
        if (!DatabaseSync || !activeConfig.modules.metrics || !activeConfig.enabled) return;

        // 仅在尚未获知 activeCascadeId 或强制重同步时向前端发起 Runtime.evaluate，日常靠 __agRequestMetrics 绑定事件实时驱动
        if (!activeCascadeId || force) {
          const evalRes = await send('Runtime.evaluate', {
            expression: `(function(){
              if (window.__ag_watched_cascade_id) return window.__ag_watched_cascade_id;
              const m = window.location.pathname.match(/\\/c\\/([0-9a-f-]{36})/i);
              if (m) return m[1];
              const el = document.querySelector('[data-testid=conversation-row-sidebar][data-selected=true]');
              return el ? (el.getAttribute('data-cascade-id') || '') : '';
            })()`,
            returnByValue: true
          });
          const detected = evalRes?.result?.result?.value;
          if (detected && /^[0-9a-f-]{36}$/i.test(detected)) {
            activeCascadeId = detected;
          }
        }
        if (!activeCascadeId) return;

        // 先在 Node 本地通过 statSync 检查 .db/.db-wal 签名，未变化则 0 WebSocket 通信直接返回
        const sig = getDbSignature(activeCascadeId, endpoint.conversationsDir) || 'empty';
        const sessionKey = `${activeCascadeId}@${sig}|context:${activeConfig.contextLimit}`;
        if (!force && sessionKey === lastPushedHash) return;

        const payload = parseConversationMetrics(activeCascadeId, endpoint.conversationsDir, activeConfig.contextLimit);
        if (!payload) return;

        await send('Runtime.evaluate', {
          expression: `window.__ag_render_metrics && window.__ag_render_metrics(${JSON.stringify(payload)})`,
          returnByValue: false
        });
        lastPushedHash = sessionKey;
      };

      const checkAndInject = async () => {
        try {
          const checkRes = await send('Runtime.evaluate', {
            expression:
              'window.__ag_patch_version === ' +
              JSON.stringify(cachedPatchVersion) +
              ' && (' +
              JSON.stringify(!activeConfig.enabled) +
              ' || !!document.getElementById("ag-custom-fonts"))',
            returnByValue: true
          });
          if (checkRes?.result?.result?.value !== true) {
            const ok = await inject();
            if (!ok) throw new Error('Theme injection failed');
            await syncMetricsForSession(true);
          }
        } catch (error) { console.error('[Theme] Refresh failed:', error.message); }
      };

      let initialAttachDone = false;
      let navDebounceTimer = null;

      ws.addEventListener('open', async () => {
        try {
        console.log(`[Daemon] Attached target: ${target.id} (${target.title || 'Untitled'}) [${endpoint.channel}]`);
        await send('Page.enable');
        await send('Runtime.enable');
        await send('Runtime.addBinding', { name: '__agRequestMetrics' });
        if (!RUN_ONCE) await updateDocumentScript();
        const ok = await inject();
        if (!ok) {
          if (newDocumentScriptId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: newDocumentScriptId });
          await send('Runtime.evaluate', { expression: 'window.__antigravity_theme_dispose?.()', returnByValue: true });
          ws.close();
          finishAttach(false);
          return;
        }
        await syncMetricsForSession(true);
        initialAttachDone = true;
        clearTimeout(attachTimeout);
        finishAttach(ok);
        } catch (error) {
          console.error('[Theme] Attach failed:', error.message);
          ws.close();
          finishAttach(false);
        }
      });

      ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          if (msg.id && pendingCallbacks.has(msg.id)) {
            const cb = pendingCallbacks.get(msg.id);
            pendingCallbacks.delete(msg.id);
            cb(msg);
            return;
          }
          if (
            msg.method === 'Runtime.bindingCalled' &&
            msg.params?.name === '__agRequestMetrics'
          ) {
            const nextId = String(msg.params.payload || '').trim();
            if (/^[0-9a-f-]{36}$/i.test(nextId)) {
              activeCascadeId = nextId;
              lastPushedHash = '';
              syncMetricsForSession(true);
            }
            return;
          }
          if (!initialAttachDone) return;
          if (
            msg.method === 'Page.frameNavigated' ||
            msg.method === 'Page.loadEventFired' ||
            msg.method === 'Page.domContentEventFired'
          ) {
            if (!msg.params?.frame || !msg.params.frame.parentId) {
              if (navDebounceTimer) clearTimeout(navDebounceTimer);
              navDebounceTimer = setTimeout(() => {
                navDebounceTimer = null;
                checkAndInject();
              }, 120);
            }
          }
        } catch {}
      });

      const closeHandler = () => {
        clearTimeout(attachTimeout);
        for (const [, cb] of pendingCallbacks) cb(null);
        pendingCallbacks.clear();
        attachedTargets.delete(target.id);
        finishAttach(false);
      };
      ws.addEventListener('close', closeHandler);
      ws.addEventListener('error', closeHandler);

      attachedTargets.set(target.id, {
        ws,
        send,
        inject,
        checkAndInject,
        syncMetricsForSession,
        updateDocumentScript,
        dispose: async () => {
          if (navDebounceTimer) clearTimeout(navDebounceTimer);
          if (newDocumentScriptId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: newDocumentScriptId });
          await send('Runtime.evaluate', { expression: 'window.__antigravity_theme_dispose?.()', returnByValue: true });
          ws.close();
        },
        endpoint,
        setActiveCascade: (cid) => {
          activeCascadeId = cid;
          lastPushedHash = '';
        }
      });
    } catch {
      clearTimeout(attachTimeout);
      finishAttach(false);
    }
  });
}

let shuttingDown = false;
let interval = null;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (interval) clearInterval(interval);
  while (isSyncing) await new Promise(resolve => setTimeout(resolve, 25));
  await Promise.allSettled([...attachedTargets.values()].map(entry => entry.dispose()));
  cleanPid();
  process.exit(0);
}

let isSyncing = false;
let syncTickCount = 0;
async function sync() {
  if (!RUN_ONCE && fs.existsSync(stopFile)) { await shutdown(); return; }
  if (isSyncing || shuttingDown) return;
  isSyncing = true;
  syncTickCount = (syncTickCount + 1) % 6000;
  try {
    const bundleChanged = rebuildBundleIfNeeded();
    const shouldHeartbeatCheck = bundleChanged || syncTickCount % 6 === 1;

    const activeTargetIds = new Set();
    const attachPromises = [];

    const probedPorts = new Set();
    for (const endpoint of activeConfig.endpoints) {
      let port = readPort(endpoint.portFile);
      let targets = [];
      if (port && !probedPorts.has(port)) {
        probedPorts.add(port);
        targets = await fetchTargets(port);
      }
      if (
        targets.length === 0 &&
        endpoint.channelInstalled !== false &&
        endpoint.fallbackPort &&
        !probedPorts.has(endpoint.fallbackPort)
      ) {
        probedPorts.add(endpoint.fallbackPort);
        targets = await fetchTargets(endpoint.fallbackPort);
      }
      if (targets.length === 0) continue;

      const pages = targets.filter(
        (t) =>
          t.type === 'page' &&
          t.webSocketDebuggerUrl &&
          !String(t.url || '').startsWith('devtools://') &&
          isAllowedOrigin(t.url) &&
          !String(t.title || '').includes('Launchpad')
      );

      for (const page of pages) {
        activeTargetIds.add(page.id);
        if (!attachedTargets.has(page.id)) {
          attachPromises.push(attachTarget(page, endpoint));
        } else {
          const entry = attachedTargets.get(page.id);
          if (bundleChanged && entry.send) {
            await entry.updateDocumentScript();
          }
          if (shouldHeartbeatCheck && entry.checkAndInject) await entry.checkAndInject();
          if (entry.syncMetricsForSession) await entry.syncMetricsForSession(bundleChanged);
        }
      }
    }

    if (attachPromises.length > 0) {
      const results = await Promise.allSettled(attachPromises);
      if (results.some(result => result.status === 'rejected' || result.value !== true)) {
        throw new Error('One or more theme windows failed to initialize');
      }
    }

    // 清理已关闭的目标连接
    for (const [id, entry] of attachedTargets.entries()) {
      if (!activeTargetIds.has(id)) {
        try {
          await entry.dispose();
        } catch {}
        attachedTargets.delete(id);
      }
    }
  } finally {
    isSyncing = false;
  }
}

console.log(
  `[Antigravity Daemon] Started (${cachedPatchVersion}) | channel=${activeConfig.channel} | sqlite=${!!DatabaseSync} | safeMode=${SAFE_MODE}`
);

await sync();
process.send?.({ type: 'ready' });
if (RUN_ONCE) {
  for (const [, entry] of attachedTargets.entries()) {
    try {
      entry.ws.close();
    } catch {}
  }
  process.exit(0);
} else {
  interval = setInterval(() => { sync().catch(error => console.error('[Theme] Sync failed:', error.message)); }, 2500);
}

