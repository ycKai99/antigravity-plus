import http from 'node:http';
import crypto from 'node:crypto';

function encode(message) {
  const data = Buffer.from(JSON.stringify(message));
  let header;
  if (data.length < 126) header = Buffer.from([0x81, data.length]);
  else if (data.length <= 65535) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(data.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(data.length), 2); }
  return Buffer.concat([header, data]);
}
export async function mockCdp({ failEvaluation = false, empty = false, pageId = 'workbench', cascadeId = '', targetList = null, workbenchReady = () => true } = {}) {
  const requests = [], sockets = new Set(), scripts = new Map();
  let sequence = 0, port;
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    const targets = empty ? [] : [
      { id: pageId, type: 'page', title: 'Antigravity', url: 'https://127.0.0.1:' + port + '/c/12345678-1234-1234-1234-123456789abc',
        webSocketDebuggerUrl: 'ws://127.0.0.1:' + port + '/devtools/page/workbench' },
      { id: 'external', type: 'page', title: 'External', url: 'https://example.com', webSocketDebuggerUrl: 'ws://127.0.0.1:' + port + '/external' }
    ];
    response.end(JSON.stringify(targetList ? targetList(targets) : targets));
  });
  server.on('upgrade', (request, socket) => {
    sockets.add(socket);
    socket.on('error', error => { if (error.code !== 'ECONNRESET') throw error; });
    socket.on('close', () => sockets.delete(socket));
    const accept = crypto.createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    let pending = Buffer.alloc(0);
    socket.on('data', data => {
      pending = Buffer.concat([pending, data]);
      while (pending.length >= 2) {
        const opcode = pending[0] & 15;
        let length = pending[1] & 127, offset = 2;
        if (length === 126) { if (pending.length < 4) return; length = pending.readUInt16BE(2); offset = 4; }
        else if (length === 127) { if (pending.length < 10) return; length = Number(pending.readBigUInt64BE(2)); offset = 10; }
        const masked = Boolean(pending[1] & 128);
        const maskLength = masked ? 4 : 0;
        if (pending.length < offset + maskLength + length) return;
        const mask = pending.subarray(offset, offset + maskLength);
        const payload = Buffer.from(pending.subarray(offset + maskLength, offset + maskLength + length));
        pending = pending.subarray(offset + maskLength + length);
        if (masked) for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index % 4];
        if (opcode === 8) { socket.end(Buffer.from([0x88, 0])); return; }
        if (opcode !== 1) continue;
        const message = JSON.parse(payload.toString());
        requests.push(message);
        let result = {};
        if (message.method === 'Page.addScriptToEvaluateOnNewDocument') {
          const identifier = 'script-' + ++sequence;
          scripts.set(identifier, message.params.source);
          result = { identifier };
        } else if (message.method === 'Page.removeScriptToEvaluateOnNewDocument') {
          scripts.delete(message.params.identifier);
        } else if (message.method === 'Runtime.evaluate') {
          if (failEvaluation) {
            socket.write(encode({ id: message.id, result: { exceptionDetails: { text: 'Fixture injection failure' } } }));
            continue;
          }
          const expression = message.params.expression;
          if (expression.startsWith('(document.readyState')) result = { result: { value: workbenchReady() } };
          else if (expression.startsWith('window.__ag_patch_version ===')) result = { result: { value: true } };
          else if (expression.startsWith('(function(){')) result = { result: { value: cascadeId } };
          else result = { result: { value: { enabled: true } } };
        }
        socket.write(encode({ id: message.id, result }));
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  return {
    port, requests, scripts,
    async close() {
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  };
}

export async function until(condition, message, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out: ' + message);
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}

