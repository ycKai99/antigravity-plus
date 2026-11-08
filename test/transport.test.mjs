import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { mockCdp, until } from './mock-cdp.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-plus-transport-'));
  for (const file of ['inject.js', 'inject-limits.js', 'inject-font.js', 'inject-theme.mjs', 'cdp.js', 'config.json']) fs.copyFileSync(path.join(root, file), path.join(dir, file));
  fs.cpSync(path.join(root, 'theme'), path.join(dir, 'theme'), { recursive: true, filter: source => !source.includes(path.sep + '.state') });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}
function portFile(dir, name, port) {
  const parent = path.join(dir, 'appdata', name);
  fs.mkdirSync(parent, { recursive: true });
  fs.writeFileSync(path.join(parent, 'DevToolsActivePort'), String(port));
}
function start(t, dir, args) {
  const child = spawn(process.execPath, ['inject.js', ...args], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOME: dir, USERPROFILE: dir, APPDATA: path.join(dir, 'appdata'),
      XDG_CONFIG_HOME: path.join(dir, 'appdata') }
  });
  let output = '';
  child.stdout.on('data', data => output += data);
  child.stderr.on('data', data => output += data);
  const exited = new Promise(resolve => child.on('exit', code => resolve(code)));
  t.after(() => { if (child.exitCode === null) child.kill(); });
  return { child, exited, output: () => output };
}

test('retained font injection discovers both channels and excludes external targets', { timeout: 10000 }, async t => {
  const dir = fixture(t), stable = await mockCdp(), insiders = await mockCdp();
  t.after(() => stable.close()); t.after(() => insiders.close());
  portFile(dir, 'Antigravity', stable.port); portFile(dir, 'Antigravity - Insiders', insiders.port);
  const proc = start(t, dir, ['font']);
  assert.equal(await proc.exited, 0, proc.output());
  for (const server of [stable, insiders]) {
    const evaluations = server.requests.filter(request => request.method === 'Runtime.evaluate' && !request.params.expression.startsWith('(document.readyState'));
    assert.equal(evaluations.length, 1);
    assert.match(evaluations[0].params.expression, /Maple Mono NF/);
  }
});

test('retained injector propagates actual CDP exceptions to the runner', { timeout: 10000 }, async t => {
  const dir = fixture(t), server = await mockCdp({ failEvaluation: true }); t.after(() => server.close());
  portFile(dir, 'Antigravity', server.port);
  const proc = start(t, dir, ['font']);
  assert.notEqual(await proc.exited, 0);
  assert.match(proc.output(), /Fixture injection failure/);
  assert.doesNotMatch(proc.output(), /All selected modules injected successfully/);
});

test('autostart waits for a delayed workbench then runs the configured one-shot module', { timeout: 10000 }, async t => {
  const dir = fixture(t), server = await mockCdp(); t.after(() => server.close());
  const proc = start(t, dir, ['font', '--wait-for-client']);
  const waiting = path.join(dir, 'theme', '.state', 'waiting-runner.pid');
  await until(() => fs.existsSync(waiting), 'waiting runner PID');
  assert.equal(server.requests.length, 0);
  portFile(dir, 'Antigravity', server.port);
  assert.equal(await proc.exited, 0, proc.output());
  assert.ok(server.requests.some(request => request.method === 'Runtime.evaluate'));
  assert.equal(fs.existsSync(waiting), false);
});

test('uninstall/revert stop requests also stop a runner waiting for the client', { timeout: 10000 }, async t => {
  const dir = fixture(t), proc = start(t, dir, ['font', '--wait-for-client']);
  const waiting = path.join(dir, 'theme', '.state', 'waiting-runner.pid');
  await until(() => fs.existsSync(waiting), 'waiting runner');
  const control = await import(pathToFileURL(path.join(dir, 'theme', 'control.mjs')));
  await control.requestStop();
  assert.equal(await proc.exited, 0, proc.output());
  assert.equal(fs.existsSync(waiting), false);
});

test('runner forwards split and equals preset arguments to the theme without changing configuration', { timeout: 15000 }, async t => {
  for (const [preset, flag] of [
    ['claude-desktop-purewhite', ['--preset', 'claude-desktop-purewhite']],
    ['vintage-deep', ['--preset=vintage-deep']]
  ]) {
    const dir = fixture(t), server = await mockCdp(); t.after(() => server.close());
    portFile(dir, 'Antigravity', server.port);
    const configFile = path.join(dir, 'theme', 'user', 'config.json');
    const before = fs.readFileSync(configFile, 'utf8');
    const proc = start(t, dir, ['theme', ...flag]);
    await until(() => server.requests.some(request => request.method === 'Runtime.evaluate' &&
      request.params.expression.includes('function applyTheme')), 'preset injection');
    const injection = server.requests.find(request => request.method === 'Runtime.evaluate' &&
      request.params.expression.includes('function applyTheme')).params.expression;
    assert.ok(injection.includes('"preset":"' + preset + '"'));
    assert.equal(fs.readFileSync(configFile, 'utf8'), before);
    assert.equal(await proc.exited, 0, proc.output());
    const control = await import(pathToFileURL(path.join(dir, 'theme', 'control.mjs')));
    await control.requestStop();
  }
});

test('launch runner tolerates window transitions after preflight and before metrics startup', { timeout: 15000 }, async t => {
  let polls = 0;
  const dir = fixture(t), server = await mockCdp({ targetList: targets => {
    polls++;
    if (polls === 2) return [{ ...targets[0], url: 'data:text/html,Loading' }, targets[1]];
    return [3, 5, 6].includes(polls) ? [] : targets;
  } });
  t.after(() => server.close());
  portFile(dir, 'Antigravity', server.port);
  const proc = start(t, dir, ['theme', '--wait-for-client']);
  assert.equal(await proc.exited, 0, proc.output());
  const control = await import(pathToFileURL(path.join(dir, 'theme', 'control.mjs')));
  await control.requestStop();
  assert.ok(polls >= 7);
  assert.equal(server.requests.filter(r => r.params?.expression?.includes('function applyTheme')).length, 1);
  assert.match(proc.output(), /All selected modules injected successfully/);
});

test('launch runner leaves the bootstrap document untouched until the application is ready', { timeout: 15000 }, async t => {
  let ready = false, checks = 0;
  const dir = fixture(t), server = await mockCdp({ workbenchReady: () => { checks++; return ready; } });
  t.after(() => server.close());
  portFile(dir, 'Antigravity', server.port);
  const proc = start(t, dir, ['--wait-for-client']);
  await until(() => checks >= 1, 'bootstrap readiness check');
  assert.equal(proc.child.exitCode, null);
  assert.equal(server.requests.some(r => r.params?.expression?.includes('Maple Mono NF')), false);
  assert.equal(server.requests.some(r => r.params?.expression?.includes('function applyTheme')), false);
  ready = true;
  assert.equal(await proc.exited, 0, proc.output());
  const control = await import(pathToFileURL(path.join(dir, 'theme', 'control.mjs')));
  await control.requestStop();
  assert.equal(server.requests.filter(r => r.params?.expression?.includes('function applyTheme')).length, 1);
  assert.match(proc.output(), /All selected modules injected successfully/);
});

