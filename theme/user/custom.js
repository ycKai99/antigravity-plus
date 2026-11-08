// Optional page-context extension. This is trusted code, not a security sandbox.
// Use ctx.onDispose(() => ...) or return a cleanup function for hot reload/revert.

(function initOverviewMetrics() {
  let lastTop = '';
  let metricsCard = null;
  let lastRight = '';
  let lastWidth = '';
  const overviewStyles = new Map();

  function updatePosition() {
    const sibling = document.querySelector('[data-testid="overview-panel-host-sibling"], [data-testid="overview-panel-host-gutter"]');
    const panel = document.querySelector('[data-testid="overview-panel"]');
    const host = document.querySelector('[data-testid="overview-panel-host"]');
    const card = document.getElementById('ag-live-metrics-tooltip') || metricsCard;
    metricsCard = card;
    if (sibling && card && card.parentElement !== sibling) sibling.appendChild(card);
    const html = document.documentElement;
    if (!html) return;
    const toggle = document.querySelector('[data-testid="toggle-overview-panel"]');
    if (toggle?.getAttribute('aria-pressed') === 'false') {
      if (html.getAttribute('data-ag-overview-visible') !== 'false') {
        html.setAttribute('data-ag-overview-visible', 'false');
      }
      return;
    }
    // Sidebar layout changes may briefly remount Overview while it stays open.
    // Preserve the card's size and visibility until its outer frame returns.
    if (toggle?.getAttribute('aria-pressed') === 'true' && (!sibling || !panel)) return;

    // The inner panel has no frame. Keep the last outer-frame style while
    // sidebar changes temporarily detach or replace the outer container.
    if (sibling && parseFloat(getComputedStyle(sibling).borderTopWidth) > 0) {
      const style = getComputedStyle(sibling);
      for (const [name, value] of Object.entries({
        background: style.backgroundColor,
        foreground: style.color,
        border: style.border,
        radius: style.borderRadius
      })) {
        if (overviewStyles.get(name) !== value) {
          html.style.setProperty('--ag-overview-' + name, value);
          overviewStyles.set(name, value);
        }
      }
    }

    let top = '260px';
    let right = '16px';
    let width = '320px';

    const siblingRect = sibling?.getBoundingClientRect();
    const panelRect = panel?.getBoundingClientRect();
    const visibleSibling = siblingRect?.width > 0 && siblingRect?.height > 0;
    const visiblePanel = panelRect?.width > 0 && panelRect?.height > 0;
    const panelStyle = panel && getComputedStyle(panel);
    const overviewVisible = toggle?.getAttribute('aria-pressed') === 'true'
      || !!(visiblePanel && panelStyle.display !== 'none' && panelStyle.visibility !== 'hidden');
    if (html.getAttribute('data-ag-overview-visible') !== String(overviewVisible)) {
      html.setAttribute('data-ag-overview-visible', String(overviewVisible));
    }
    if (visibleSibling || visiblePanel) {
      const rect = visibleSibling ? siblingRect : panelRect;
      // Overview scales around its top-right corner; anchor to its layout box,
      // rather than the smaller rectangle sampled during the opening animation.
      const anchor = visibleSibling ? sibling : panel;
      const transform = getComputedStyle(anchor).transform;
      const matrix = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform) : null;
      const scale = matrix?.a || 1;
      const layoutWidth = rect.width / scale;
      const layoutBottom = rect.top - (matrix?.f || 0) + rect.height / scale;
      const bottom = Math.max(layoutBottom, visiblePanel ? panelRect.bottom : 0);
      top = `${Math.round(bottom + 6)}px`;
      right = `${Math.max(8, Math.round(window.innerWidth - rect.right))}px`;
      width = `${Math.round(layoutWidth)}px`;
    } else if (host) {
      const hostRect = host.getBoundingClientRect();
      top = `${Math.round(hostRect.top + 8)}px`;
      right = `${Math.max(8, Math.round(window.innerWidth - hostRect.right + 8))}px`;
      width = '320px';
    }

    top = `${Math.max(8, Math.min(parseFloat(top), window.innerHeight - 240))}px`;
    if (top !== lastTop) {
      html.style.setProperty('--ag-overview-top', top);
      lastTop = top;
    }
    if (right !== lastRight) {
      html.style.setProperty('--ag-overview-right', right);
      lastRight = right;
    }
    if (width !== lastWidth) {
      html.style.setProperty('--ag-overview-width', width);
      lastWidth = width;
    }
  }

  function parseMetricsHtml(html) {
    if (!html) return null;
    const ctxMatch = html.match(/当前上下文<\/span><span class="ag-tt-val">([\d,]+) \(新增 ([\d,]+) \+ 缓存 ([\d,]+), ([\d.]+)%\)/);
    const outMatch = html.match(/本步输出量<\/span><span class="ag-tt-val">([\d,]+) \(思考链 ([\d,]+) \+ 正文\/工具 ([\d,]+)\)/);
    const limitMatch = html.match(/压缩水位线<\/span><span class="ag-tt-val">([^\s]+) \/ ([^\s]+) \((\d+)%\) · 距压缩余 ([^<]+)/);
    const tpsMatch = html.match(/生成速度<\/span><span class="ag-tt-val">(?:流式 ([\d.]+) tok\/s \| )?端到端 ([\d.]+) tok\/s/);
    const ttftMatch = html.match(/TTFT ([\d.]+)s/);
    const turnMatch = html.match(/本轮合计 \((\d+)步\)/);

    if (!ctxMatch || !limitMatch) return null;

    const toNum = s => parseInt(s.replace(/,/g, ''), 10);
    const ctxTotal = toNum(ctxMatch[1]);
    const inTok = toNum(ctxMatch[2]);
    const cacheRead = toNum(ctxMatch[3]);
    const thinkTok = outMatch ? toNum(outMatch[2]) : 0;
    const respTok = outMatch ? toNum(outMatch[3]) : 0;

    const usedStr = limitMatch[1];
    const limitStr = limitMatch[2];
    const usedPct = parseInt(limitMatch[3], 10);
    const remainStr = limitMatch[4];

    let limitNum = 256000;
    if (limitStr.endsWith('k')) limitNum = parseFloat(limitStr) * 1000;
    else if (limitStr.endsWith('M')) limitNum = parseFloat(limitStr) * 1000000;

    const remainNum = Math.max(0, limitNum - ctxTotal);

    const fmt = n => {
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 10000) return Math.round(n / 1000) + 'k';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
      return String(n);
    };

    const pct = n => ((n / limitNum) * 100).toFixed(1);

    return {
      usedPct,
      usedStr: fmt(ctxTotal),
      limitStr,
      cache: { num: fmt(cacheRead), pct: pct(cacheRead), rawPct: Math.min(100, (cacheRead / limitNum) * 100) },
      input: { num: fmt(inTok), pct: pct(inTok), rawPct: Math.min(100, (inTok / limitNum) * 100) },
      think: { num: fmt(thinkTok), pct: pct(thinkTok), rawPct: Math.min(100, (thinkTok / limitNum) * 100) },
      output: { num: fmt(respTok), pct: pct(respTok), rawPct: Math.min(100, (respTok / limitNum) * 100) },
      free: { num: remainStr, pct: pct(remainNum), rawPct: Math.max(0, (remainNum / limitNum) * 100) },
      tps: tpsMatch ? (tpsMatch[1] || tpsMatch[2]) : null,
      ttft: ttftMatch ? ttftMatch[1] : null,
      turnSteps: turnMatch ? turnMatch[1] : null
    };
  }

  let detailsOpen = false;

  function renderClaudeStyleCard() {
    const rawHtml = window.__ag_last_metrics?.tooltipHtml;
    const payload = window.__ag_last_metrics;
    const tt = document.getElementById('ag-live-metrics-tooltip');
    if (!tt || !rawHtml) return;

    if (!payload?.hasData || !window.location.pathname.endsWith('/' + payload.cascadeId)) {
      tt.replaceChildren();
      return;
    }
    const previousDetails = tt.querySelector('details');
    if (previousDetails) detailsOpen = previousDetails.open;

    const data = parseMetricsHtml(rawHtml);
    if (!data) return;

    tt.innerHTML = `
      <div class="claude-context-card">
        <div class="claude-ctx-header">
          <span class="claude-ctx-title">Context</span>
          <div class="claude-ctx-meta">
            <span class="claude-ctx-pct">${data.usedPct}% used</span>
            <span class="claude-ctx-fraction">${data.usedStr} / ${data.limitStr}</span>
          </div>
        </div>

        <div class="claude-ctx-bar" role="img" aria-label="上下文占用 ${data.usedPct}%">
          <div class="seg-cache" style="width: ${data.cache.rawPct}%"></div>
          <div class="seg-input" style="width: ${data.input.rawPct}%"></div>
          <div class="seg-free" style="width: ${data.free.rawPct}%"></div>
        </div>

        <div class="claude-ctx-list">
          <div class="claude-ctx-row">
            <div class="claude-ctx-label">
              <span class="claude-ctx-dot dot-cache"></span>
              <span>Cache memory</span>
            </div>
            <div class="claude-ctx-val">
              <span class="claude-ctx-num">${data.cache.num}</span>
              <span class="claude-ctx-pct-val">${data.cache.pct}%</span>
            </div>
          </div>

          <div class="claude-ctx-row">
            <div class="claude-ctx-label">
              <span class="claude-ctx-dot dot-input"></span>
              <span>Messages & Tools</span>
            </div>
            <div class="claude-ctx-val">
              <span class="claude-ctx-num">${data.input.num}</span>
              <span class="claude-ctx-pct-val">${data.input.pct}%</span>
            </div>
          </div>

          <div class="claude-ctx-row">
            <div class="claude-ctx-label">
              <span class="claude-ctx-dot dot-think"></span>
              <span>本步思考输出</span>
            </div>
            <div class="claude-ctx-val">
              <span class="claude-ctx-num">${data.think.num}</span>
            </div>
          </div>

          <div class="claude-ctx-row">
            <div class="claude-ctx-label">
              <span class="claude-ctx-dot dot-output"></span>
              <span>本步正文 / 工具输出</span>
            </div>
            <div class="claude-ctx-val">
              <span class="claude-ctx-num">${data.output.num}</span>
            </div>
          </div>

          <div class="claude-ctx-row is-muted">
            <div class="claude-ctx-label">
              <span class="claude-ctx-dot dot-free"></span>
              <span>Free space</span>
            </div>
            <div class="claude-ctx-val">
              <span class="claude-ctx-num">${data.free.num}</span>
              <span class="claude-ctx-pct-val">${data.free.pct}%</span>
            </div>
          </div>
        </div>

        <div class="claude-ctx-footer">
          ${data.tps ? `<span class="claude-ctx-stat"><small>生成速度</small><strong>${data.tps} <em>tok/s</em></strong></span>` : ''}

          ${data.ttft ? `<span class="claude-ctx-stat"><small>首字延迟</small><strong>${data.ttft}<em>s</em></strong></span>` : ''}
          ${data.turnSteps ? `<span class="claude-ctx-stat"><small>本轮调用</small><strong>${data.turnSteps} <em>步</em></strong></span>` : ''}
        </div>
        <details class="claude-ctx-details" ${detailsOpen ? 'open' : ''}>
          <summary><span><span class="claude-ctx-info" aria-hidden="true">i</span>调用与会话详情</span><span class="claude-ctx-chevron" aria-hidden="true"></span></summary>
          ${rawHtml}
        </details>
      </div>
    `;
  }

  // 安全劫持 metrics 渲染流程
  const baseRender = window.__ag_render_metrics;
  if (!window.__ag_claude_card_hooked) {
    window.__ag_claude_card_hooked = true;
    if (typeof baseRender === 'function') {
      window.__ag_render_metrics = function (payload) {
        const tt = document.getElementById('ag-live-metrics-tooltip');
        const details = tt?.querySelector('details');
        if (details) detailsOpen = details.open;
        const summaryFocused = details?.querySelector('summary') === document.activeElement;
        const scrollTop = tt?.scrollTop || 0;
        baseRender(payload);
        renderClaudeStyleCard();
        if (summaryFocused) tt?.querySelector('summary')?.focus({ preventScroll: true });
        if (tt) tt.scrollTop = scrollTop;
        updatePosition();
      };
      window.__ag_update_live_metrics = window.__ag_render_metrics;
    }
  }

  // 初始化
  updatePosition();
  renderClaudeStyleCard();

  let positionFrame = null;
  let observedPanel;
  let observedSibling;
  const sizeObserver = new ResizeObserver(schedulePosition);
  function refreshPosition() {
    positionFrame = null;
    const panel = document.querySelector('[data-testid="overview-panel"]');
    const sibling = document.querySelector('[data-testid="overview-panel-host-sibling"], [data-testid="overview-panel-host-gutter"]');
    if (panel !== observedPanel || sibling !== observedSibling) {
      sizeObserver.disconnect();
      if (panel) sizeObserver.observe(panel);
      if (sibling) sizeObserver.observe(sibling);
      observedPanel = panel;
      observedSibling = sibling;
    }
    updatePosition();
  }
  function schedulePosition() {
    if (positionFrame === null) positionFrame = requestAnimationFrame(refreshPosition);
  }
  const stateObserver = new MutationObserver(records => {
    if (records.some(record => {
      if (record.target.closest?.('#ag-live-metrics-tooltip')) return false;
      return record.type === 'childList' || record.target.matches?.('[data-testid="toggle-overview-panel"], [data-testid="overview-panel"], [data-testid="overview-panel-host-sibling"], [data-testid="overview-panel-host-gutter"], body');
    })) schedulePosition();
  });
  stateObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'class', 'style', 'data-starting-style', 'data-ending-style'] });
  window.addEventListener('resize', schedulePosition);
  function onOverviewTransitionEnd(event) {
    if (event.target.matches?.('[data-testid="overview-panel-host-sibling"], [data-testid="overview-panel-host-gutter"]')) schedulePosition();
  }
  document.addEventListener('transitionend', onOverviewTransitionEnd, true);
  refreshPosition();

  if (typeof ctx !== 'undefined' && typeof ctx.onDispose === 'function') {
    ctx.onDispose(() => {
      window.removeEventListener('resize', schedulePosition);
      document.removeEventListener('transitionend', onOverviewTransitionEnd, true);
      sizeObserver.disconnect();
      stateObserver.disconnect();
      if (positionFrame !== null) cancelAnimationFrame(positionFrame);
      document.documentElement.removeAttribute('data-ag-overview-visible');
      window.__ag_render_metrics = baseRender;
      window.__ag_update_live_metrics = baseRender;
      delete window.__ag_claude_card_hooked;
      for (const name of ['top', 'right', 'width', 'background', 'foreground', 'border', 'radius']) {
        document.documentElement.style.removeProperty('--ag-overview-' + name);
      }
    });
  }
})();
