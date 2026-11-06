(function () {
  const params = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  let dataPath = localStorage.getItem('desk_data_path') || params.get('d') || '';
  if (params.get('d')) localStorage.setItem('desk_data_path', params.get('d'));
  const base = () => dataPath ? (`d/${dataPath}`) : null;
  const errEl = document.getElementById('err');
  let lastOk = null, retry = 5;

  function showErr(msg) {
    errEl.hidden = false;
    errEl.textContent = msg;
  }
  function hideErr() { errEl.hidden = true; }

  async function load() {
    const b = base();
    if (!b) {
      showErr('Missing data path. Open the link that ends with #d=…');
      return;
    }
    try {
      const [state, chart, activity] = await Promise.all([
        fetch(`${b}/state.json?t=${Date.now()}`).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
        fetch(`${b}/chart.json?t=${Date.now()}`).then(r => r.ok ? r.json() : {points:[],marks:[],start:null}),
        fetch(`${b}/activity.json?t=${Date.now()}`).then(r => r.ok ? r.json() : {rows:[]}),
      ]);
      hideErr(); lastOk = new Date(); retry = 5;
      render(state, chart, activity);
    } catch (e) {
      retry = Math.min(60, retry + 5);
      const t = lastOk ? lastOk.toLocaleTimeString() : 'never';
      showErr(`Desk offline · retrying in ${retry}s · last update ${t}`);
    }
  }

  function money(n) {
    return '$' + (Number(n) || 0).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
  }

  function render(state, chart, activity) {
    document.getElementById('balance').textContent = money(state.balance);
    document.getElementById('today').textContent = (state.todayPct >= 0 ? '+' : '') + (state.todayPct || 0).toFixed(2) + '%';
    document.getElementById('today').style.color = (state.todayPct || 0) >= 0 ? '#00d35a' : '#ff453a';
    document.getElementById('mult').textContent = ((state.multiplier || 1).toFixed(2)) + '×';
    const paper = document.getElementById('paper');
    paper.hidden = state.mode !== 'PAPER';
    const agents = state.agents || [];
    document.getElementById('agentCount').textContent = String(agents.filter(a => a.status === 'running').length || agents.length);
    const car = document.getElementById('agents');
    car.innerHTML = agents.map(a => `<div class="agent-card"><div class="name">${a.name}</div><div class="meta">${a.subtitle || a.status || ''}</div></div>`).join('') || '<div class="empty">Listening for graduations</div>';
    const act = document.getElementById('activity');
    const rows = (activity.rows || []).slice(0, 5);
    act.innerHTML = rows.length ? rows.map(r => `<div class="row"><div><div class="t">${r.title}</div><div class="s">${r.subtitle||''}</div></div><div class="v">${r.value||''}</div></div>`).join('') : '<div class="empty">Nothing yet tonight</div>';
    DeskChart.draw(document.getElementById('chart'), chart.points || [], chart.marks || [], chart.start);
  }

  load();
  setInterval(load, 15000);
})();
