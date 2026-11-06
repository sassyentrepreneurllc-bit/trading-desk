window.DeskChart = {
  drawLine(canvas, points, marks, start) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 390, h = canvas.clientHeight || 180;
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!points || points.length < 1) {
      ctx.strokeStyle = 'rgba(235,235,245,0.3)';
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(16, h / 2); ctx.lineTo(w - 16, h / 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(235,235,245,0.6)';
      ctx.font = '13px -apple-system, sans-serif';
      ctx.fillText('Waiting for the first trade', 16, h / 2 - 12);
      return;
    }
    const ys = points.map(p => p.v);
    const min = Math.min(...ys, start ?? ys[0]);
    const max = Math.max(...ys, start ?? ys[0]);
    const pad = 16, span = Math.max(1e-9, max - min);
    const xAt = i => pad + (i / Math.max(1, points.length - 1)) * (w - pad * 2);
    const yAt = v => h - pad - ((v - min) / span) * (h - pad * 2);

    if (start != null) {
      ctx.strokeStyle = 'rgba(235,235,245,0.3)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(pad, yAt(start)); ctx.lineTo(w - pad, yAt(start)); ctx.stroke();
      ctx.setLineDash([]);
    }

    const last = ys[ys.length - 1];
    const up = last >= (start ?? ys[0]);
    const stroke = up ? '#30d158' : '#ff453a';
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, up ? 'rgba(48,209,88,0.35)' : 'rgba(255,69,58,0.35)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.beginPath();
    points.forEach((p, i) => { const x = xAt(i), y = yAt(p.v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.lineTo(xAt(points.length - 1), h); ctx.lineTo(xAt(0), h); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    ctx.beginPath();
    points.forEach((p, i) => { const x = xAt(i), y = yAt(p.v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke();

    // Marks: Bought blue, +$N green, -stop% red
    const markColor = (m) => {
      const k = (m.kind || m.label || '').toLowerCase();
      if (k.includes('bought') || k === 'buy') return '#0a84ff';
      if (k.includes('stop') || (typeof m.label === 'string' && m.label.trim().startsWith('-'))) return '#ff453a';
      if (k.includes('pnl') || (typeof m.label === 'string' && m.label.includes('+'))) return '#30d158';
      return '#ffd60a';
    };
    (marks || []).forEach(m => {
      let idx = -1;
      if (m.t) {
        idx = points.findIndex(p => p.t === m.t);
        if (idx < 0) {
          // nearest by time string order
          idx = points.reduce((best, p, i) => {
            if (!p.t) return best;
            return Math.abs(Date.parse(p.t) - Date.parse(m.t)) < Math.abs(Date.parse(points[best]?.t || 0) - Date.parse(m.t)) ? i : best;
          }, 0);
        }
      } else if (typeof m.i === 'number') idx = m.i;
      if (idx < 0 || idx >= points.length) return;
      const x = xAt(idx);
      const y = yAt(m.v != null ? m.v : points[idx].v);
      const col = markColor(m);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
      if (m.label) {
        ctx.font = '11px -apple-system, sans-serif';
        ctx.fillStyle = col;
        ctx.fillText(String(m.label), x + 6, y - 6);
      }
    });
  },

  // Back-compat alias
  draw(canvas, points, marks, start) {
    return this.drawLine(canvas, points, marks, start);
  },

  drawCandles(canvas, candles, exitLines) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 390, h = canvas.clientHeight || 220;
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!candles || candles.length < 1) {
      ctx.fillStyle = 'rgba(235,235,245,0.55)';
      ctx.font = '13px -apple-system, sans-serif';
      ctx.fillText('No candles yet', 16, h / 2);
      return;
    }

    const volH = Math.floor(h * 0.22);
    const chartH = h - volH - 8;
    const pad = 12;
    const lows = candles.map(c => c.l);
    const highs = candles.map(c => c.h);
    let min = Math.min(...lows);
    let max = Math.max(...highs);
    (exitLines || []).forEach(l => {
      if (l && l.price != null) { min = Math.min(min, l.price); max = Math.max(max, l.price); }
    });
    const span = Math.max(1e-12, max - min);
    const yAt = v => pad + (1 - (v - min) / span) * (chartH - pad * 2);
    const n = candles.length;
    const slot = (w - pad * 2) / n;
    const bodyW = Math.max(2, slot * 0.6);
    const vols = candles.map(c => c.v || 0);
    const vmax = Math.max(1, ...vols);

    // volume
    candles.forEach((c, i) => {
      const x = pad + i * slot + slot / 2;
      const vh = (c.v || 0) / vmax * (volH - 4);
      const up = c.c >= c.o;
      ctx.fillStyle = up ? 'rgba(48,209,88,0.35)' : 'rgba(255,69,58,0.35)';
      ctx.fillRect(x - bodyW / 2, h - vh, bodyW, vh);
    });

    // exit lines (orange dashed)
    (exitLines || []).forEach(l => {
      if (!l || l.price == null) return;
      const y = yAt(l.price);
      ctx.strokeStyle = '#ff9f0a';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - pad, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ff9f0a';
      ctx.font = '11px -apple-system, sans-serif';
      ctx.fillText(l.label || l.kind || 'exit', pad + 4, y - 4);
    });

    // candles
    candles.forEach((c, i) => {
      const x = pad + i * slot + slot / 2;
      const up = c.c >= c.o;
      const col = up ? '#30d158' : '#ff453a';
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, yAt(c.h)); ctx.lineTo(x, yAt(c.l)); ctx.stroke();
      const top = yAt(Math.max(c.o, c.c));
      const bot = yAt(Math.min(c.o, c.c));
      const bh = Math.max(1, bot - top);
      ctx.fillRect(x - bodyW / 2, top, bodyW, bh);
    });
  }
};
