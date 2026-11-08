import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { mockCdp, until } from './mock-cdp.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { DatabaseSync } = await import('node:sqlite').catch(() => ({}));
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-plus-daemon-'));
  fs.cpSync(path.join(root, 'theme'), path.join(dir, 'theme'), {
    recursive: true, filter: source => !source.includes(path.sep + '.state')
  });
  for (const file of ['inject-font.js', 'cdp.js']) fs.copyFileSync(path.join(root, file), path.join(dir, file));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}
function start(dir, server, extra = [], entry = 'theme/core/daemon.mjs') {
  const portFile = path.join(dir, 'port');
  fs.writeFileSync(portFile, String(server.port));
  const child = spawn(process.execPath, [entry, '--channel', 'stable', '--port-file', portFile, ...extra], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => stdout += data);
  child.stderr.on('data', data => stderr += data);
  const exited = new Promise(resolve => child.on('exit', code => resolve(code)));
  return { child, exited, stdout: () => stdout, stderr: () => stderr };
}

test('public theme entry exits with a metrics worker and preserves the injected UI on worker stop', { timeout: 15000 }, async t => {
  const dir = fixture(t), server = await mockCdp();
  t.after(() => server.close());
  fs.copyFileSync(path.join(root, 'inject-theme.mjs'), path.join(dir, 'inject-theme.mjs'));
  const proc = start(dir, server, [], 'inject-theme.mjs');
  t.after(() => { if (proc.child.exitCode === null) proc.child.kill(); });
  assert.equal(await proc.exited, 0, proc.stderr());
  assert.ok(server.requests.some(r => r.params?.expression?.includes('function applyTheme')));
  assert.equal(server.scripts.size, 0);
  assert.equal(server.requests.some(r => r.params?.expression === 'window.__antigravity_theme_dispose?.()'), false);
  const pid = path.join(dir, 'theme', '.state', 'daemon.pid');
  assert.equal(fs.existsSync(pid), true);
  fs.writeFileSync(path.join(dir, 'theme', '.state', 'stop'), 'stop');
  await until(() => !fs.existsSync(pid), 'metrics worker stopped');
  assert.equal(server.requests.some(r => r.params?.expression === 'window.__antigravity_theme_dispose?.()'), false);
});

test('one-shot injection waits through splash and empty target lists', { timeout: 10000 }, async t => {
  let polls = 0;
  const dir = fixture(t), server = await mockCdp({ targetList: targets => {
    polls++;
    if (polls === 1) return [{ ...targets[0], url: 'data:text/html,Loading' }, targets[1]];
    return polls === 2 ? [] : targets;
  } });
  t.after(() => server.close());
  const proc = start(dir, server, ['--once']);
  t.after(() => { if (proc.child.exitCode === null) proc.child.kill(); });
  assert.equal(await proc.exited, 0, proc.stderr());
  assert.ok(polls >= 3);
  assert.equal(server.requests.filter(r => r.params?.expression?.includes('function applyTheme')).length, 1);
});

test('one-shot injection waits for the application DOM on an existing localhost target', { timeout: 10000 }, async t => {
  let ready = false, checks = 0;
  const dir = fixture(t), server = await mockCdp({ workbenchReady: () => { checks++; return ready; } });
  t.after(() => server.close());
  const proc = start(dir, server, ['--once']);
  t.after(() => { if (proc.child.exitCode === null) proc.child.kill(); });
  await until(() => checks >= 2, 'loading document readiness checks');
  assert.equal(proc.child.exitCode, null);
  assert.equal(server.requests.some(r => r.params?.expression?.includes('function applyTheme')), false);
  ready = true;
  assert.equal(await proc.exited, 0, proc.stderr());
  assert.equal(server.requests.filter(r => r.params?.expression?.includes('function applyTheme')).length, 1);
});

test('metrics-only startup waits for a workbench without injecting the theme', { timeout: 10000 }, async t => {
  let polls = 0;
  const dir = fixture(t), server = await mockCdp({ targetList: targets => ++polls < 5 ? [] : targets });
  t.after(() => server.close());
  const proc = start(dir, server, ['--metrics-only']);
  t.after(() => { if (proc.child.exitCode === null) proc.child.kill(); });
  await until(() => server.requests.some(r => r.method === 'Runtime.addBinding'), 'delayed metrics attachment');
  assert.ok(polls >= 5);
  assert.equal(server.requests.some(r => r.params?.expression?.includes('function applyTheme')), false);
  fs.writeFileSync(path.join(dir, 'theme', '.state', 'stop'), 'stop');
  assert.equal(await proc.exited, 0, proc.stderr());
});

test('metrics-only startup fails after its bounded wait when no workbench appears', { timeout: 10000 }, async t => {
  const dir = fixture(t), server = await mockCdp({ empty: true });
  t.after(() => server.close());
  const proc = start(dir, server, ['--metrics-only']);
  t.after(() => { if (proc.child.exitCode === null) proc.child.kill(); });
  assert.notEqual(await proc.exited, 0);
  assert.match(proc.stderr(), /No Antigravity windows available for injection after waiting 5 seconds/);
  assert.equal(server.requests.length, 0);
  assert.equal(fs.existsSync(path.join(dir, 'theme', '.state', 'daemon.pid')), false);
});

test('metrics-only worker does not inject or watch files and exits after the client closes', { timeout: 15000 }, async t => {
  const dir = fixture(t), server = await mockCdp();
  const proc = start(dir, server, ['--metrics-only']);
  t.after(() => { if (proc.child.exitCode === null) proc.child.kill(); });
  t.after(() => server.close());
  await until(() => fs.existsSync(path.join(dir, 'theme', '.state', 'daemon.pid')), 'worker started');
  await until(() => server.requests.some(r => r.method === 'Runtime.addBinding'), 'metrics binding');
  fs.appendFileSync(path.join(dir, 'theme', 'user', 'custom.css'), '\n.worker-test {}');
  await server.close();
  assert.equal(await proc.exited, 0, proc.stderr());
  assert.equal(server.scripts.size, 0);
  assert.equal(server.requests.some(r => r.params?.expression?.includes('function applyTheme')), false);
});

test('metrics-only worker pushes changed SQLite metrics without re-injecting UI', { timeout: 15000, skip: !DatabaseSync }, async t => {
  const dir = fixture(t), cascadeId = '11111111-2222-3333-4444-555555555555';
  const server = await mockCdp({ cascadeId });
  t.after(() => server.close());
  const db = new DatabaseSync(path.join(dir, cascadeId + '.db'));
  db.exec('CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB); CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER)');
  // Protobuf: generation metadata -> usage -> input tokens.
  db.prepare('INSERT INTO gen_metadata VALUES (0, ?)').run(Buffer.from([10, 4, 34, 2, 16, 100]));
  db.close();
  const proc = start(dir, server, ['--metrics-only', '--conversations-dir', dir]);
  t.after(() => { if (proc.child.exitCode === null) proc.child.kill(); });
  const pushes = () => server.requests.filter(r => r.params?.expression?.startsWith('window.__ag_render_metrics &&'));
  await until(() => pushes().some(r => r.params.expression.includes('Ctx 100/')), 'initial metrics');
  const updated = new DatabaseSync(path.join(dir, cascadeId + '.db'));
  updated.prepare('UPDATE gen_metadata SET data = ?').run(Buffer.from([10, 4, 34, 2, 16, 120]));
  updated.close();
  await until(() => pushes().some(r => r.params.expression.includes('Ctx 120/')), 'changed metrics');
  assert.equal(server.requests.some(r => r.params?.expression?.includes('function applyTheme')), false);
  fs.writeFileSync(path.join(dir, 'theme', '.state', 'stop'), 'stop');
  assert.equal(await proc.exited, 0, proc.stderr());
});

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

