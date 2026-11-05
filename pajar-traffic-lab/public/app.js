(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const number = (value, digits = 0) => Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const bytes = (value) => {
    const n = Number(value || 0);
    if (n < 1024) return `${number(n)} B`;
    if (n < 1024 ** 2) return `${number(n / 1024, 1)} KB`;
    if (n < 1024 ** 3) return `${number(n / (1024 ** 2), 2)} MB`;
    return `${number(n / (1024 ** 3), 2)} GB`;
  };
  const time = (iso) => iso ? new Date(iso).toLocaleString() : '—';
  const clock = () => { $('#clock').textContent = new Date().toLocaleTimeString(); };

  function setConnection(online) {
    const pill = $('.live-pill');
    pill.classList.toggle('offline', !online);
    $('#connection').textContent = online ? 'LIVE' : 'RECONNECTING';
  }

  function renderStatus(codes) {
    const families = ['2xx', '3xx', '4xx', '5xx', 'other'];
    const total = families.reduce((sum, key) => sum + Number(codes[key] || 0), 0);
    $('#statusList').innerHTML = families.map((key) => {
      const value = Number(codes[key] || 0);
      const width = total ? (value / total) * 100 : 0;
      return `<div class="status-row" data-family="${key}">
        <span class="status-name">${key.toUpperCase()}</span>
        <span class="status-track"><span class="status-fill" style="width:${width.toFixed(2)}%"></span></span>
        <span class="status-number">${number(value)}</span>
      </div>`;
    }).join('');
  }

  function renderMethods(methods) {
    const order = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OTHER'];
    $('#methodList').innerHTML = order
      .filter((key) => Number(methods[key] || 0) > 0)
      .map((key) => `<span class="method-chip">${key}<b>${number(methods[key])}</b></span>`)
      .join('') || '<span class="muted">no requests yet</span>';
  }

  function renderRecent(items) {
    $('#logCount').textContent = `${items.length} live events`;
    if (!items.length) {
      $('#requestRows').innerHTML = '<tr><td colspan="5" class="empty-state">menunggu request masuk…</td></tr>';
      return;
    }

    $('#requestRows').innerHTML = items.map((item) => {
      const status = Number(item.status || 0);
      const statusClass = status >= 200 && status < 400 ? 'ok' : 'bad';
      const shortTime = item.at ? new Date(item.at).toLocaleTimeString() : '—';
      return `<tr>
        <td>${shortTime}</td>
        <td><span class="method">${escapeHtml(item.method)}</span></td>
        <td class="path-cell" title="${escapeHtml(item.path)}">${escapeHtml(item.path)}</td>
        <td><span class="status-code ${statusClass}">${status || '—'}</span></td>
        <td>${number(item.durationMs, 1)} ms</td>
      </tr>`;
    }).join('');
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
  }

  function drawChart(points) {
    const canvas = $('#trafficChart');
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(280, rect.width);
    const height = Math.max(140, rect.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const left = 8, right = 8, top = 12, bottom = 22;
    const plotW = width - left - right;
    const plotH = height - top - bottom;
    const values = points.map((point) => Number(point.requests || 0));
    const maxValue = Math.max(4, ...values);
    const peak = Math.ceil(maxValue / 4) * 4;

    ctx.clearRect(0, 0, width, height);
    ctx.font = '9px DM Mono, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#64738b';
    for (let i = 0; i <= 4; i += 1) {
      const y = top + (plotH * i) / 4;
      ctx.strokeStyle = 'rgba(137,160,195,.12)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(width - right, y); ctx.stroke();
      ctx.fillText(String(Math.round(peak * (4 - i) / 4)), left + 2, Math.max(9, y - 4));
    }

    if (!values.length) return;
    const barGap = 3;
    const barW = Math.max(1, (plotW - barGap * (values.length - 1)) / values.length);
    values.forEach((value, index) => {
      const barH = value ? Math.max(2, (value / peak) * plotH) : 0;
      const x = left + index * (barW + barGap);
      const y = top + plotH - barH;
      if (!barH) return;
      const gradient = ctx.createLinearGradient(0, y, 0, top + plotH);
      gradient.addColorStop(0, '#a9bdff');
      gradient.addColorStop(1, 'rgba(94,213,229,.34)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      const radius = Math.min(3, barW / 2, barH / 2);
      ctx.roundRect(x, y, barW, barH, radius);
      ctx.fill();
    });

    ctx.fillStyle = '#64738b';
    ctx.textAlign = 'left'; ctx.fillText('60s ago', left, height - 5);
    ctx.textAlign = 'right'; ctx.fillText('now', width - right, height - 5);
  }

  function render(data) {
    const totals = data.totals || {};
    $('#totalRequests').textContent = number(totals.requests);
    $('#currentRps').textContent = number(totals.currentRps, 1);
    $('#peakRps').textContent = number(totals.peakRps);
    $('#successRate').textContent = `${number(totals.successRate, 1)}%`;
    $('#successCount').textContent = number(totals.successful);
    $('#failedCount').textContent = number(totals.failed);
    $('#avgResponse').innerHTML = `${number(totals.durationAvgMs, 1)} <small>ms</small>`;
    $('#bytesIn').textContent = bytes(totals.bytesIn);
    $('#bytesOut').textContent = bytes(totals.bytesOut);
    $('#firstSeen').textContent = time(totals.firstSeenAt);
    $('#lastSeen').textContent = time(totals.lastSeenAt);
    $('#hostname').textContent = location.host || 'this-worker';
    $('#lastUpdated').textContent = `updated ${new Date().toLocaleTimeString()}`;
    renderStatus(data.statusCodes || {});
    renderMethods(data.methods || {});
    renderRecent(data.recent || []);
    drawChart(data.timeline || []);
  }

  async function refresh() {
    try {
      const response = await fetch('/api/metrics', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      render(data);
      setConnection(true);
    } catch (error) {
      setConnection(false);
      console.warn('metrics unavailable:', error.message);
    }
  }

  clock();
  setInterval(clock, 1000);
  refresh();
  setInterval(refresh, 5000);
  window.addEventListener('resize', () => {
    // The next poll redraws the chart at the new viewport size.
    refresh();
  });
})();
