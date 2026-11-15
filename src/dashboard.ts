import type { TtlCache } from "./utils/cache.js";
import type { TelemetryCollector } from "./utils/telemetry.js";

export interface DashboardContext {
  serverName: string;
  serverVersion: string;
  enabledProviders: string[];
  registeredTools: string[];
  activeSessions: () => number;
  cache: TtlCache<unknown>;
  telemetry: TelemetryCollector;
}

export function buildDashboardStatsPayload(ctx: DashboardContext) {
  const mem = process.memoryUsage();
  const cacheStats = ctx.cache.detailedStats();
  const telemetrySnap = ctx.telemetry.snapshot();

  return {
    status: "ok",
    timestamp: new Date().toISOString(),
    server: {
      name: ctx.serverName,
      version: ctx.serverVersion,
      uptimeSeconds: telemetrySnap.uptimeSeconds,
      startedAt: telemetrySnap.startedAt,
      activeSessions: ctx.activeSessions(),
      enabledProviders: ctx.enabledProviders,
      registeredTools: ctx.registeredTools,
      memoryMb: {
        rss: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
        heapUsed: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
        heapTotal: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10,
      },
    },
    cache: cacheStats,
    telemetry: telemetrySnap,
  };
}

export function renderDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Eberli Hotel MCP — Live Dashboard</title>
  <style>
    :root {
      --bg: #0b1020;
      --bg-card: #131b31;
      --bg-card-alt: #18223d;
      --border: #253256;
      --text: #e8eefc;
      --muted: #93a3c7;
      --accent: #38bdf8;
      --accent-2: #818cf8;
      --ok: #22c55e;
      --warn: #f59e0b;
      --err: #ef4444;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    .container {
      max-width: 1440px;
      margin: 0 auto;
      padding: 24px;
    }
    header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 24px;
    }
    .brand h1 {
      margin: 0;
      font-size: 1.5rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .brand p {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 0.88rem;
    }
    .controls {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .btn {
      background: var(--bg-card-alt);
      color: var(--text);
      border: 1px solid var(--border);
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 0.85rem;
      cursor: pointer;
      text-decoration: none;
      transition: border-color 0.15s, background 0.15s;
    }
    .btn:hover {
      border-color: var(--accent);
      background: #1e2b4d;
    }
    .grid-4 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(270px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .grid-3 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 18px 20px;
    }
    .card-title {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .kpi-value {
      font-size: 2rem;
      font-weight: 700;
      margin: 4px 0 8px;
    }
    .kpi-sub {
      font-size: 0.83rem;
      color: var(--muted);
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .progress-bar {
      width: 100%;
      height: 8px;
      background: #0d1428;
      border-radius: 999px;
      overflow: hidden;
      margin: 8px 0 10px;
      border: 1px solid var(--border);
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--accent), var(--ok));
      transition: width 0.3s ease;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 9px;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge-ok { background: rgba(34,197,94,0.16); color: #4ade80; border: 1px solid rgba(34,197,94,0.35); }
    .badge-warn { background: rgba(245,158,11,0.16); color: #fbbf24; border: 1px solid rgba(245,158,11,0.35); }
    .badge-err { background: rgba(239,68,68,0.16); color: #f87171; border: 1px solid rgba(239,68,68,0.35); }
    .badge-info { background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid rgba(56,189,248,0.35); }
    .badge-purple { background: rgba(129,140,248,0.16); color: #a5b4fc; border: 1px solid rgba(129,140,248,0.35); }
    .section-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 14px;
    }
    .section-header h2 {
      margin: 0;
      font-size: 1.1rem;
    }
    input.search-box {
      background: #0d1428;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 7px 12px;
      border-radius: 8px;
      font-size: 0.85rem;
      min-width: 260px;
    }
    .table-wrap {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    th, td {
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }
    th {
      color: var(--muted);
      font-weight: 600;
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    td.wrap {
      white-space: normal;
      max-width: 420px;
      word-break: break-word;
    }
    tr:hover td {
      background: rgba(255,255,255,0.02);
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.8rem;
      background: rgba(15, 23, 42, 0.7);
      padding: 2px 6px;
      border-radius: 5px;
      color: #bae6fd;
    }
    .chip-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }
    .stat-row {
      display: flex;
      justify-content: space-between;
      padding: 5px 0;
      border-bottom: 1px dashed rgba(255,255,255,0.07);
      font-size: 0.84rem;
    }
    .stat-row:last-child { border-bottom: none; }
    .empty {
      color: var(--muted);
      text-align: center;
      padding: 24px;
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <h1>
          <span>🏨 Eberli Hotel Intelligence MCP — Dashboard</span>
          <span id="version-badge" class="badge badge-info">v1.1.0</span>
          <span id="status-badge" class="badge badge-ok">ONLINE</span>
        </h1>
        <p id="uptime-line">Lade Server-Telemetrie…</p>
      </div>
      <div class="controls">
        <label style="font-size:0.85rem; color:var(--muted); display:flex; align-items:center; gap:6px; cursor:pointer;">
          <input type="checkbox" id="auto-refresh" checked />
          Auto-Refresh (5s)
        </label>
        <button class="btn" id="refresh-btn">🔄 Jetzt aktualisieren</button>
        <a class="btn" href="/api/stats" target="_blank">📊 JSON Stats</a>
        <a class="btn" href="/health" target="_blank">🩺 /health</a>
      </div>
    </header>

    <!-- Top KPIs -->
    <div class="grid-4">
      <div class="card">
        <div class="card-title">
          <span>⚡ Cache Hit-Rate</span>
          <span id="cache-ttl-badge" class="badge badge-info">TTL: -</span>
        </div>
        <div class="kpi-value" id="kpi-hit-rate">0.0%</div>
        <div class="progress-bar"><div class="progress-fill" id="hit-rate-bar" style="width:0%"></div></div>
        <div class="kpi-sub">
          <span>Hits: <strong id="kpi-hits" style="color:var(--ok)">0</strong></span>
          <span>Misses: <strong id="kpi-misses" style="color:var(--warn)">0</strong></span>
          <span>Einträge: <strong id="kpi-cache-size">0 / 0</strong></span>
          <span>Stale: <strong id="kpi-stale">0</strong></span>
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <span>🛠️ MCP Tool-Anfragen</span>
          <span id="kpi-sessions" class="badge badge-purple">0 Sessions</span>
        </div>
        <div class="kpi-value" id="kpi-tool-calls">0</div>
        <div class="kpi-sub">
          <span>Ø Dauer: <strong id="kpi-tool-avg">0 ms</strong></span>
          <span>Fehler: <strong id="kpi-tool-errors">0</strong></span>
          <span>Registrierte Tools: <strong id="kpi-tools-count">18</strong></span>
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <span>🌐 Externe API-Aufrufe</span>
          <span id="kpi-429-badge" class="badge badge-ok">0 Rate-Limits (429)</span>
        </div>
        <div class="kpi-value" id="kpi-http-calls">0</div>
        <div class="kpi-sub" id="kpi-http-breakdown">
          <span>TripAdvisor: <strong>0</strong></span>
          <span>Google: <strong>0</strong></span>
          <span>Trip.com: <strong>0</strong></span>
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <span>🖥️ System & Provider</span>
          <span id="kpi-mem" class="badge badge-info">RAM: - MB</span>
        </div>
        <div class="chip-list" id="provider-badges" style="margin-top:12px;"></div>
        <div class="kpi-sub" style="margin-top:14px;">
          <span>Cache-Evictions: <strong id="kpi-evictions">0</strong></span>
          <span>In-Flight: <strong id="kpi-inflight">0</strong></span>
        </div>
      </div>
    </div>

    <!-- Provider Rate-Limit & Health Cards -->
    <div class="grid-3" id="provider-cards"></div>

    <!-- Cache Breakdown by Prefix -->
    <div class="section-card">
      <div class="section-header">
        <h2>📦 Gespeicherte Cache-Einträge nach Kategorie</h2>
        <span style="font-size:0.82rem; color:var(--muted);" id="stale-info">Stale-If-Error Schutz aktiv</span>
      </div>
      <div class="chip-list" id="cache-prefix-chips"></div>
    </div>

    <!-- Recent MCP Tool Calls -->
    <div class="section-card">
      <div class="section-header">
        <h2>🕒 Letzte MCP Tool-Anfragen</h2>
        <input type="text" class="search-box" id="tool-filter" placeholder="Filter nach Tool, Hotel oder Stadt…" />
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Zeit</th>
              <th>MCP Tool</th>
              <th>Provider</th>
              <th>Parameter / Hotel</th>
              <th>Cache-Nutzung</th>
              <th>Dauer</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody id="recent-tools-body">
            <tr><td colspan="7" class="empty">Noch keine MCP Tool-Anfragen seit Serverstart.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Tool Performance Metrics & Recent Upstream HTTP Calls -->
    <div class="grid-3" style="grid-template-columns: repeat(auto-fit, minmax(460px, 1fr));">
      <div class="section-card" style="margin-bottom:0;">
        <div class="section-header">
          <h2>📈 Statistik pro MCP-Tool</h2>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tool</th>
                <th>Aufrufe</th>
                <th>Voll-Cache</th>
                <th>Fehler</th>
                <th>Ø Dauer</th>
              </tr>
            </thead>
            <tbody id="tool-metrics-body">
              <tr><td colspan="5" class="empty">Noch keine Daten.</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="section-card" style="margin-bottom:0;">
        <div class="section-header">
          <h2>🌍 Letzte Externe API-Requests (Upstream)</h2>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Zeit</th>
                <th>Provider</th>
                <th>HTTP Status</th>
                <th>Dauer</th>
                <th>Endpoint</th>
              </tr>
            </thead>
            <tbody id="recent-http-body">
              <tr><td colspan="5" class="empty">Noch keine externen HTTP-Requests.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <script>
    let lastData = null;

    function formatUptime(sec) {
      const d = Math.floor(sec / 86400);
      const h = Math.floor((sec % 86400) / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      const parts = [];
      if (d > 0) parts.push(d + 'd');
      if (h > 0) parts.push(h + 'h');
      if (m > 0) parts.push(m + 'm');
      parts.push(s + 's');
      return parts.join(' ');
    }

    function formatTime(iso) {
      if (!iso) return '-';
      const d = new Date(iso);
      return d.toLocaleTimeString('de-CH', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
    }

    function escapeHtml(str) {
      return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function render(data) {
      lastData = data;
      const { server, cache, telemetry } = data;

      document.getElementById('version-badge').textContent = 'v' + server.version;
      document.getElementById('uptime-line').textContent =
        'Uptime: ' + formatUptime(server.uptimeSeconds) +
        ' · Gestartet: ' + new Date(server.startedAt).toLocaleString('de-CH') +
        ' · Stand: ' + new Date(data.timestamp).toLocaleTimeString('de-CH');

      // Cache KPIs
      document.getElementById('kpi-hit-rate').textContent = cache.hitRatePercent.toFixed(1) + '%';
      document.getElementById('hit-rate-bar').style.width = Math.min(100, cache.hitRatePercent) + '%';
      document.getElementById('kpi-hits').textContent = cache.hits;
      document.getElementById('kpi-misses').textContent = cache.misses;
      document.getElementById('kpi-cache-size').textContent = cache.size + ' / ' + cache.maxEntries;
      document.getElementById('kpi-stale').textContent = cache.staleRetainedCount;
      document.getElementById('cache-ttl-badge').textContent = 'TTL: ' + Math.round(cache.ttlSeconds / 60) + 'm';
      document.getElementById('stale-info').textContent =
        'Frische TTL: ' + cache.ttlSeconds + 's · Stale-If-Error Schutzfenster: ' + cache.staleTtlSeconds + 's';

      // Tool KPIs
      document.getElementById('kpi-tool-calls').textContent = telemetry.totalToolCalls;
      document.getElementById('kpi-tool-avg').textContent = telemetry.avgToolDurationMs + ' ms';
      document.getElementById('kpi-tool-errors').textContent = telemetry.totalToolErrors;
      document.getElementById('kpi-tools-count').textContent = server.registeredTools.length;
      document.getElementById('kpi-sessions').textContent = server.activeSessions + ' aktive Session(s)';

      // HTTP KPIs
      document.getElementById('kpi-http-calls').textContent = telemetry.totalUpstreamHttpCalls;
      const rlBadge = document.getElementById('kpi-429-badge');
      rlBadge.textContent = telemetry.totalRateLimit429 + ' Rate-Limits (429)';
      rlBadge.className = 'badge ' + (telemetry.totalRateLimit429 > 0 ? 'badge-err' : 'badge-ok');

      const pStats = telemetry.providerHttpStats || {};
      document.getElementById('kpi-http-breakdown').innerHTML =
        '<span>TripAdvisor: <strong>' + (pStats.tripadvisor_terra?.totalCalls ?? 0) + '</strong></span>' +
        '<span>Google: <strong>' + (pStats.google_places?.totalCalls ?? 0) + '</strong></span>' +
        '<span>Trip.com: <strong>' + (pStats.china_travel?.totalCalls ?? 0) + '</strong></span>';

      // System
      document.getElementById('kpi-mem').textContent =
        'RAM: ' + server.memoryMb.heapUsed + ' / ' + server.memoryMb.rss + ' MB';
      document.getElementById('kpi-evictions').textContent = cache.evictions;
      document.getElementById('kpi-inflight').textContent = cache.inFlightCount;

      document.getElementById('provider-badges').innerHTML = server.enabledProviders
        .map(p => '<span class="badge badge-ok">✓ ' + escapeHtml(p) + '</span>')
        .join('');

      // Provider Cards
      const providerNames = {
        tripadvisor_terra: '🦉 TripAdvisor Terra API',
        google_places: '📍 Google Places API (New)',
        china_travel: '🐉 China Travel / Trip.com'
      };
      document.getElementById('provider-cards').innerHTML = Object.entries(providerNames)
        .map(([key, label]) => {
          const st = pStats[key] || {
            totalCalls: 0, successCalls: 0, rateLimit429Count: 0,
            notFound404Count: 0, error5xxCount: 0, networkErrorCount: 0, avgDurationMs: 0
          };
          return '<div class="card">' +
            '<div class="card-title"><span>' + label + '</span>' +
            '<span class="badge ' + (st.rateLimit429Count > 0 ? 'badge-err' : 'badge-ok') + '">' +
            (st.rateLimit429Count > 0 ? st.rateLimit429Count + 'x 429' : 'Kein Rate-Limit') + '</span></div>' +
            '<div class="stat-row"><span>Externe HTTP-Calls gesamt</span><strong>' + st.totalCalls + '</strong></div>' +
            '<div class="stat-row"><span>Erfolgreich (2xx)</span><strong style="color:var(--ok)">' + st.successCalls + '</strong></div>' +
            '<div class="stat-row"><span>Allowlist / Nicht gefunden (404)</span><strong style="color:var(--warn)">' + st.notFound404Count + '</strong></div>' +
            '<div class="stat-row"><span>Rate-Limit (429) / 5xx Fehler</span><strong style="color:var(--err)">' + st.rateLimit429Count + ' / ' + (st.error5xxCount + st.networkErrorCount) + '</strong></div>' +
            '<div class="stat-row"><span>Ø Antwortzeit</span><strong>' + st.avgDurationMs + ' ms</strong></div>' +
            '<div class="stat-row"><span>Letzter Aufruf</span><span>' + formatTime(st.lastCalledAt) + '</span></div>' +
            '</div>';
        })
        .join('');

      // Cache Prefix Chips
      const prefixes = Object.entries(cache.entriesByPrefix || {});
      document.getElementById('cache-prefix-chips').innerHTML = prefixes.length > 0
        ? prefixes.map(([k, count]) => '<span class="badge badge-info">' + escapeHtml(k) + ': <strong>&nbsp;' + count + '</strong></span>').join('')
        : '<span style="color:var(--muted); font-size:0.85rem;">Cache ist aktuell noch leer.</span>';

      renderToolTable();

      // Tool Metrics Table
      const tmBody = document.getElementById('tool-metrics-body');
      if (telemetry.toolMetrics && telemetry.toolMetrics.length > 0) {
        tmBody.innerHTML = telemetry.toolMetrics.map(m => {
          const cachePct = m.calls > 0 ? Math.round((m.cacheHitCalls / m.calls) * 100) : 0;
          return '<tr>' +
            '<td><code>' + escapeHtml(m.toolName) + '</code></td>' +
            '<td><strong>' + m.calls + '</strong></td>' +
            '<td><span class="badge ' + (cachePct >= 50 ? 'badge-ok' : 'badge-info') + '">' + m.cacheHitCalls + ' (' + cachePct + '%)</span></td>' +
            '<td>' + (m.errors > 0 ? '<span class="badge badge-err">' + m.errors + '</span>' : '0') + '</td>' +
            '<td>' + m.avgDurationMs + ' ms</td>' +
            '</tr>';
        }).join('');
      }

      // Recent HTTP Calls Table
      const httpBody = document.getElementById('recent-http-body');
      if (telemetry.recentHttpCalls && telemetry.recentHttpCalls.length > 0) {
        httpBody.innerHTML = telemetry.recentHttpCalls.slice(0, 25).map(h => {
          const stClass = h.status >= 200 && h.status < 300 ? 'badge-ok' : h.status === 404 ? 'badge-warn' : 'badge-err';
          const shortUrl = h.url.replace(/^https?:\/\/[^/]+/, '');
          return '<tr>' +
            '<td>' + formatTime(h.timestamp) + '</td>' +
            '<td><span class="badge badge-purple">' + escapeHtml(h.provider) + '</span></td>' +
            '<td><span class="badge ' + stClass + '">' + escapeHtml(h.status ?? 'ERR') + '</span></td>' +
            '<td>' + h.durationMs + ' ms</td>' +
            '<td class="wrap" title="' + escapeHtml(h.url) + '"><code>' + escapeHtml(h.method + ' ' + shortUrl.slice(0, 65)) + '</code></td>' +
            '</tr>';
        }).join('');
      }
    }

    function renderToolTable() {
      if (!lastData) return;
      const filter = (document.getElementById('tool-filter').value || '').toLowerCase().trim();
      const rows = (lastData.telemetry.recentToolCalls || []).filter(r => {
        if (!filter) return true;
        return r.toolName.toLowerCase().includes(filter) ||
               r.argsSummary.toLowerCase().includes(filter) ||
               r.provider.toLowerCase().includes(filter);
      });

      const tbody = document.getElementById('recent-tools-body');
      if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty">Keine passenden MCP-Anfragen gefunden.</td></tr>';
        return;
      }

      tbody.innerHTML = rows.slice(0, 50).map(r => {
        const cacheBadge = r.servedFromCache
          ? '<span class="badge badge-ok">⚡ 100% Cache (+' + r.cacheHitsDelta + ' Hits)</span>'
          : r.cacheHitsDelta > 0
            ? '<span class="badge badge-info">⚡ ' + r.cacheHitsDelta + ' Hits / ' + r.cacheMissesDelta + ' Miss</span>'
            : '<span class="badge badge-warn">🌐 Upstream (' + r.cacheMissesDelta + ' Miss)</span>';

        const statusBadge = r.status === 'ok'
          ? '<span class="badge badge-ok">OK</span>'
          : '<span class="badge badge-err" title="' + escapeHtml(r.errorMessage) + '">ERROR</span>';

        return '<tr>' +
          '<td>' + formatTime(r.timestamp) + '</td>' +
          '<td><code>' + escapeHtml(r.toolName) + '</code></td>' +
          '<td><span class="badge badge-purple">' + escapeHtml(r.provider) + '</span></td>' +
          '<td class="wrap" title="' + escapeHtml(r.argsJson) + '">' + escapeHtml(r.argsSummary) + '</td>' +
          '<td>' + cacheBadge + '</td>' +
          '<td><strong>' + r.durationMs + ' ms</strong></td>' +
          '<td>' + statusBadge + '</td>' +
          '</tr>';
      }).join('');
    }

    async function fetchStats() {
      try {
        const res = await fetch('/api/stats');
        if (!res.ok) return;
        const data = await res.json();
        render(data);
      } catch (e) {
        console.error('Failed to fetch dashboard stats', e);
      }
    }

    document.getElementById('refresh-btn').addEventListener('click', fetchStats);
    document.getElementById('tool-filter').addEventListener('input', renderToolTable);

    fetchStats();
    setInterval(() => {
      if (document.getElementById('auto-refresh').checked) {
        fetchStats();
      }
    }, 5000);
  </script>
</body>
</html>`;
}
