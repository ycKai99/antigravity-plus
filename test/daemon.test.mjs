import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { mockCdp, until } from './mock-cdp.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-plus-daemon-'));
  fs.cpSync(path.join(root, 'theme'), path.join(dir, 'theme'), {
    recursive: true, filter: source => !source.includes(path.sep + '.state')
  });
  for (const file of ['inject-font.js', 'cdp.js']) fs.copyFileSync(path.join(root, file), path.join(dir, file));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function start(dir, server, extra = []) {
  const portFile = path.join(dir, 'port');
  fs.writeFileSync(portFile, String(server.port));
  const child = spawn(process.execPath, ['theme/core/daemon.mjs', '--channel', 'stable', '--port-file', portFile, ...extra], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => stdout += data);
  child.stderr.on('data', data => stderr += data);
  const exited = new Promise(resolve => child.on('exit', code => resolve(code)));
  return { child, exited, stdout: () => stdout, stderr: () => stderr };
}

test('managed daemon replaces document scripts on hot reload and disposes before stopping', { timeout: 20000 }, async t => {
  const dir = fixture(t), server = await mockCdp();
  t.after(() => server.close());
  const proc = start(dir, server);
  t.after(() => { if (proc.child.exitCode === null) proc.child.kill(); });
  await until(() => server.requests.some(request => request.method === 'Runtime.evaluate' && request.params.expression.includes('function applyTheme')), 'initial injection');
  assert.equal(server.scripts.size, 1);
  const firstId = [...server.scripts.keys()][0];
  const configFile = path.join(dir, 'theme', 'user', 'config.json');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  config.preset = 'vintage-deep'; config.contextLimit = 128000;
  fs.writeFileSync(configFile, JSON.stringify(config));
  await until(() => server.requests.some(request => request.method === 'Page.removeScriptToEvaluateOnNewDocument'), 'script replacement');
  await until(() => server.requests.filter(request => request.method === 'Page.addScriptToEvaluateOnNewDocument').length === 2, 'new document script');
  assert.equal(server.scripts.size, 1);
  assert.notEqual([...server.scripts.keys()][0], firstId);
  const latest = [...server.scripts.values()][0];
  assert.ok(latest.includes('"contextLimit":128000'));
  assert.ok(latest.includes('"preset":"vintage-deep"'));
  assert.ok(latest.includes('Maple Mono NF'));
  assert.ok(!latest.includes('__ag_i18n'));
  fs.writeFileSync(path.join(dir, 'theme', '.state', 'stop'), 'stop');
  assert.equal(await proc.exited, 0);
  assert.equal(server.scripts.size, 0);
  assert.ok(server.requests.some(request => request.params?.expression === 'window.__antigravity_theme_dispose?.()'));
  assert.equal(fs.existsSync(path.join(dir, 'theme', '.state', 'daemon.pid')), false);
  assert.equal(proc.stderr().replace(/\(node:\d+\) ExperimentalWarning:[^\n]*\n/g, '').replace(/\(Use .*\n/g, '').trim(), '');
});

test('safe mode omits user CSS/JS and no-font omits typography', { timeout: 10000 }, async t => {
  const dir = fixture(t), server = await mockCdp(); t.after(() => server.close());
  fs.writeFileSync(path.join(dir, 'theme', 'user', 'custom.js'), 'window.userSecretMarker = true;');
  fs.writeFileSync(path.join(dir, 'theme', 'user', 'custom.css'), '.user-secret-marker { color: red; }');
  const proc = start(dir, server, ['--once', '--safe-mode', '--no-font']);
  assert.equal(await proc.exited, 0, proc.stderr());
  const injection = server.requests.find(request => request.method === 'Runtime.evaluate' && request.params.expression.includes('function applyTheme')).params.expression;
  assert.ok(!injection.includes('userSecretMarker'));
  assert.ok(!injection.includes('user-secret-marker'));
  assert.ok(!injection.includes('Maple Mono NF'));
  assert.ok(injection.includes('"preset":"high-contrast"'));
});

test('CDP script exceptions fail one-shot injection instead of reporting success', { timeout: 10000 }, async t => {
  const dir = fixture(t), server = await mockCdp({ failEvaluation: true }); t.after(() => server.close());
  const proc = start(dir, server, ['--once']);
  assert.notEqual(await proc.exited, 0);
  assert.match(proc.stderr(), /Fixture injection failure|failed to initialize/);
  assert.equal(fs.existsSync(path.join(dir, 'theme', '.state', 'daemon.pid')), false);
});

test('invalid theme configuration fails before connecting or creating a daemon state', async t => {
  const dir = fixture(t), server = await mockCdp(); t.after(() => server.close());
  const file = path.join(dir, 'theme', 'user', 'config.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8')); config.contextLimit = -1;
  fs.writeFileSync(file, JSON.stringify(config));
  const proc = start(dir, server);
  assert.notEqual(await proc.exited, 0);
  assert.match(proc.stderr(), /contextLimit must be a positive integer/);
  assert.equal(server.requests.length, 0);
  assert.equal(fs.existsSync(path.join(dir, 'theme', '.state')), false);
});

test('changing the discovered endpoint disposes the old live window before dropping it', { timeout: 15000 }, async t => {
  const dir = fixture(t), first = await mockCdp(), second = await mockCdp({ pageId: 'new-workbench' });
  t.after(() => first.close()); t.after(() => second.close());
  const proc = start(dir, first);
  t.after(() => { if (proc.child.exitCode === null) proc.child.kill(); });
  await until(() => first.scripts.size === 1, 'initial target');
  fs.writeFileSync(path.join(dir, 'port'), String(second.port));
  await until(() => second.scripts.size === 1 && first.scripts.size === 0, 'old target disposal');
  assert.ok(first.requests.some(request => request.params?.expression === 'window.__antigravity_theme_dispose?.()'));
  fs.writeFileSync(path.join(dir, 'theme', '.state', 'stop'), 'stop');
  assert.equal(await proc.exited, 0, proc.stderr());
  assert.equal(second.scripts.size, 0);
});

test('CLI preset keeps precedence across user configuration hot reloads', { timeout: 15000 }, async t => {
  const dir = fixture(t), server = await mockCdp(); t.after(() => server.close());
  const configFile = path.join(dir, 'theme', 'user', 'config.json');
  const before = fs.readFileSync(configFile, 'utf8');
  const proc = start(dir, server, ['--preset', 'claude-desktop-purewhite']);
  t.after(() => { if (proc.child.exitCode === null) proc.child.kill(); });
  await until(() => server.scripts.size === 1, 'initial preset');
  assert.ok([...server.scripts.values()][0].includes('"preset":"claude-desktop-purewhite"'));
  assert.equal(fs.readFileSync(configFile, 'utf8'), before);
  const config = JSON.parse(before); config.preset = 'vintage-deep'; config.contextLimit = 128000;
  const changed = JSON.stringify(config); fs.writeFileSync(configFile, changed);
  await until(() => server.requests.filter(request => request.method === 'Page.addScriptToEvaluateOnNewDocument').length === 2, 'configuration reload');
  const latest = [...server.scripts.values()][0];
  assert.ok(latest.includes('"preset":"claude-desktop-purewhite"'));
  assert.ok(latest.includes('"contextLimit":128000'));
  assert.equal(fs.readFileSync(configFile, 'utf8'), changed);
  fs.writeFileSync(path.join(dir, 'theme', '.state', 'stop'), 'stop');
  assert.equal(await proc.exited, 0, proc.stderr());
});

test('direct theme injection supports each preset, including safe mode', { timeout: 10000 }, async t => {
  for (const preset of ['high-contrast', 'claude-desktop-purewhite', 'vintage-deep']) {
    const dir = fixture(t), server = await mockCdp(); t.after(() => server.close());
    const proc = start(dir, server, ['--once', '--safe-mode', '--preset=' + preset]);
    assert.equal(await proc.exited, 0, proc.stderr());
    const injection = server.requests.find(request => request.method === 'Runtime.evaluate' &&
      request.params.expression.includes('function applyTheme')).params.expression;
    assert.ok(injection.includes('"preset":"' + preset + '"'));
  }
});

test('direct theme injection rejects invalid or missing preset values before CDP access', { timeout: 10000 }, async t => {
  for (const flags of [['--preset'], ['--preset', '--once'], ['--preset=unknown']]) {
    const dir = fixture(t), server = await mockCdp(); t.after(() => server.close());
    const proc = start(dir, server, flags);
    assert.notEqual(await proc.exited, 0);
    assert.match(proc.stderr(), /requires a preset name|Invalid theme preset/);
    assert.equal(server.requests.length, 0);
    assert.equal(fs.existsSync(path.join(dir, 'theme', '.state')), false);
  }
});

