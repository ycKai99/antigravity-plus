import { requestStop, stateDir } from './theme/control.mjs';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
await requestStop();
const entry = fileURLToPath(new URL('./theme/core/daemon.mjs', import.meta.url));
const args = process.argv.slice(2).filter(arg => arg !== '--once');
const injection = fork(entry, [...args, '--once'], { stdio: 'inherit' });
await new Promise((resolve, reject) => {
  injection.once('error', reject);
  injection.once('exit', code => code === 0 ? resolve() : reject(new Error(`Theme injection failed (${code})`)));
});

// Keep only the database reader alive, without a terminal or theme file watcher.
const logPath = path.join(stateDir, 'metrics.log');
const log = fs.openSync(logPath, 'w');
let worker;
try {
  worker = fork(entry, [...args, '--metrics-only'], {
    detached: true, windowsHide: true, stdio: ['ignore', log, log, 'ipc']
  });
} finally {
  fs.closeSync(log);
}
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    worker.kill();
    reject(new Error(`Context worker startup timed out. See ${logPath}`));
  }, 10000);
  const finish = error => {
    clearTimeout(timer);
    if (error) reject(error); else resolve();
  };
  worker.once('error', finish);
  worker.once('exit', code => finish(new Error(`Context worker failed to start (${code}). See ${logPath}`)));
  worker.on('message', message => {
    if (message?.type === 'ready') finish();
  });
});
worker.disconnect();
worker.unref();
console.log('Context metrics worker is running in the background.');
