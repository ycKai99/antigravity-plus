import fs from 'node:fs';
import path from 'node:path';

// Read-only boundary around Antigravity's internal SQLite/protobuf format.
export function createMetricsReader(DatabaseSync) {
const metricsCache = new Map(); // dbPath -> { sig, payload }
const MAX_METRICS_CACHE_SIZE = 30;

function setMetricsCache(dbPath, entry) {
  if (metricsCache.has(dbPath)) metricsCache.delete(dbPath);
  metricsCache.set(dbPath, entry);
  if (metricsCache.size > MAX_METRICS_CACHE_SIZE) {
    const oldestKey = metricsCache.keys().next().value;
    if (oldestKey) metricsCache.delete(oldestKey);
  }
}

function parseProto(buf) {
  let i = 0;
  const out = new Map();
  while (i < buf.length) {
    let tag = 0;
    let shift = 0;
    while (i < buf.length) {
      const b = buf[i++];
      tag |= (b & 0x7f) << shift;
      if (!(b & 0x80)) break;
      shift += 7;
    }
    const fn = tag >>> 3;
    const wt = tag & 7;
    if (fn <= 0 || fn > 10000) break;
    if (wt === 0) {
      let val = 0;
      let s = 0;
      while (i < buf.length) {
        const b = buf[i++];
        val += (b & 0x7f) * Math.pow(2, s);
        if (!(b & 0x80)) break;
        s += 7;
      }
      out.set(fn, val);
    } else if (wt === 2) {
      let len = 0;
      let s = 0;
      while (i < buf.length) {
        const b = buf[i++];
        len |= (b & 0x7f) << s;
        if (!(b & 0x80)) break;
        s += 7;
      }
      if (len < 0 || i + len > buf.length) break;
      out.set(fn, buf.subarray(i, i + len));
      i += len;
    } else if (wt === 1) {
      if (i + 8 > buf.length) break;
      out.set(fn, buf.subarray(i, i + 8));
      i += 8;
    } else if (wt === 5) {
      if (i + 4 > buf.length) break;
      out.set(fn, buf.subarray(i, i + 4));
      i += 4;
    } else {
      break;
    }
  }
  return out;
}

function fmtTok(n) {
  if (!n || n <= 0) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
  if (n >= 10000) return Math.round(n / 1000) + 'k';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function fmtNum(n) {
  return (n || 0).toLocaleString('en-US');
}

function getDbSignature(cascadeId, conversationsDir) {
  try {
    const dbPath = path.join(conversationsDir, `${cascadeId}.db`);
    if (!fs.existsSync(dbPath)) return null;
    const st = fs.statSync(dbPath);
    let walSig = '0:0';
    const walPath = `${dbPath}-wal`;
    if (fs.existsSync(walPath)) {
      const wst = fs.statSync(walPath);
      walSig = `${wst.mtimeMs}:${wst.size}`;
    }
    return `${st.mtimeMs}:${st.size}|${walSig}`;
  } catch {
    return null;
  }
}

function parseConversationMetrics(cascadeId, conversationsDir, contextLimitTokens) {
  if (!DatabaseSync) return null;
  if (!cascadeId || !/^[0-9a-f-]{36}$/i.test(cascadeId)) return null;
  const dbPath = path.join(conversationsDir, `${cascadeId}.db`);
  const dbSig = getDbSignature(cascadeId, conversationsDir);
  const sig = dbSig && `${dbSig}|context:${contextLimitTokens}`;
  if (!sig) return { cascadeId, hasData: false };

  const cached = metricsCache.get(dbPath);
  if (cached && cached.sig === sig) {
    return cached.payload;
  }

  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx ASC').all();
    if (!rows || rows.length === 0) {
      db.close();
      db = null;
      const emptyPayload = { cascadeId, hasData: false, sig };
      setMetricsCache(dbPath, { sig, payload: emptyPayload });
      return emptyPayload;
    }
    // 利用 idx_steps_step_type 覆盖索引直接在 SQLite C 引擎内完成聚合计数，0 数组分配
    const userStat = db
      .prepare('SELECT COUNT(*) AS cnt, COALESCE(MAX(idx), -1) AS lastIdx FROM steps WHERE step_type = 14')
      .get();
    const lastUserStepIdx = userStat?.lastIdx ?? -1;
    const userStepsCount = userStat?.cnt ?? 0;
    const turnStat = db
      .prepare('SELECT COUNT(*) AS cnt FROM steps WHERE step_type = 15 AND idx > ?')
      .get(lastUserStepIdx);
    const rawTurnSteps = turnStat?.cnt ?? 0;
    db.close();
    db = null;

    let totalIn = 0;
    let totalCache = 0;
    let totalOut = 0;
    let totalThink = 0;
    let totalResp = 0;

    const parsed = rows.map((r) => {
      const top = parseProto(r.data);
      const chat = top.has(1) ? parseProto(top.get(1)) : new Map();
      const usage = chat.has(4) ? parseProto(chat.get(4)) : new Map();
      const ttftMap = chat.has(11) ? parseProto(chat.get(11)) : new Map();
      const streamMap = chat.has(12) ? parseProto(chat.get(12)) : new Map();

      const inTok = usage.get(2) || 0;
      const outTok = usage.get(3) || 0;
      const cacheRead = usage.get(5) || 0;
      const thinkTok = usage.get(9) || 0;
      const respTok = usage.get(10) || 0;
      const ttft = (ttftMap.get(1) || 0) + (ttftMap.get(2) || 0) / 1e9;
      const stream = (streamMap.get(1) || 0) + (streamMap.get(2) || 0) / 1e9;

      totalIn += inTok;
      totalCache += cacheRead;
      totalOut += outTok;
      totalThink += thinkTok;
      totalResp += respTok;

      return {
        idx: r.idx,
        inTok,
        outTok,
        cacheRead,
        ctx: inTok + cacheRead,
        thinkTok,
        respTok,
        ttft,
        stream,
        totDur: ttft + stream
      };
    });

    // 过滤尾部或中间出现的 0 用量异常记录（如无 field 2 的元数据快照），防止 Ctx 显示为 0%
    const valid = parsed.filter((p) => p.ctx > 0 || p.outTok > 0);
    if (valid.length === 0) {
      const emptyPayload = { cascadeId, hasData: false, sig };
      setMetricsCache(dbPath, { sig, payload: emptyPayload });
      return emptyPayload;
    }

    // 统计最后一条用户提问之后的模型规划步数，并从有效调用末尾切片汇总，消除按位置对齐的错位风险
    const turnSlice = rawTurnSteps > 0 ? valid.slice(-rawTurnSteps) : [];
    const turnSteps = turnSlice.length;
    let turnOut = 0;
    let turnThink = 0;
    let turnResp = 0;
    let turnDur = 0;
    for (let i = 0; i < turnSlice.length; i++) {
      turnOut += turnSlice[i].outTok;
      turnThink += turnSlice[i].thinkTok;
      turnResp += turnSlice[i].respTok;
      turnDur += turnSlice[i].totDur;
    }

    const last = valid[valid.length - 1];
    const streamTps = last.stream >= 0.25 ? last.outTok / last.stream : 0;
    const e2eTps = last.totDur > 0 ? last.outTok / last.totDur : 0;
    const displayTps = streamTps > 0 && streamTps <= 600 ? streamTps : e2eTps;
    const ctxPct = Math.round((last.ctx / contextLimitTokens) * 100);
    const ctxClass = ctxPct >= 90 ? 'ag-ctx-crit' : ctxPct >= 75 ? 'ag-ctx-warn' : 'ag-ctx-ok';
    const lastCacheRate = last.ctx > 0 ? ((last.cacheRead / last.ctx) * 100).toFixed(1) : '0.0';
    const sessionCacheRate = totalIn + totalCache > 0 ? ((totalCache / (totalIn + totalCache)) * 100).toFixed(1) : '0.0';
    const remainCtx = Math.max(0, contextLimitTokens - last.ctx);
    const limitKStr = Math.round(contextLimitTokens / 1000) + 'k';

    const inlineHtml = [
      `<span>${Math.round(displayTps)} tok/s</span>`,
      `<span class="ag-sep">·</span>`,
      `<span>TTFT ${last.ttft.toFixed(1)}s</span>`,
      `<span class="ag-sep">·</span>`,
      `<span>Ctx ${fmtTok(last.ctx)}/${limitKStr} <span class="${ctxClass}">(${ctxPct}%)</span></span>`,
      `<span class="ag-sep">·</span>`,
      `<span>Out ${fmtTok(last.outTok)}</span>`
    ].join('');

    const turnRowHtml =
      turnSteps > 1
        ? `<div class="ag-tt-row"><span class="ag-tt-lbl">本轮合计 (${turnSteps}步)</span><span class="ag-tt-val">输出 ${fmtNum(turnOut)} (思考 ${fmtNum(turnThink)} + 响应 ${fmtNum(turnResp)}) | 耗时 ${turnDur.toFixed(1)}s</span></div>`
        : '';

    const tooltipHtml = [
      `<div class="ag-tt-hdr">本轮最新调用 (Gen #${last.idx + 1})</div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">生成速度</span><span class="ag-tt-val">${streamTps > 0 && streamTps <= 600 ? `流式 ${streamTps.toFixed(1)} tok/s | ` : ''}端到端 ${e2eTps.toFixed(1)} tok/s</span></div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">响应耗时</span><span class="ag-tt-val">TTFT ${last.ttft.toFixed(2)}s | 流式 ${last.stream.toFixed(2)}s | 总计 ${last.totDur.toFixed(2)}s</span></div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">当前上下文</span><span class="ag-tt-val">${fmtNum(last.ctx)} (新增 ${fmtNum(last.inTok)} + 缓存 ${fmtNum(last.cacheRead)}, ${lastCacheRate}%)</span></div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">本步输出量</span><span class="ag-tt-val">${fmtNum(last.outTok)} (思考链 ${fmtNum(last.thinkTok)} + 正文/工具 ${fmtNum(last.respTok)})</span></div>`,
      turnRowHtml,
      `<div class="ag-tt-hdr ag-tt-sec">当前会话累计 (${userStepsCount} 轮提问 / ${valid.length} 次有效调用)</div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">压缩水位线</span><span class="ag-tt-val">${fmtTok(last.ctx)} / ${limitKStr} (${ctxPct}%) · 距压缩余 ${fmtTok(remainCtx)}</span></div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">累计输入量</span><span class="ag-tt-val">新增 ${fmtTok(totalIn)} + 缓存读取 ${fmtTok(totalCache)} (命中率 ${sessionCacheRate}%)</span></div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">累计输出量</span><span class="ag-tt-val">总计 ${fmtTok(totalOut)} (思考链 ${fmtTok(totalThink)} + 正文/工具 ${fmtTok(totalResp)})</span></div>`
    ].join('');

    const payload = {
      cascadeId,
      hasData: true,
      sig,
      inlineHtml,
      tooltipHtml
    };
    setMetricsCache(dbPath, { sig, payload });
    return payload;
  } catch {
    if (cached && cached.payload) {
      return cached.payload;
    }
    return { cascadeId, hasData: false };
  } finally {
    try {
      db?.close();
    } catch {}
  }
}


return { signature: getDbSignature, read: parseConversationMetrics };
}

