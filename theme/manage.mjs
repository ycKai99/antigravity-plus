#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requestStop, stateDir } from './control.mjs';

const themeDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(themeDir);
const coreDir = path.join(themeDir, 'core');
const args = process.argv.slice(2);
const command = args[0] || 'help';
function option(name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}
function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function run(program, argv) {
  const result = spawnSync(program, argv, { encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(program + ' failed: ' + (result.stderr || result.stdout).trim());
  return result.stdout;
}
function coreManifest() {
  return {
    name: 'antigravity-plus-theme', version: '1',
    upstream: 'Anarcadia/chuanban-antigravity-theme-patch@b319dba8dcc4f8b5bef38aef810cb530ace192a8',
    files: Object.fromEntries(['daemon.mjs', 'runtime.js', 'theme.css', 'metrics.mjs'].map(file => [file, hash(path.join(coreDir, file))]))
  };
}
function integrity() {
  const expected = JSON.parse(fs.readFileSync(path.join(coreDir, 'manifest.json'), 'utf8'));
  const modified = Object.entries(expected.files).filter(([file, digest]) =>
    !fs.existsSync(path.join(coreDir, file)) || hash(path.join(coreDir, file)) !== digest
  ).map(([file]) => file);
  return { ok: modified.length === 0, modified, upstream: expected.upstream };
}
function fontDirs() {
  if (process.platform === 'win32') return [
    path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'),
    path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts')
  ];
  if (process.platform === 'darwin') return [path.join(os.homedir(), 'Library', 'Fonts'), '/Library/Fonts'];
  return [path.join(os.homedir(), '.local', 'share', 'fonts'), '/usr/share/fonts', '/usr/local/share/fonts'];
}
function channelInfo(channel) {
  const label = channel === 'insiders' ? 'Antigravity - Insiders' : 'Antigravity';
  const base = process.platform === 'win32' ? process.env.APPDATA :
    process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') :
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  const argvFile = path.join(os.homedir(), channel === 'insiders' ? '.antigravity-insiders' : '.antigravity', 'argv.json');
  const argvText = fs.existsSync(argvFile) ? fs.readFileSync(argvFile, 'utf8') : '';
  const match = argvText.match(/"remote-debugging-port"\s*:\s*(\d+)/);
  return {
    channel, portFile: path.join(base, label, 'DevToolsActivePort'), argvFile,
    fallbackPort: match ? Number(match[1]) : channel === 'insiders' ? 9223 : 9222
  };
}
function allowedPage(target) {
  if (target.type !== 'page' || !target.webSocketDebuggerUrl || String(target.title).includes('Launchpad')) return false;
  try {
    const url = new URL(target.url);
    return url.protocol === 'vscode-file:' ||
      (['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost'].includes(url.hostname));
  } catch { return false; }
}
async function targets() {
  const channel = option('--channel', 'auto');
  if (!['auto', 'stable', 'insiders'].includes(channel)) throw new Error('Invalid channel: ' + channel);
  const endpoints = channel === 'auto' ? [channelInfo('stable'), channelInfo('insiders')] : [channelInfo(channel)];
  const ports = new Set();
  for (const endpoint of endpoints) {
    if (fs.existsSync(endpoint.portFile)) {
      const port = Number(fs.readFileSync(endpoint.portFile, 'utf8').split(/\r?\n/)[0]);
      if (port > 0) ports.add(port);
    }
    ports.add(endpoint.fallbackPort);
  }
  const found = new Map();
  for (const port of ports) {
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(1500) });
      if (!response.ok) continue;
      const pages = await response.json();
      for (const page of pages.filter(allowedPage)) found.set(page.webSocketDebuggerUrl, page);
    } catch (error) {
      if (!(error instanceof TypeError) && error.name !== 'TimeoutError') throw error;
    }
  }
  return [...found.values()];
}
function inspect(page) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    const timer = setTimeout(() => { socket.close(); reject(new Error('CDP inspection timed out: ' + page.title)); }, 3000);
    socket.addEventListener('open', () => socket.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate', params: {
        expression: '({version:window.__ag_patch_version||null,style:!!document.getElementById("ag-custom-fonts"),preset:document.documentElement.getAttribute("data-ag-preset"),metrics:!!document.getElementById("ag-live-metrics-pill"),customStyle:!!document.getElementById("antigravity-user-custom-style")})',
        returnByValue: true
      }
    })));
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (message.error || message.result?.exceptionDetails) reject(new Error('CDP inspection failed: ' + page.title));
      else resolve({ id: page.id, title: page.title, ...message.result?.result?.value });
    });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed: ' + page.title)); });
  });
}
async function doctor() {
  let sqlite = false;
  try { sqlite = !!(await import('node:sqlite')).DatabaseSync; } catch { /* Theme works without SQLite. */ }
  const names = fontDirs().flatMap(dir => fs.existsSync(dir) ? fs.readdirSync(dir) : []);
  const core = integrity();
  const report = {
    ok: Number(process.versions.node.split('.')[0]) >= 22 && core.ok,
    node: process.versions.node, sqliteMetricsAvailable: sqlite, core,
    fonts: {
      anthropic: names.some(name => /anthropic/i.test(name)),
      sarasa: names.some(name => /sarasa|更纱/i.test(name)),
      mapleMono: names.some(name => /maple/i.test(name))
    },
    config: path.join(themeDir, 'user', 'config.json'),
    channels: [channelInfo('stable'), channelInfo('insiders')],
    workbenchPages: (await targets()).map(page => ({ id: page.id, title: page.title }))
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
async function verify() {
  const pages = await targets();
  const windows = await Promise.all(pages.map(inspect));
  const ok = windows.length > 0 && windows.every(window =>
    window.style && window.version?.startsWith('antigravity-plus-theme-v1-') &&
    ['high-contrast', 'claude-desktop-purewhite', 'vintage-deep', 'high-contrast-dark'].includes(window.preset));
  console.log(JSON.stringify({ ok, windows, scope: 'Runtime markers only; does not prove visual rendering or metric accuracy.' }, null, 2));
  if (!ok) process.exitCode = 1;
}
function ensureArgv() {
  const backupFile = path.join(stateDir, 'argv-backups.json');
  const records = fs.existsSync(backupFile) ? JSON.parse(fs.readFileSync(backupFile, 'utf8')) : [];
  const channel = JSON.parse(fs.readFileSync(path.join(themeDir, 'user', 'config.json'), 'utf8')).channel;
  for (const endpoint of [channelInfo('stable'), channelInfo('insiders')]) {
    if (channel !== 'auto' && channel !== endpoint.channel) continue;
    if (!fs.existsSync(path.dirname(endpoint.argvFile))) continue;
    const before = fs.existsSync(endpoint.argvFile) ? fs.readFileSync(endpoint.argvFile, 'utf8') : null;
    if (before && /"remote-debugging-port"\s*:/.test(before)) continue;
    let after;
    if (before === null) after = JSON.stringify({ 'remote-debugging-port': endpoint.fallbackPort }, null, 2) + '\n';
    else {
      const closing = before.lastIndexOf('}');
      if (closing < 0) throw new Error('Cannot patch argv JSON: ' + endpoint.argvFile);
      // Insert a leading property so trailing JSONC comments remain valid.
      const opening = before.indexOf('{');
      if (opening < 0) throw new Error('Cannot patch argv JSON: ' + endpoint.argvFile);
      const body = before.slice(opening + 1, closing);
      const withoutComments = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '').trim();
      const comma = withoutComments ? ',' : '';
      after = before.slice(0, opening + 1) + '\n  "remote-debugging-port": ' + endpoint.fallbackPort + comma + body + before.slice(closing);
    }
    if (!records.some(record => record.path === endpoint.argvFile)) {
      records.push({ path: endpoint.argvFile, before, after });
    }
    // Persist recovery data before changing launch configuration.
    fs.writeFileSync(backupFile, JSON.stringify(records, null, 2) + '\n');
    fs.writeFileSync(endpoint.argvFile, after);
  }
  return records.map(record => record.path);
}
function startupInfo() {
  if (process.platform === 'win32') return {
    file: path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'AntigravityPlus.vbs'),
    label: 'AntigravityPlus'
  };
  if (process.platform === 'darwin') return {
    file: path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.antigravity-plus.plist'), label: 'com.antigravity-plus'
  };
  return { file: path.join(os.homedir(), '.config', 'systemd', 'user', 'antigravity-plus.service'), label: 'antigravity-plus.service' };
}
function snapshotCore() {
  const previous = path.join(stateDir, 'installed-core');
  const manifest = path.join(coreDir, 'manifest.json');
  if (fs.existsSync(path.join(previous, 'manifest.json')) &&
      hash(path.join(previous, 'manifest.json')) !== hash(manifest)) {
    const backup = path.join(stateDir, 'backups', new Date().toISOString().replace(/[:.]/g, '-'));
    fs.cpSync(previous, backup, { recursive: true });
  }
  fs.cpSync(coreDir, previous, { recursive: true });
}
function xml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
async function install() {
  const check = integrity();
  if (!check.ok) throw new Error('Core integrity failed: ' + check.modified.join(', '));
  await requestStop();
  fs.mkdirSync(stateDir, { recursive: true });
  snapshotCore();
  const argvChanged = ensureArgv();
  const service = startupInfo();
  fs.mkdirSync(path.dirname(service.file), { recursive: true });
  const launcher = path.join(projectDir, 'inject.js');
  const config = path.join(projectDir, 'config.json');
  if (process.platform === 'win32') {
    const cmd = [process.execPath, launcher, '--config', config, '--wait-for-client'].map(value => '"' + value + '"').join(' ');
    fs.writeFileSync(service.file, '\uFEFFSet shell = CreateObject("WScript.Shell")\r\nshell.CurrentDirectory = "' +
      projectDir.replaceAll('"', '""') + '"\r\nshell.Run "' + cmd.replaceAll('"', '""') + '", 0, False\r\n', 'utf16le');
    const child = spawn(process.execPath, [launcher, '--config', config, '--wait-for-client'], {
      cwd: projectDir, detached: true, stdio: 'ignore', windowsHide: true
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
  } else if (process.platform === 'darwin') {
    const uid = process.getuid();
    fs.writeFileSync(service.file, '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>' +
      '<key>Label</key><string>' + service.label + '</string><key>ProgramArguments</key><array>' +
      [process.execPath, launcher, '--config', config, '--wait-for-client'].map(value => '<string>' + xml(value) + '</string>').join('') +
      '</array><key>WorkingDirectory</key><string>' + xml(projectDir) + '</string><key>RunAtLoad</key><true/>' +
      '<key>StandardOutPath</key><string>' + xml(path.join(stateDir, 'startup.log')) + '</string>' +
      '<key>StandardErrorPath</key><string>' + xml(path.join(stateDir, 'startup.err.log')) + '</string></dict></plist>');
    spawnSync('launchctl', ['bootout', 'gui/' + uid + '/' + service.label], { stdio: 'ignore' });
    run('launchctl', ['bootstrap', 'gui/' + uid, service.file]);
  } else if (process.platform === 'linux') {
    const quote = value => '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%') + '"';
    fs.writeFileSync(service.file, '[Unit]\nDescription=Antigravity Plus injector\n[Service]\nType=simple\nWorkingDirectory=' +
      quote(projectDir) + '\nExecStart=' + [process.execPath, launcher, '--config', config, '--wait-for-client'].map(quote).join(' ') +
      '\n[Install]\nWantedBy=default.target\n');
    run('systemctl', ['--user', 'daemon-reload']);
    run('systemctl', ['--user', 'enable', '--now', service.label]);
  } else throw new Error('Unsupported platform: ' + process.platform);
  console.log(JSON.stringify({ ok: true, service, argvChanged, projectDir,
    message: 'Autostart registered. Keep this directory. Restart Antigravity if remote debugging was just enabled, then run npm run inject.' }, null, 2));
}
async function uninstall() {
  await requestStop();
  const service = startupInfo();
  if (process.platform === 'darwin') {
    const domain = 'gui/' + process.getuid() + '/' + service.label;
    if (spawnSync('launchctl', ['print', domain], { stdio: 'ignore' }).status === 0) run('launchctl', ['bootout', domain]);
  } else if (process.platform === 'linux' && fs.existsSync(service.file)) {
    run('systemctl', ['--user', 'disable', service.label]);
  }
  if (fs.existsSync(service.file)) fs.unlinkSync(service.file);
  const backupFile = path.join(stateDir, 'argv-backups.json');
  const preserved = [];
  if (fs.existsSync(backupFile)) {
    const records = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
    for (const record of records) {
      if (fs.existsSync(record.path) && fs.readFileSync(record.path, 'utf8') === record.after) {
        if (record.before === null) fs.unlinkSync(record.path);
        else fs.writeFileSync(record.path, record.before);
      } else preserved.push(record);
    }
    fs.writeFileSync(backupFile, JSON.stringify(preserved, null, 2) + '\n');
  }
  console.log(JSON.stringify({ ok: true, preservedArgv: preserved.map(record => record.path),
    message: 'Autostart removed. User configuration and fonts preserved. Restart Antigravity to apply restored launch settings.' }, null, 2));
}
async function rollback() {
  const backups = path.join(stateDir, 'backups');
  const choices = fs.existsSync(backups) ? fs.readdirSync(backups).sort().reverse() : [];
  if (!choices.length) throw new Error('No previous installed core snapshot. Install an updated core to create a rollback snapshot.');
  await requestStop();
  const snapshot = path.join(backups, choices[0]);
  const expected = JSON.parse(fs.readFileSync(path.join(snapshot, 'manifest.json'), 'utf8'));
  for (const [file, digest] of Object.entries(expected.files)) {
    if (hash(path.join(snapshot, file)) !== digest) throw new Error('Backup integrity failed: ' + file);
  }
  fs.cpSync(snapshot, coreDir, { recursive: true });
  console.log(JSON.stringify({ ok: true, restoredFrom: snapshot, message: 'User files preserved. Run npm run inject to start the restored core.' }, null, 2));
}
function installFonts() {
  const from = option('--from');
  if (!from || !fs.statSync(from).isDirectory()) throw new Error('Usage: npm run theme:install-fonts -- --from <font-folder>');
  const destination = fontDirs()[0];
  fs.mkdirSync(destination, { recursive: true });
  const installed = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const source = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(source);
      else if (/\.(ttf|otf|ttc)$/i.test(entry.name)) {
        const target = path.join(destination, entry.name);
        fs.copyFileSync(source, target);
        if (process.platform === 'win32') run('reg', [
          'add', 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
          '/v', entry.name.replace(/\.(ttf|otf|ttc)$/i, '') + ' (TrueType)', '/t', 'REG_SZ', '/d', target, '/f'
        ]);
        installed.push(target);
      }
    }
  }
  walk(path.resolve(from));
  if (process.platform === 'linux') run('fc-cache', ['-f']);
  console.log(JSON.stringify({ ok: true, installed }, null, 2));
}

try {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js >=22 is required');
  switch (command) {
    case 'build-manifest': fs.writeFileSync(path.join(coreDir, 'manifest.json'), JSON.stringify(coreManifest(), null, 2) + '\n'); break;
    case 'doctor': await doctor(); break;
    case 'verify': await verify(); break;
    case 'install': await install(); break;
    case 'uninstall': await uninstall(); break;
    case 'rollback': await rollback(); break;
    case 'install-fonts': installFonts(); break;
    case 'help': console.log('Usage: node theme/manage.mjs doctor|verify|install|uninstall|rollback|install-fonts --from <folder>'); break;
    default: throw new Error('Unknown theme management command: ' + command);
  }
} catch (error) {
  console.error('[Theme] ' + error.message);
  process.exitCode = 1;
}

