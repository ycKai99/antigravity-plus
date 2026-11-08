import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const stateDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.state');
export const pidFile = path.join(stateDir, 'daemon.pid');
export const stopFile = path.join(stateDir, 'stop');
const waitingPidFile = path.join(stateDir, 'waiting-runner.pid');
const runFile = promisify(execFile);

function readPid(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const pid = Number(raw.trim());
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`Invalid PID in ${file}`);
    return { raw, pid, modified: fs.statSync(file).mtimeMs };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function sameRecord(left, right) {
  return left && left.raw === right.raw && left.modified === right.modified;
}

function removePid(file, record) {
  if (sameRecord(readPid(file), record)) fs.rmSync(file, { force: true });
}

async function recoverWindowsProcess(file, record) {
  const script = `$ErrorActionPreference = 'Stop';
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
    $target = Get-CimInstance Win32_Process -Filter "ProcessId = ${record.pid}";
    if ($target) {
      [PSCustomObject]@{
        executable = $target.ExecutablePath;
        commandLine = $target.CommandLine;
        started = $target.CreationDate.ToUniversalTime().ToString('o')
      } | ConvertTo-Json -Compress
    }`;
  let stdout;
  try {
    ({ stdout } = await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, timeout: 10000, encoding: 'utf8'
    }));
  } catch (error) {
    throw new Error(`Cannot verify background PID ${record.pid}; refusing to terminate it`, { cause: error });
  }
  if (!sameRecord(readPid(file), record)) return;
  const target = stdout.trim() ? JSON.parse(stdout) : null;
  if (!target) { removePid(file, record); return; }
  const started = Date.parse(target.started);
  if (!Number.isFinite(started)) throw new Error(`Cannot verify creation time of background PID ${record.pid}`);
  if (started > record.modified) { removePid(file, record); return; }

  const argv = (target.commandLine || '').match(/"[^"]*"|\S+/g)?.map(arg => arg.replace(/^"|"$/g, '')) || [];
  const entry = file === pidFile ? path.join(stateDir, '..', 'core', 'daemon.mjs') : path.join(stateDir, '..', '..', 'inject.js');
  const canonical = value => path.resolve(value).toLowerCase();
  if (record.pid === process.pid || !target.executable || canonical(target.executable) !== canonical(process.execPath) ||
      !argv[1] || canonical(argv[1]) !== canonical(entry)) {
    throw new Error(`Refusing to terminate PID ${record.pid} from ${file}: it does not match this workspace's background entry`);
  }
  console.warn(`[Theme] Terminating unresponsive background PID ${record.pid} (${path.basename(file)})`);
  try { process.kill(record.pid); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}

// A file handshake also works on Windows, where process.kill() cannot run cleanup.
export async function requestStop() {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(stopFile, 'stop\n');
  let deadline = Date.now() + 10000;
  let recovered = false;
  while ([pidFile, waitingPidFile].some(file => fs.existsSync(file))) {
    for (const file of [pidFile, waitingPidFile]) {
      const record = readPid(file);
      if (!record) continue;
      try { process.kill(record.pid, 0); } catch (error) {
        if (error.code !== 'ESRCH') throw error;
        removePid(file, record);
      }
    }
    if (![pidFile, waitingPidFile].some(file => fs.existsSync(file))) return;
    if (Date.now() >= deadline) {
      if (process.platform !== 'win32' || recovered) {
        throw new Error(`Theme background processes did not stop. Check ${pidFile}, ${waitingPidFile} and ${path.join(stateDir, 'metrics.log')}`);
      }
      for (const file of [pidFile, waitingPidFile]) {
        const record = readPid(file);
        if (record) await recoverWindowsProcess(file, record);
      }
      recovered = true;
      deadline = Date.now() + 2000;
    }
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
