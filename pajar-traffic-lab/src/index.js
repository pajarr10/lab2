/**
 * PAJAR TRAFFIC LAB
 * Passive request receiver + traffic dashboard for this Worker only.
 * No outbound request generator, target selector, proxy, or attack controls.
 */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate',
      'x-content-type-options': 'nosniff',
    },
  });
}

function contentLength(headers) {
  const raw = headers.get('content-length');
  if (!raw || !/^\d+$/.test(raw)) return 0;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function cleanPath(url) {
  // Keep query strings out of logs because they may contain private values.
  const path = `${url.pathname}${url.search ? '?…' : ''}`;
  return path.length > 120 ? `${path.slice(0, 117)}…` : path;
}

function statusFamily(status) {
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 300 && status < 400) return '3xx';
  if (status >= 400 && status < 500) return '4xx';
  if (status >= 500 && status < 600) return '5xx';
  return 'other';
}

export default {
  async fetch(request, env) {
    const id = env.TRAFFIC_COUNTER.idFromName('pajar-traffic-lab-global');
    return env.TRAFFIC_COUNTER.get(id).fetch(request);
  },
};

export class TrafficCounter {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.liveSeconds = new Map();
    this.recentRequests = [];
    this.lastCleanupAt = 0;

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS traffic_totals (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        requests INTEGER NOT NULL DEFAULT 0,
        successful INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        bytes_in INTEGER NOT NULL DEFAULT 0,
        bytes_out INTEGER NOT NULL DEFAULT 0,
        duration_total_ms REAL NOT NULL DEFAULT 0,
        duration_max_ms REAL NOT NULL DEFAULT 0,
        peak_rps INTEGER NOT NULL DEFAULT 0,
        status_2xx INTEGER NOT NULL DEFAULT 0,
        status_3xx INTEGER NOT NULL DEFAULT 0,
        status_4xx INTEGER NOT NULL DEFAULT 0,
        status_5xx INTEGER NOT NULL DEFAULT 0,
        status_other INTEGER NOT NULL DEFAULT 0,
        method_get INTEGER NOT NULL DEFAULT 0,
        method_head INTEGER NOT NULL DEFAULT 0,
        method_post INTEGER NOT NULL DEFAULT 0,
        method_put INTEGER NOT NULL DEFAULT 0,
        method_delete INTEGER NOT NULL DEFAULT 0,
        method_other INTEGER NOT NULL DEFAULT 0,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER
      )
    `);

    this.sql.exec(
      'INSERT OR IGNORE INTO traffic_totals (id, first_seen_at) VALUES (1, ?)',
      Date.now(),
    );
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({ ok: true, service: 'PAJAR TRAFFIC LAB', storage: 'SQLite Durable Object' });
    }

    if (url.pathname === '/api/metrics') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      return json(this.snapshot());
    }

    // /target is a tiny receiver endpoint for normal, controlled lab requests.
    // It never reads the request body and never contacts another host.
    const started = performance.now();
    const bytesIn = contentLength(request.headers);
    let response;

    if (url.pathname === '/target') {
      if (!['GET', 'HEAD'].includes(request.method)) {
        response = new Response('Use GET or HEAD for this receiver endpoint.', { status: 405 });
      } else {
        response = new Response(request.method === 'HEAD' ? null : 'PAJAR TRAFFIC LAB · receiver online', {
          status: 200,
          headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
        });
      }
    } else {
      try {
        response = await this.env.ASSETS.fetch(request);
      } catch (_) {
        response = new Response('Asset unavailable', { status: 502 });
      }
    }

    const durationMs = Math.max(0, performance.now() - started);
    const bytesOut = contentLength(response.headers);
    this.record({
      method: request.method,
      path: cleanPath(url),
      status: response.status,
      durationMs,
      bytesIn,
      bytesOut,
    });

    return response;
  }

  record(event) {
    const now = Date.now();
    const second = Math.floor(now / 1000);
    const secondCount = (this.liveSeconds.get(second) || 0) + 1;
    this.liveSeconds.set(second, secondCount);

    // Keep a short live window in memory; persistent lifetime counters live in SQLite.
    for (const key of this.liveSeconds.keys()) {
      if (key < second - 59) this.liveSeconds.delete(key);
    }

    const success = event.status >= 200 && event.status < 400 ? 1 : 0;
    const failed = success ? 0 : 1;
    const family = statusFamily(event.status);
    const method = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'].includes(event.method)
      ? event.method
      : 'OTHER';

    const familyColumn = {
      '2xx': 'status_2xx',
      '3xx': 'status_3xx',
      '4xx': 'status_4xx',
      '5xx': 'status_5xx',
      other: 'status_other',
    }[family];
    const methodColumn = {
      GET: 'method_get',
      HEAD: 'method_head',
      POST: 'method_post',
      PUT: 'method_put',
      DELETE: 'method_delete',
      OTHER: 'method_other',
    }[method];

    // One persistent row is updated for each request. The SQL values are bound,
    // while the selected column names come only from the fixed maps above.
    this.sql.exec(
      `UPDATE traffic_totals SET
        requests = requests + 1,
        successful = successful + ?,
        failed = failed + ?,
        bytes_in = bytes_in + ?,
        bytes_out = bytes_out + ?,
        duration_total_ms = duration_total_ms + ?,
        duration_max_ms = MAX(duration_max_ms, ?),
        peak_rps = MAX(peak_rps, ?),
        ${familyColumn} = ${familyColumn} + 1,
        ${methodColumn} = ${methodColumn} + 1,
        last_seen_at = ?
       WHERE id = 1`,
      success,
      failed,
      event.bytesIn,
      event.bytesOut,
      event.durationMs,
      event.durationMs,
      secondCount,
      now,
    );

    this.recentRequests.unshift({ ...event, at: new Date(now).toISOString() });
    if (this.recentRequests.length > 40) this.recentRequests.length = 40;
  }

  snapshot() {
    const row = this.sql.exec('SELECT * FROM traffic_totals WHERE id = 1').toArray()[0];
    const nowSecond = Math.floor(Date.now() / 1000);
    const timeline = [];

    for (let offset = 59; offset >= 0; offset -= 1) {
      const second = nowSecond - offset;
      timeline.push({ t: second * 1000, requests: this.liveSeconds.get(second) || 0 });
    }

    const lastFive = timeline.slice(-5).reduce((sum, item) => sum + item.requests, 0);

    return {
      ok: true,
      totals: {
        requests: row.requests,
        successful: row.successful,
        failed: row.failed,
        successRate: row.requests ? (row.successful / row.requests) * 100 : 0,
        bytesIn: row.bytes_in,
        bytesOut: row.bytes_out,
        durationAvgMs: row.requests ? row.duration_total_ms / row.requests : 0,
        durationMaxMs: row.duration_max_ms,
        peakRps: row.peak_rps,
        currentRps: lastFive / 5,
        firstSeenAt: new Date(row.first_seen_at).toISOString(),
        lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
      },
      statusCodes: {
        '2xx': row.status_2xx,
        '3xx': row.status_3xx,
        '4xx': row.status_4xx,
        '5xx': row.status_5xx,
        other: row.status_other,
      },
      methods: {
        GET: row.method_get,
        HEAD: row.method_head,
        POST: row.method_post,
        PUT: row.method_put,
        DELETE: row.method_delete,
        OTHER: row.method_other,
      },
      timeline,
      recent: this.recentRequests,
      runtime: {
        platform: 'Cloudflare Workers',
        storage: 'SQLite-backed Durable Object',
        liveLog: 'in-memory; cleared when the object restarts',
      },
    };
  }
}
