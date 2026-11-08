const fs = require('fs');
const path = require('path');
const { spawn, fork } = require('child_process');

const args = process.argv.slice(2);
const launchIndex = args.indexOf('--launch');
if (launchIndex !== -1) {
    args.splice(launchIndex, 1);
    const exePath = path.join(process.env.LOCALAPPDATA, 'Programs', 'Antigravity', 'Antigravity.exe');
    if (!fs.existsSync(exePath)) throw new Error(`Antigravity not found: ${exePath}`);
    const client = spawn(exePath, [], { detached: true, stdio: 'ignore' });
    client.on('error', error => { console.error(error.message); process.exitCode = 1; });
    client.unref();
}
const injector = fork(path.join(__dirname, 'inject.js'), ['--wait-for-client', ...args], { stdio: 'inherit' });
injector.on('error', error => { console.error(error.message); process.exitCode = 1; });
injector.on('exit', code => { process.exitCode = code === 0 ? 0 : 1; });
