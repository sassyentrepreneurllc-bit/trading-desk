(function () {
  'use strict';

  // ---- data source from hash / localStorage (never hardcode secrets) ----
  // Primary:  #j=<ns>/<id>   or   #data=https://brewpage.app/api/json/<ns>/<id>
  // Fallback: #d=<relative-path> under Pages d/ (local/static)
  // Views:    coin/MINT · audit/MINT · agent/Name · home|agents|activity|account
  //           also &tab= / &view= query forms on the same hash
  function parseSourceFromRaw(raw) {
    const params = new URLSearchParams(raw.includes('=') ? raw : '');
    let j = params.get('j');
    let data = params.get('data');
    const d = params.get('d');
    if (j) {
      j = j.replace(/^\/+/, '');
      const url = 'https://brewpage.app/api/json/' + j;
      return { kind: 'brew', url, j, d: null };
    }
    if (data) {
      try {
        const u = new URL(data);
        if (u.hostname.endsWith('brewpage.app') && u.pathname.includes('/api/json/')) {
          const parts = u.pathname.split('/').filter(Boolean); // api, json, ns, id
          const idx = parts.indexOf('json');
          const ns = parts[idx + 1];
          const id = parts[idx + 2];
          if (ns && id) {
            return { kind: 'brew', url: `https://brewpage.app/api/json/${ns}/${id}`, j: `${ns}/${id}`, d: null };
          }
        }
      } catch (_) {}
      return { kind: 'brew', url: data, j: null, d: null };
    }
    if (d) return { kind: 'files', url: null, j: null, d };
    return null;
  }

  function parseHash() {
    const raw = (location.hash || '').replace(/^#/, '');
    if (raw.startsWith('coin/')) return { view: 'coin', mint: decodeURIComponent(raw.slice(5)) };
    if (raw.startsWith('audit/')) return { view: 'audit', mint: decodeURIComponent(raw.slice(6)) };
    if (raw.startsWith('agent/')) return { view: 'agent', name: decodeURIComponent(raw.slice(6)) };
    if (/^(home|agents|activity|account)$/.test(raw)) return { view: raw };
    const params = new URLSearchParams(raw);
    const src = parseSourceFromRaw(raw);
    if (src) {
      if (src.kind === 'brew') {
        localStorage.setItem('desk_data_url', src.url);
        if (src.j) localStorage.setItem('desk_data_j', src.j);
        localStorage.removeItem('desk_data_path');
      } else if (src.d) {
        localStorage.setItem('desk_data_path', src.d);
        localStorage.removeItem('desk_data_url');
        localStorage.removeItem('desk_data_j');
      }
    }
    const tab = params.get('tab');
    const view = params.get('view');
    const mint = params.get('mint');
    const name = params.get('name');
    if (view === 'coin' && mint) return { view: 'coin', mint };
    if (view === 'audit' && mint) return { view: 'audit', mint };
    if (view === 'agent' && name) return { view: 'agent', name };
    if (tab) return { view: tab };
    return { view: 'home' };
  }

  let dataUrl = localStorage.getItem('desk_data_url') || '';
  let dataPath = localStorage.getItem('desk_data_path') || '';
  // bootstrap from hash if present
  {
    const raw = (location.hash || '').replace(/^#/, '');
    const src = parseSourceFromRaw(raw);
    if (src) {
      if (src.kind === 'brew') {
        dataUrl = src.url;
        dataPath = '';
        localStorage.setItem('desk_data_url', dataUrl);
        if (src.j) localStorage.setItem('desk_data_j', src.j);
        localStorage.removeItem('desk_data_path');
      } else if (src.d) {
        dataPath = src.d;
        dataUrl = '';
        localStorage.setItem('desk_data_path', dataPath);
        localStorage.removeItem('desk_data_url');
        localStorage.removeItem('desk_data_j');
      }
    }
  }

  const base = () => (dataPath ? `d/${dataPath}` : null);
  const errEl = document.getElementById('err');
  let lastOk = null, retry = 5;
  let range = 'LIVE';
  let cache = { state: null, chart: null, activity: null, account: null, settings: null, agents: {}, coin: {}, audit: {} };
  let pollTimer = null;
  let bundleMode = !!dataUrl;

  function showErr(msg) { errEl.hidden = false; errEl.textContent = msg; }
  function hideErr() { errEl.hidden = true; }
  function money(n) {
    return '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function pct(n) {
    const v = Number(n) || 0;
    return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function shortMint(m) {
    if (!m || m.length < 10) return m || '';
    return m.slice(0, 4) + '…' + m.slice(-4);
  }
  function isFomoUrl(u) {
    return typeof u === 'string' && u.includes('fomo.family') && (u.includes('r=savipww') || u.includes('/r/savipww'));
  }

  async function fetchJson(path) {
    const r = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }

  async function loadCore() {
    try {
      if (dataUrl) {
        bundleMode = true;
        const bundle = await fetchJson(dataUrl);
        hideErr(); lastOk = new Date(); retry = 5;
        cache = {
          state: bundle.state || null,
          chart: bundle.chart || { points: [], marks: [], start: null },
          activity: bundle.activity || { rows: [] },
          account: bundle.account || null,
          settings: bundle.settings || {},
          agents: bundle.agents || {},
          coin: bundle.coin || {},
          audit: bundle.audit || {},
        };
      } else {
        bundleMode = false;
        const b = base();
        if (!b) {
          showErr('Missing data source. Open the link that ends with #j=… or #d=…');
          return;
        }
        const [state, chart, activity, account, settings] = await Promise.all([
          fetchJson(`${b}/state.json`),
          fetchJson(`${b}/chart.json`).catch(() => ({ points: [], marks: [], start: null })),
          fetchJson(`${b}/activity.json`).catch(() => ({ rows: [] })),
          fetchJson(`${b}/account.json`).catch(() => null),
          fetchJson(`${b}/settings.json`).catch(() => ({})),
        ]);
        hideErr(); lastOk = new Date(); retry = 5;
        cache = { state, chart, activity, account, settings, agents: {}, coin: {}, audit: {} };
      }
      renderHome();
      renderAgentsTab();
      renderActivityTab();
      renderAccount();
    } catch (e) {
      retry = Math.min(60, retry + 5);
      const t = lastOk ? lastOk.toLocaleTimeString() : 'never';
      showErr(`Desk offline · retrying in ${retry}s · last update ${t}`);
    }
  }

  async function loadAgentDecisions(name) {
    if (bundleMode) {
      const key = String(name || '').toLowerCase();
      return (cache.agents && (cache.agents[key] || cache.agents[name])) || { rows: [] };
    }
    const b = base();
    if (!b) return { rows: [] };
    return fetchJson(`${b}/agents/${name.toLowerCase()}.json`);
  }

  async function loadAudit(mint) {
    if (bundleMode) return (cache.audit && cache.audit[mint]) || null;
    const b = base();
    if (!b) return null;
    return fetchJson(`${b}/audit/${mint}.json`);
  }

  async function loadCoin(mint) {
    if (bundleMode) return (cache.coin && cache.coin[mint]) || null;
    const b = base();
    if (!b) return null;
    return fetchJson(`${b}/coin/${mint}.json`);
  }

  function filterPoints(points) {
    if (!points || !points.length || range === 'LIVE' || range === 'ALL') return points || [];
    const now = Date.now();
    const ms = { '1H': 3600e3, '4H': 14400e3, '1D': 86400e3, '1W': 604800e3 }[range];
    if (!ms) return points;
    return points.filter(p => {
      const t = Date.parse(p.t);
      return !Number.isNaN(t) && now - t <= ms;
    });
  }

  function activityRowHtml(r) {
    const mint = r.mint ? ` data-mint="${esc(r.mint)}" data-kind="${esc(r.kind || '')}"` : '';
    return `<button type="button" class="row"${mint}>
      <div><div class="t">${esc(r.title || r.kind || 'event')}</div>
      <div class="s">${esc(r.subtitle || (r.agent ? r.agent + (r.mint ? ' · ' + shortMint(r.mint) : '') : ''))}</div></div>
      <div class="v">${esc(r.value || '')}</div></button>`;
  }

  function wireActivityClicks(root) {
    root.querySelectorAll('.row[data-mint]').forEach(el => {
      el.addEventListener('click', () => {
        const mint = el.getAttribute('data-mint');
        const kind = el.getAttribute('data-kind') || '';
        if (kind === 'audit' || kind === 'reject') location.hash = 'audit/' + encodeURIComponent(mint);
        else location.hash = 'coin/' + encodeURIComponent(mint);
      });
    });
  }

  function statusClass(status, runningClass) {
    const s = status || 'idle';
    if (s === 'running') return runningClass;
    if (s === 'degraded' || s === 'stale') return 'red';
    return 'yellow';
  }

  function renderHome() {
    const state = cache.state; if (!state) return;
    document.getElementById('balance').textContent = money(state.balance);
    const today = document.getElementById('today');
    today.textContent = pct(state.todayPct);
    today.classList.toggle('down', (state.todayPct || 0) < 0);
    document.getElementById('mult').textContent = ((state.multiplier || 1).toFixed(2)) + '×';
    const paper = document.getElementById('paper');
    paper.hidden = state.mode !== 'PAPER';

    const agents = state.agents || [];
    const running = agents.filter(a => a.status === 'running').length;
    document.getElementById('agentCount').textContent = String(running);
    const car = document.getElementById('agentsCarousel');
    car.innerHTML = agents.map(a => `
      <button type="button" class="agent-card" data-agent="${esc(a.name)}">
        <div class="name">${esc(a.name)}</div>
        <div class="meta">${esc(a.subtitle || a.status || '')}</div>
        <div class="status"><span class="pill ${statusClass(a.status, 'green')}">${esc(a.status || 'idle')}</span></div>
      </button>`).join('') || '<div class="empty">Listening for graduations</div>';
    car.querySelectorAll('[data-agent]').forEach(el => {
      el.addEventListener('click', () => {
        location.hash = 'agent/' + encodeURIComponent(el.getAttribute('data-agent'));
      });
    });

    const act = document.getElementById('activityPreview');
    const rows = (cache.activity?.rows || []).slice(0, 5);
    act.innerHTML = rows.length ? rows.map(activityRowHtml).join('') : '<div class="empty">Nothing yet tonight</div>';
    wireActivityClicks(act);

    const pts = filterPoints(cache.chart?.points || []);
    DeskChart.drawLine(document.getElementById('chart'), pts, cache.chart?.marks || [], cache.chart?.start);
  }

  function renderAgentsTab() {
    const list = document.getElementById('agentsList');
    const agents = cache.state?.agents || [];
    list.innerHTML = agents.map(a => `
      <button type="button" class="agent-card compact" data-agent="${esc(a.name)}">
        <div class="name">${esc(a.name)}</div>
        <div class="meta">${esc(a.subtitle || '')}</div>
        <div class="status"><span class="pill ${statusClass(a.status, 'cyan')}">${esc(a.status || '')}</span></div>
      </button>`).join('') || '<div class="empty">No agents</div>';
    list.querySelectorAll('[data-agent]').forEach(el => {
      el.addEventListener('click', () => {
        location.hash = 'agent/' + encodeURIComponent(el.getAttribute('data-agent'));
      });
    });
  }

  function renderActivityTab() {
    const list = document.getElementById('activityList');
    const rows = cache.activity?.rows || [];
    list.innerHTML = rows.length ? rows.map(activityRowHtml).join('') : '<div class="empty">Nothing yet tonight</div>';
    wireActivityClicks(list);
  }

  function renderAccount() {
    const acct = cache.account || {};
    const mode = acct.mode || cache.state?.mode || 'PAPER';
    document.getElementById('acctMode').textContent = mode;
    const pill = document.getElementById('acctModePill');
    pill.textContent = mode;
    pill.className = 'pill ' + (mode === 'PAPER' ? 'orange' : 'green');
    document.getElementById('acctModeHint').textContent =
      'Plan B — switching LIVE is display-only here; change via Telegram / bot (no POST).';
    document.getElementById('acctStack').textContent = money(acct.stack != null ? acct.stack : cache.state?.balance);
    const handle = acct.fomo_handle || (cache.settings && cache.settings.fomo_handle) || '—';
    document.getElementById('acctHandle').textContent = handle.startsWith('@') ? handle : '@' + handle;
    const tg = acct.telegram || {};
    document.getElementById('acctTg').textContent =
      (tg.connected ? 'Telegram connected' : 'Telegram · not connected') +
      (tg.bot ? ' · @' + tg.bot : '') +
      ' · Alerts via Telegram (Plan B — no web push)';
    document.getElementById('acctHost').textContent =
      (acct.hosting === 'B' || acct.hosting === 'Plan B') ? 'Plan B · GitHub Pages' : String(acct.hosting || 'B');
    document.getElementById('acctHostNote').textContent = acct.hosting_note || 'Static JSON only; alerts via Telegram.';

    // FOMO profile — only open URL from JSON if it carries r=savipww
    const profile = document.getElementById('acctProfile');
    profile.onclick = () => {
      const u = acct.profile_url;
      if (isFomoUrl(u)) window.open(u, '_blank', 'noopener');
      else showErr('No FOMO profile URL in account.json');
    };
    document.getElementById('acctInvite').onclick = async () => {
      const u = acct.signup_url;
      if (!isFomoUrl(u) && !(typeof u === 'string' && u.includes('/r/savipww'))) {
        showErr('No signup URL in account.json');
        return;
      }
      if (navigator.share) {
        try { await navigator.share({ title: 'FOMO', url: u }); return; } catch (_) { /* fall through */ }
      }
      try {
        await navigator.clipboard.writeText(u);
        showErr('Invite link copied');
        setTimeout(hideErr, 2000);
      } catch (_) {
        prompt('Copy invite link', u);
      }
    };

    // settings grouped read-only
    const groups = {};
    const settings = cache.settings || {};
    Object.keys(settings).sort().forEach(k => {
      // never surface secret-looking keys if somehow exported
      if (/token|secret|key|password|vapid|chat_id/i.test(k) && k !== 'owner_chat_id') return;
      if (k === 'owner_chat_id') return; // keep private
      const g = k.includes('.') ? k.split('.')[0] : 'general';
      (groups[g] || (groups[g] = [])).push([k, settings[k]]);
    });
    const box = document.getElementById('settingsGroups');
    box.innerHTML = Object.keys(groups).map(g => `
      <div class="group-title">${esc(g)}</div>
      ${groups[g].map(([k, v]) => `<div class="setting-row"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('')}
    `).join('') || '<div class="empty">No settings</div>';
  }

  async function openAgent(name) {
    showOverlay('agent');
    document.getElementById('agentTitle').textContent = name;
    const box = document.getElementById('agentDecisions');
    box.innerHTML = '<div class="loading"></div>';
    try {
      const data = await loadAgentDecisions(name);
      const rows = (data && data.rows) || [];
      box.innerHTML = rows.length ? rows.map(activityRowHtml).join('') : '<div class="empty">No decisions yet</div>';
      wireActivityClicks(box);
    } catch (_) {
      box.innerHTML = '<div class="empty">Could not load decisions</div>';
    }
  }

  async function openAudit(mint) {
    showOverlay('audit');
    const status = document.getElementById('auditStatus');
    const layersEl = document.getElementById('auditLayers');
    const fomo = document.getElementById('auditFomo');
    status.className = 'audit-status';
    status.textContent = 'Loading…';
    layersEl.innerHTML = '';
    fomo.hidden = true;
    try {
      const audit = await loadAudit(mint);
      if (!audit) throw new Error('missing');
      // animate live cyan → green/red
      const layers = audit.layers || [];
      layersEl.innerHTML = layers.map(l => `
        <div class="layer live" data-n="${l.n}">
          <div><div class="ln">${esc(l.n)}. ${esc(l.name)}</div>
          <div class="lv">${esc(l.value || '')}${l.source ? ' · ' + esc(l.source) : ''}</div></div>
          <div class="mark">…</div>
        </div>`).join('');
      // reveal results
      let i = 0;
      const tick = () => {
        if (i >= layers.length) {
          const ok = !!audit.passed;
          status.textContent = ok ? 'cleared · 8/8' : 'rejected · ' + layers.filter(l => l.pass).length + '/8';
          status.className = 'audit-status ' + (ok ? 'ok' : 'bad');
          // FOMO from coin json only
          loadCoin(mint).then(coin => {
            if (coin && isFomoUrl(coin.coin_url)) {
              fomo.href = coin.coin_url;
              fomo.hidden = false;
              fomo.textContent = 'Open on FOMO';
            }
          }).catch(() => {});
          return;
        }
        const l = layers[i];
        const el = layersEl.querySelector(`[data-n="${l.n}"]`);
        if (el) {
          el.classList.remove('live');
          el.classList.add(l.pass ? 'pass' : 'fail');
          const mark = el.querySelector('.mark');
          mark.textContent = l.pass ? 'PASS' : 'FAIL';
          mark.className = 'mark ' + (l.pass ? 'pass' : 'fail');
        }
        i += 1;
        setTimeout(tick, 90);
      };
      setTimeout(tick, 120);
    } catch (_) {
      status.textContent = 'Audit not found';
      status.className = 'audit-status bad';
    }
  }

  async function openCoin(mint) {
    showOverlay('coin');
    document.getElementById('coinTitle').textContent = shortMint(mint);
    try {
      const coin = await loadCoin(mint);
      if (!coin) throw new Error('missing');
      document.getElementById('coinName').textContent = coin.name || coin.symbol || shortMint(mint);
      document.getElementById('coinTitle').textContent = coin.symbol || coin.name || shortMint(mint);
      const age = coin.age != null ? (coin.age < 60 ? Math.round(coin.age) + 'm' : (coin.age / 60).toFixed(1) + 'h') : '—';
      document.getElementById('coinAge').textContent = 'age ' + age;
      const shield = document.getElementById('coinShield');
      if (coin.shield === true) { shield.textContent = 'shield 8/8'; shield.className = 'pill green'; }
      else if (coin.shield === false) { shield.textContent = 'shield fail'; shield.className = 'pill red'; }
      else { shield.textContent = 'shield —'; shield.className = 'pill'; }

      const price = coin.price;
      document.getElementById('coinPrice').textContent = price == null ? '—' :
        (price < 0.01 ? '$' + Number(price).toPrecision(4) : money(price));
      const pctEl = document.getElementById('coinPct');
      let since = null;
      if (coin.position && coin.position.entry_price && price != null) {
        since = ((price / coin.position.entry_price) - 1) * 100;
      } else if (coin.stats && coin.stats.h1_change_pct != null) {
        since = coin.stats.h1_change_pct;
      }
      if (since != null) {
        pctEl.textContent = pct(since) + (coin.position ? ' since entry' : ' 1h');
        pctEl.classList.toggle('down', since < 0);
      } else pctEl.textContent = '—';

      DeskChart.drawCandles(document.getElementById('candleChart'), coin.candles || [], coin.exitLines || []);

      const s = coin.stats || {};
      const stats = [
        ['mcap', s.mcap_usd != null ? money(s.mcap_usd) : '—'],
        ['liq', s.liquidity_usd != null ? money(s.liquidity_usd) : '—'],
        ['vol', s.vol_h1_usd != null ? money(s.vol_h1_usd) : '—'],
        ['holders', s.holders != null ? String(s.holders) : '—'],
      ];
      document.getElementById('coinStats').innerHTML = stats.map(([k, v]) =>
        `<div class="stat"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`).join('');

      const posCard = document.getElementById('posCard');
      const exitCard = document.getElementById('exitCard');
      const pos = coin.position;
      if (pos) {
        posCard.hidden = false;
        document.getElementById('posBody').innerHTML = `
          <div class="setting-row"><span class="k">size</span><span class="v">${money(pos.size_usd)}</span></div>
          <div class="setting-row"><span class="k">entry</span><span class="v">${pos.entry_price}</span></div>
          <div class="setting-row"><span class="k">mode</span><span class="v">${esc(pos.mode || '')}</span></div>
          <div class="setting-row"><span class="k">pnl</span><span class="v">${pos.pnl_usd == null ? '—' : money(pos.pnl_usd)}</span></div>`;
      } else posCard.hidden = true;

      const lines = coin.exitLines || [];
      if (lines.length) {
        exitCard.hidden = false;
        document.getElementById('exitBody').innerHTML = lines.map(l =>
          `<div class="setting-row"><span class="k">${esc(l.label || l.kind)}</span><span class="v">${l.price}</span></div>`
        ).join('');
      } else if (pos && !pos.open) {
        exitCard.hidden = false;
        document.getElementById('exitBody').innerHTML =
          `<div class="setting-row"><span class="k">${esc(pos.exit_reason || 'closed')}</span><span class="v">${pos.exit_price ?? ''}</span></div>`;
      } else exitCard.hidden = true;

      const btn = document.getElementById('coinFomo');
      if (isFomoUrl(coin.coin_url)) {
        btn.href = coin.coin_url;
        btn.hidden = false;
        btn.textContent = pos && pos.open ? 'Sell on FOMO' : 'Buy on FOMO';
        btn.className = 'btn primary' + (pos && pos.open ? ' sell' : '');
      } else {
        btn.hidden = true;
        btn.removeAttribute('href');
      }
    } catch (_) {
      document.getElementById('coinName').textContent = 'Not found';
      document.getElementById('coinFomo').hidden = true;
    }
  }

  function showOverlay(name) {
    ['home', 'agents', 'activity', 'account'].forEach(t => {
      const el = document.getElementById('view-' + t);
      if (el) { el.hidden = true; el.classList.remove('on'); }
    });
    ['agent', 'audit', 'coin'].forEach(t => {
      const el = document.getElementById('view-' + t);
      if (el) el.hidden = t !== name;
    });
    document.body.classList.add('overlay-open');
  }

  function showTab(name) {
    document.body.classList.remove('overlay-open');
    ['agent', 'audit', 'coin'].forEach(t => {
      const el = document.getElementById('view-' + t);
      if (el) el.hidden = true;
    });
    ['home', 'agents', 'activity', 'account'].forEach(t => {
      const el = document.getElementById('view-' + t);
      if (!el) return;
      const on = t === name;
      el.hidden = !on;
      el.classList.toggle('on', on);
    });
    document.querySelectorAll('#tabBar [data-tab]').forEach(btn => {
      btn.classList.toggle('on', btn.getAttribute('data-tab') === name);
    });
  }

  function route() {
    const raw = (location.hash || '').replace(/^#/, '');
    const src = parseSourceFromRaw(raw);
    if (src) {
      if (src.kind === 'brew') {
        dataUrl = src.url;
        dataPath = '';
        bundleMode = true;
        localStorage.setItem('desk_data_url', dataUrl);
        if (src.j) localStorage.setItem('desk_data_j', src.j);
        localStorage.removeItem('desk_data_path');
      } else if (src.d) {
        dataPath = src.d;
        dataUrl = '';
        bundleMode = false;
        localStorage.setItem('desk_data_path', dataPath);
        localStorage.removeItem('desk_data_url');
        localStorage.removeItem('desk_data_j');
      }
    }
    const r = parseHash();
    if (r.view === 'coin') return openCoin(r.mint);
    if (r.view === 'audit') return openAudit(r.mint);
    if (r.view === 'agent') return openAgent(r.name);
    showTab(r.view || 'home');
  }

  // tabs
  document.querySelectorAll('#tabBar [data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      // tab-only hash; data source stays in localStorage from #j= / #d=
      location.hash = tab;
    });
  });
  document.querySelectorAll('[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => { location.hash = btn.getAttribute('data-goto'); });
  });
  document.querySelectorAll('[data-back]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (history.length > 1) history.back();
      else location.hash = 'home';
    });
  });
  document.getElementById('ranges').addEventListener('click', e => {
    const b = e.target.closest('button[data-r]');
    if (!b) return;
    range = b.getAttribute('data-r');
    document.querySelectorAll('#ranges button').forEach(x => x.classList.toggle('on', x === b));
    if (cache.chart) {
      DeskChart.drawLine(document.getElementById('chart'), filterPoints(cache.chart.points || []), cache.chart.marks || [], cache.chart.start);
    }
  });

  window.addEventListener('hashchange', route);

  // Plan B: poll JSON only. Never attempt web push subscribe / POST.
  function startPoll() {
    if (pollTimer) clearInterval(pollTimer);
    const ms = range === 'LIVE' ? 15000 : 30000;
    pollTimer = setInterval(loadCore, ms);
  }

  // SW for offline shell only — no push
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  loadCore().then(() => { route(); startPoll(); });
  window.addEventListener('hashchange', () => { /* route already bound */ });
})();
