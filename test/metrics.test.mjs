import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMetricsReader } from '../theme/core/metrics.mjs';

const CASCADE_ID = '11111111-2222-3333-4444-555555555555';
const { DatabaseSync } = await import('node:sqlite').catch(() => ({}));
const sqliteOptions = { skip: DatabaseSync ? false : 'node:sqlite is unavailable on this Node version' };

function varint(value) {
  const bytes = [];
  do {
    const byte = value % 128;
    value = Math.floor(value / 128);
    bytes.push(byte | (value ? 0x80 : 0));
  } while (value);
  return Buffer.from(bytes);
}

function integer(field, value) {
  return Buffer.concat([varint(field * 8), varint(value)]);
}

function message(field, contents) {
  const bytes = Buffer.concat(contents);
  return Buffer.concat([varint(field * 8 + 2), varint(bytes.length), bytes]);
}

function duration(field, seconds, nanoseconds = 0) {
  return message(field, [integer(1, seconds), integer(2, nanoseconds)]);
}

function metadata({ input = 0, output = 0, cache = 0, think = 0, response = 0, ttft = [0], stream = [0] } = {}) {
  return message(1, [
    message(4, [integer(2, input), integer(3, output), integer(5, cache), integer(9, think), integer(10, response)]),
    duration(11, ...ttft),
    duration(12, ...stream),
  ]);
}

function fixture(t, records = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-plus-metrics-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const databasePath = path.join(directory, `${CASCADE_ID}.db`);
  const database = new DatabaseSync(databasePath);
  try {
    database.exec('CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB); CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER)');
    const insert = database.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)');
    records.forEach((data, index) => insert.run(index, data));
    const step = database.prepare('INSERT INTO steps (idx, step_type) VALUES (?, ?)');
    [[0, 14], [1, 15], [2, 14], [3, 15], [4, 15]].forEach(([index, type]) => step.run(index, type));
  } finally {
    database.close();
  }
  return { directory, databasePath };
}

function populatedFixture(t) {
  return fixture(t, [
    metadata({ input: 1000, cache: 1000, output: 100, think: 20, response: 80, ttft: [1], stream: [2] }),
    metadata({ input: 2000, cache: 6000, output: 200, think: 50, response: 150, ttft: [0, 500000000], stream: [2] }),
    metadata({ input: 3000, cache: 9000, output: 300, think: 60, response: 240, ttft: [1, 250000000], stream: [3] }),
    metadata(),
  ]);
}

test('reads generation speed, latency, token usage and multi-step totals from a real SQLite fixture without changing it', sqliteOptions, (t) => {
  const { directory, databasePath } = populatedFixture(t);
  const original = fs.readFileSync(databasePath);
  const reader = createMetricsReader(DatabaseSync);
  const result = reader.read(CASCADE_ID, directory, 24000);

  assert.equal(result.cascadeId, CASCADE_ID);
  assert.equal(result.hasData, true);
  assert.match(result.inlineHtml, /100 tok\/s/);
  assert.match(result.inlineHtml, /TTFT 1\.3s/);
  assert.match(result.inlineHtml, /Ctx 12k\/24k/);
  assert.match(result.inlineHtml, /\(50%\)/);
  assert.match(result.inlineHtml, /Out 300/);
  const details = result.tooltipHtml.replace(/<[^>]+>/g, ' ');
  assert.match(details, /12,000 .*3,000 .*9,000, 75\.0%/);
  assert.match(details, /500 \(.*110 \+ .*390\).*6\.8s/);
  assert.match(details, /6\.0k .*16k .*72\.7%/);
  assert.match(details, /600 \(.*130 \+ .*470\)/);
  assert.match(details, /Gen #3/);
  assert.deepEqual(fs.readFileSync(databasePath), original);
  assert.deepEqual(fs.readdirSync(directory), [`${CASCADE_ID}.db`]);
});

test('recalculates context capacity when the database has not changed', sqliteOptions, (t) => {
  const { directory } = populatedFixture(t);
  const reader = createMetricsReader(DatabaseSync);
  const signature = reader.signature(CASCADE_ID, directory);
  const first = reader.read(CASCADE_ID, directory, 24000);
  const second = reader.read(CASCADE_ID, directory, 48000);

  assert.equal(reader.signature(CASCADE_ID, directory), signature);
  assert.match(first.inlineHtml, /Ctx 12k\/24k/);
  assert.match(first.inlineHtml, /\(50%\)/);
  assert.match(second.inlineHtml, /Ctx 12k\/48k/);
  assert.match(second.inlineHtml, /\(25%\)/);
});

test('rejects invalid conversation identifiers without creating databases', sqliteOptions, (t) => {
  const { directory } = fixture(t);
  const reader = createMetricsReader(DatabaseSync);
  for (const id of [undefined, '', '../outside', 'not-a-conversation']) {
    assert.equal(reader.read(id, directory, 256000), null);
  }
  assert.deepEqual(fs.readdirSync(directory), [`${CASCADE_ID}.db`]);
});

test('returns no data for a missing conversation database', sqliteOptions, (t) => {
  const { directory } = fixture(t);
  const reader = createMetricsReader(DatabaseSync);
  const missingId = '99999999-8888-7777-6666-555555555555';
  assert.equal(reader.signature(missingId, directory), null);
  assert.deepEqual(reader.read(missingId, directory, 256000), { cascadeId: missingId, hasData: false });
  assert.deepEqual(fs.readdirSync(directory), [`${CASCADE_ID}.db`]);
});

test('returns no data for an empty metadata table or all-zero metadata snapshots', sqliteOptions, (t) => {
  for (const records of [[], [metadata()]]) {
    const { directory } = fixture(t, records);
    const result = createMetricsReader(DatabaseSync).read(CASCADE_ID, directory, 256000);
    assert.equal(result.hasData, false);
    assert.equal(result.cascadeId, CASCADE_ID);
    assert.equal(result.inlineHtml, undefined);
  }
});

test('disables metrics when SQLite support is unavailable', () => {
  assert.equal(createMetricsReader(null).read(CASCADE_ID, os.tmpdir(), 256000), null);
});
