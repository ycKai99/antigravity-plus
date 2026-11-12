import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const runner = path.join(root, 'inject.js');

function isolatedCli(t, args, configuration) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-plus-runner-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  if (configuration) fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify(configuration));
  const result = spawnSync(process.execPath, [runner, ...args], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
    env: { ...process.env, HOME: directory, USERPROFILE: directory, APPDATA: directory },
  });
  assert.equal(result.error, undefined);
  return { ...result, output: result.stdout + result.stderr, directory };
}

const allDisabled = { limits: false, font: false, theme: false };

test('help advertises only limits, font and the unified theme module', (t) => {
  const result = isolatedCli(t, ['--help']);
  assert.equal(result.status, 0);
  const available = result.stdout.split('Available Modules:')[1].split('Examples:')[0];
  assert.deepEqual([...available.matchAll(/^  ([a-z-]+)\s+/gm)].map((match) => match[1]), ['limits', 'font', 'theme']);
  assert.doesNotMatch(available, /skills|rail|turnrail|theme-contrast|theme-white|theme-vintage|enhancements/);
  assert.deepEqual(fs.readdirSync(result.directory), []);
});

test('removed modules and aliases fail before any client connection or config creation', (t) => {
  const removed = ['skills', 'skill', 'rail', 'turnrail', 'theme-contrast', 'contrast', 'theme:contrast', 'theme-white', 'purewhite', 'white', 'theme:white', 'theme-vintage', 'vintage', 'theme:vintage', 'enhancements', 'enhancement', 'guard'];
  for (const name of removed) {
    const result = isolatedCli(t, [name]);
    assert.notEqual(result.status, 0, name);
    assert.match(result.output, /has been removed/, name);
    assert.doesNotMatch(result.output, /DevToolsActivePort|Injecting|Launching/);
    assert.deepEqual(fs.readdirSync(result.directory), []);
  }
});

test('removed enable and disable flags also fail explicitly', (t) => {
  for (const flag of ['--skills', '--no-skills', '--rail', '--no-rail', '--theme-contrast', '--no-theme-white', '--enhancements']) {
    const result = isolatedCli(t, [flag]);
    assert.notEqual(result.status, 0, flag);
    assert.match(result.output, /has been removed/);
    assert.doesNotMatch(result.output, /DevToolsActivePort/);
  }
});

test('unknown names, flags and missing config paths fail before client access', (t) => {
  for (const args of [['unknown-module'], ['--unknown-option'], ['-x'], ['--config'], ['--config', '--no-theme']]) {
    const result = isolatedCli(t, args);
    assert.notEqual(result.status, 0, args.join(' '));
    assert.match(result.output, /Unknown|requires a configuration file path/);
    assert.doesNotMatch(result.output, /DevToolsActivePort/);
    assert.deepEqual(fs.readdirSync(result.directory), []);
  }
});

test('flat and nested disabled module configurations exit cleanly without an Antigravity client', (t) => {
  for (const config of [allDisabled, { modules: allDisabled }, { scripts: allDisabled }]) {
    const result = isolatedCli(t, [], config);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /No modules enabled/);
    assert.doesNotMatch(result.output, /DevToolsActivePort/);
  }
});

test('command-line disabling overrides enabled configuration without opening the client', (t) => {
  const result = isolatedCli(t, ['--no-limits', '--no-font', '--no-theme'], { limits: true, font: true, theme: true });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /No modules enabled/);
  assert.doesNotMatch(result.output, /DevToolsActivePort/);
});

test('safe mode requires a selected theme module', (t) => {
  const result = isolatedCli(t, ['--safe-mode'], allDisabled);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /--safe-mode requires the theme module/);
  assert.doesNotMatch(result.output, /DevToolsActivePort/);
});

test('preset arguments reject missing or unsupported values before creating configuration', t => {
  for (const args of [['--preset'], ['--preset', '--no-theme'], ['--preset='], ['--preset', 'unknown'], ['--preset=unknown']]) {
    const result = isolatedCli(t, args);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /requires a preset name|Invalid theme preset/);
    assert.match(result.output, /high-contrast, claude-desktop-purewhite, vintage-deep/);
    assert.deepEqual(fs.readdirSync(result.directory), []);
  }
});

test('both preset argument forms require an enabled theme module', t => {
  for (const args of [['--preset', 'vintage-deep'], ['--preset=claude-desktop-purewhite'], ['--preset', 'high-contrast-dark'], ['--preset=high-contrast-dark']]) {
    const result = isolatedCli(t, args, allDisabled);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /--preset requires the theme module/);
    assert.doesNotMatch(result.output, /Launching|Injecting/);
  }
});

test('package commands and shipped configuration expose the retained features', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const configuration = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
  for (const name of ['limits', 'font', 'theme']) {
    const command = pkg.scripts[`inject:${name}`];
    assert.equal(typeof command, 'string', name);
    assert.equal(fs.existsSync(path.join(root, command.replace(/^node /, ''))), true, name);
  }
  for (const name of ['skills', 'rail', 'theme:contrast', 'theme:white', 'theme:vintage', 'enhancements']) {
    assert.equal(pkg.scripts[`inject:${name}`], undefined, name);
  }
  assert.equal(configuration.font, true);
  assert.equal(configuration.theme, true);
  assert.equal(configuration.skills, undefined);
  assert.equal(configuration.rail, undefined);
});
