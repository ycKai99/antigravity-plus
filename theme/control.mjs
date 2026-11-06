import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const stateDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.state');
export const pidFile = path.join(stateDir, 'daemon.pid');
export const stopFile = path.join(stateDir, 'stop');
const waitingPidFile = path.join(stateDir, 'waiting-runner.pid');

// A file handshake also works on Windows, where process.kill() cannot run cleanup.
export async function requestStop() {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(stopFile, 'stop\n');
  const deadline = Date.now() + 10000;
  while ([pidFile, waitingPidFile].some(file => fs.existsSync(file))) {
    for (const file of [pidFile, waitingPidFile]) {
      if (!fs.existsSync(file)) continue;
      let pid;
      try { pid = Number(fs.readFileSync(file, 'utf8').trim()); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      try { process.kill(pid, 0); } catch (error) {
        if (error.code !== 'ESRCH') throw error;
        fs.rmSync(file, { force: true });
      }
    }
    if (Date.now() >= deadline) throw new Error('Theme daemon did not stop within 10 seconds. Stop its terminal before retrying.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

export async function waitForClient(getTargets, cancelled) {
  await requestStop();
  fs.rmSync(stopFile, { force: true });
  fs.writeFileSync(waitingPidFile, String(process.pid), { flag: 'wx' });
  try {
    while (!cancelled() && !fs.existsSync(stopFile)) {
      try { await getTargets(); return true; }
      catch (error) {
        if (error.code !== 'NO_WORKBENCH') throw error;
        await new Promise(resolve => setTimeout(resolve, 2500));
      }
    }
    return false;
  } finally {
    fs.unlinkSync(waitingPidFile);
  }
}
