import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = fs.readFileSync(path.join(root, 'theme', 'manage.mjs'), 'utf8')
  .replace(/^#![^\n]*\n/, '').replace(/^import .*;\r?\n/gm, '').replaceAll('import.meta.url', 'moduleUrl');

function fixture(t, platform = 'win32') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-plus-manage-'));
  const themeDir = path.join(dir, 'project', 'theme');
  fs.cpSync(path.join(root, 'theme'), themeDir, { recursive: true, filter: file => !file.includes(path.sep + '.state') });
  const home = path.join(dir, 'home'), appData = path.join(home, 'AppData', 'Roaming');
  fs.mkdirSync(appData, { recursive: true });
  fs.mkdirSync(path.join(home, '.antigravity'), { recursive: true });
  const stateDir = path.join(themeDir, '.state');
  const invocations = [], output = [], errors = [];
  let stopped = 0;
  async function run(args) {
    const processMock = {
      argv: ['node', 'manage.mjs', ...args], versions: process.versions,
      platform, execPath: 'C:\\Program Files\\nodejs\\node.exe', exitCode: 0, getuid: () => 1000,
      env: { APPDATA: appData, LOCALAPPDATA: path.join(home, 'AppData', 'Local'), WINDIR: path.join(dir, 'Windows') }
    };
    const context = {
      fs, path, crypto, os: { homedir: () => home }, stateDir,
      requestStop: async () => { stopped++; fs.mkdirSync(stateDir, { recursive: true }); },
      process: processMock, moduleUrl: new URL('file:///' + path.join(themeDir, 'manage.mjs').replaceAll('\\', '/')),
      fileURLToPath,
      spawn(program, argv, options) {
        invocations.push({ program, argv, options });
        return { unref() {}, once(event, callback) { if (event === 'spawn') queueMicrotask(callback); } };
      },
      spawnSync(program, argv, options) {
        invocations.push({ program, argv, options }); return { status: 0, stdout: '', stderr: '' };
      },
      console: { log: (...args) => output.push(args.join(' ')), error: (...args) => errors.push(args.join(' ')) },
      URL, Set, AbortSignal,
      fetch: async () => { throw new TypeError('No fixture CDP endpoint'); }, TypeError
    };
    await vm.runInNewContext('(async () => {\n' + source + '\n})()', context);
    return { exitCode: processMock.exitCode };
  }
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, themeDir, home, appData, stateDir, run, invocations, output, errors, stopped: () => stopped };
}

test('Windows install registers one hidden login launcher, preserves JSONC, and uninstall restores owned argv changes', async t => {
  const f = fixture(t);
  const argvFile = path.join(f.home, '.antigravity', 'argv.json');
  const before = '{\n  // retain this comment\n  "disable-hardware-acceleration": true // trailing comment\n}\n';
  fs.writeFileSync(argvFile, before);
  assert.equal((await f.run(['build-manifest'])).exitCode, 0);
  assert.equal((await f.run(['install'])).exitCode, 0, f.errors.join('\n'));
  const after = fs.readFileSync(argvFile, 'utf8');
  assert.match(after, /"remote-debugging-port": 9222,/);
  assert.ok(after.includes('// trailing comment'));
  const launcher = path.join(f.appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'AntigravityPlus.vbs');
  const vbs = fs.readFileSync(launcher, 'utf16le');
  assert.match(vbs, /--wait-for-client/);
  assert.match(vbs, /, 0, False/);
  assert.equal(f.invocations.filter(item => item.program === 'reg').length, 0);
  const launch = f.invocations.find(item => item.program.includes('node.exe'));
  assert.equal(launch.options.windowsHide, true);
  assert.equal(launch.options.detached, true);
  assert.equal((await f.run(['uninstall'])).exitCode, 0);
  assert.equal(fs.existsSync(launcher), false);
  assert.equal(fs.readFileSync(argvFile, 'utf8'), before);
  assert.ok(fs.existsSync(path.join(f.themeDir, 'user', 'config.json')));
});

test('uninstall preserves an argv file edited after installation', async t => {
  const f = fixture(t);
  const argvFile = path.join(f.home, '.antigravity', 'argv.json');
  await f.run(['build-manifest']); await f.run(['install']);
  fs.appendFileSync(argvFile, '// later user edit\n');
  const changed = fs.readFileSync(argvFile, 'utf8');
  await f.run(['uninstall']);
  assert.equal(fs.readFileSync(argvFile, 'utf8'), changed);
  assert.match(f.output.at(-1), /preservedArgv/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.stateDir, 'argv-backups.json'), 'utf8')).length, 1);
});

test('core rollback restores the previous installed snapshot and preserves user customization', async t => {
  const f = fixture(t);
  await f.run(['build-manifest']); await f.run(['install']);
  const css = path.join(f.themeDir, 'core', 'theme.css'), original = fs.readFileSync(css, 'utf8');
  fs.appendFileSync(css, '\n.test-new-version { color: red; }\n');
  await f.run(['build-manifest']); await f.run(['install']);
  const custom = path.join(f.themeDir, 'user', 'custom.css');
  fs.writeFileSync(custom, '.my-custom-style {}');
  assert.equal((await f.run(['rollback'])).exitCode, 0, f.errors.join('\n'));
  assert.equal(fs.readFileSync(css, 'utf8'), original);
  assert.equal(fs.readFileSync(custom, 'utf8'), '.my-custom-style {}');
});

test('install rejects a modified core before startup or launch configuration changes', async t => {
  const f = fixture(t);
  await f.run(['build-manifest']);
  fs.appendFileSync(path.join(f.themeDir, 'core', 'theme.css'), '\nmodified');
  const result = await f.run(['install']);
  assert.equal(result.exitCode, 1);
  assert.match(f.errors.at(-1), /integrity failed/);
  assert.equal(f.invocations.length, 0);
  assert.equal(f.stopped(), 0);
  assert.equal(fs.existsSync(path.join(f.home, '.antigravity', 'argv.json')), false);
});

test('read-only marker verification fails when there are no workbench pages', async t => {
  const f = fixture(t);
  const result = await f.run(['verify']);
  assert.equal(result.exitCode, 1);
  assert.equal(JSON.parse(f.output.at(-1)).ok, false);
  assert.equal(f.invocations.length, 0);
  assert.equal(f.stopped(), 0);
  assert.equal(fs.existsSync(f.stateDir), false);
});

test('font installation copies only font assets and registers Windows fonts', async t => {
  const f = fixture(t), supplied = path.join(f.dir, 'supplied-fonts');
  fs.mkdirSync(path.join(supplied, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(supplied, 'nested', 'MapleMono.ttf'), 'fixture-font-bytes');
  fs.writeFileSync(path.join(supplied, 'notes.txt'), 'not a font');
  assert.equal((await f.run(['install-fonts', '--from', supplied])).exitCode, 0);
  const target = path.join(f.home, 'AppData', 'Local', 'Microsoft', 'Windows', 'Fonts', 'MapleMono.ttf');
  assert.equal(fs.readFileSync(target, 'utf8'), 'fixture-font-bytes');
  assert.equal(f.invocations.filter(item => item.program === 'reg').length, 1);
  assert.ok(f.invocations[0].argv.includes(target));
  assert.deepEqual(JSON.parse(f.output.at(-1)).installed, [target]);
});

test('macOS and Linux autostart templates preserve argument boundaries and wait for the client', async t => {
  for (const platform of ['darwin', 'linux']) {
    const f = fixture(t, platform);
    await f.run(['build-manifest']);
    assert.equal((await f.run(['install'])).exitCode, 0, f.errors.join('\n'));
    const serviceFile = platform === 'darwin' ?
      path.join(f.home, 'Library', 'LaunchAgents', 'com.antigravity-plus.plist') :
      path.join(f.home, '.config', 'systemd', 'user', 'antigravity-plus.service');
    const service = fs.readFileSync(serviceFile, 'utf8');
    assert.match(service, /--wait-for-client/);
    assert.match(service, /--config/);
    assert.ok(f.invocations.every(item => ['launchctl', 'systemctl'].includes(item.program)));
    assert.equal((await f.run(['uninstall'])).exitCode, 0);
    assert.equal(fs.existsSync(serviceFile), false);
  }
});

