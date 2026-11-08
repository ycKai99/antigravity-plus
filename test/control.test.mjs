import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-plus-control-'));
  const theme = path.join(dir, 'theme');
  fs.mkdirSync(path.join(theme, 'core'), { recursive: true });
  fs.copyFileSync(path.join(root, 'theme', 'control.mjs'), path.join(theme, 'control.mjs'));
  const control = await import(pathToFileURL(path.join(theme, 'control.mjs')));
  fs.mkdirSync(control.stateDir);
  const children = [];
  t.after(async () => {
    for (const proc of children) {
      if (proc.child.exitCode === null && proc.child.signalCode === null) proc.child.kill();
      await proc.exited;
    }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  function start(args) {
    const child = spawn(process.execPath, args, { cwd: dir, stdio: 'ignore' });
    const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    const proc = { child, exited };
    children.push(proc);
    return proc;
  }
  return { dir, control, start };
}

test('stop removes a dead PID record', async t => {
  const { control, start } = await fixture(t);
  const proc = start(['-e', '']);
  await proc.exited;
  fs.writeFileSync(control.pidFile, String(proc.child.pid));
  await control.requestStop();
  assert.equal(fs.existsSync(control.pidFile), false);
});

test('stop rejects an invalid PID record before probing a process', async t => {
  const { control } = await fixture(t);
  fs.writeFileSync(control.pidFile, '0');
  await assert.rejects(control.requestStop(), /Invalid PID/);
  assert.equal(fs.readFileSync(control.pidFile, 'utf8'), '0');
});

test('Windows stop clears a reused PID without terminating its unrelated process',
  { timeout: 30000, skip: process.platform !== 'win32' }, async t => {
    const { control, start } = await fixture(t);
    const proc = start(['-e', 'setInterval(() => {}, 1000)']);
    fs.writeFileSync(control.pidFile, String(proc.child.pid));
    // A reused PID belongs to a process started after the original PID file was written.
    const previous = new Date(Date.now() - 60000);
    fs.utimesSync(control.pidFile, previous, previous);
    await control.requestStop();
    assert.equal(fs.existsSync(control.pidFile), false);
    assert.doesNotThrow(() => process.kill(proc.child.pid, 0));
    assert.equal(proc.child.exitCode, null);
  });

test('Windows stop recovers a verified unresponsive theme worker',
  { timeout: 30000, skip: process.platform !== 'win32' }, async t => {
    const { dir, control, start } = await fixture(t);
    const script = path.join(dir, 'theme', 'core', 'daemon.mjs');
    fs.writeFileSync(script, 'setInterval(() => {}, 1000);');
    const proc = start([script, '--metrics-only']);
    fs.writeFileSync(control.pidFile, String(proc.child.pid));
    await control.requestStop();
    await proc.exited;
    assert.equal(fs.existsSync(control.pidFile), false);
    assert.equal(fs.existsSync(control.stopFile), true);
  });

test('Windows stop refuses to terminate an unrelated process with an unverified PID record',
  { timeout: 30000, skip: process.platform !== 'win32' }, async t => {
    const { control, start } = await fixture(t);
    const proc = start(['-e', 'setInterval(() => {}, 1000)']);
    fs.writeFileSync(control.pidFile, String(proc.child.pid));
    await assert.rejects(control.requestStop(), /Refusing to terminate PID/);
    assert.equal(fs.existsSync(control.pidFile), true);
    assert.doesNotThrow(() => process.kill(proc.child.pid, 0));
    assert.equal(proc.child.exitCode, null);
  });

test('Windows stop recovers a verified unresponsive waiting runner',
  { timeout: 30000, skip: process.platform !== 'win32' }, async t => {
    const { dir, control, start } = await fixture(t);
    const script = path.join(dir, 'inject.js');
    fs.writeFileSync(script, 'setInterval(() => {}, 1000);');
    const proc = start([script]);
    const waitingPidFile = path.join(control.stateDir, 'waiting-runner.pid');
    fs.writeFileSync(waitingPidFile, String(proc.child.pid));
    await control.requestStop();
    await proc.exited;
    assert.equal(fs.existsSync(waitingPidFile), false);
  });
