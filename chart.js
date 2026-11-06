window.DeskChart = {
  draw(canvas, points, marks, start) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 390, h = canvas.clientHeight || 180;
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!points || points.length < 1) {
      ctx.strokeStyle = 'rgba(235,235,245,0.3)';
      ctx.setLineDash([6,6]);
      ctx.beginPath(); ctx.moveTo(16, h/2); ctx.lineTo(w-16, h/2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(235,235,245,0.6)';
      ctx.font = '13px -apple-system, sans-serif';
      ctx.fillText('Waiting for the first trade', 16, h/2 - 12);
      return;
    }
    const ys = points.map(p => p.v);
    const min = Math.min(...ys, start ?? ys[0]), max = Math.max(...ys, start ?? ys[0]);
    const pad = 16, span = Math.max(1e-9, max - min);
    const xAt = i => pad + (i / Math.max(1, points.length - 1)) * (w - pad * 2);
    const yAt = v => h - pad - ((v - min) / span) * (h - pad * 2);
    if (start != null) {
      ctx.strokeStyle = 'rgba(235,235,245,0.3)';
      ctx.setLineDash([4,4]);
      ctx.beginPath(); ctx.moveTo(pad, yAt(start)); ctx.lineTo(w-pad, yAt(start)); ctx.stroke();
      ctx.setLineDash([]);
    }
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(0,211,90,0.35)');
    grad.addColorStop(1, 'rgba(0,211,90,0)');
    ctx.beginPath();
    points.forEach((p,i) => { const x=xAt(i), y=yAt(p.v); i?ctx.lineTo(x,y):ctx.moveTo(x,y); });
    ctx.lineTo(xAt(points.length-1), h); ctx.lineTo(xAt(0), h); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath();
    points.forEach((p,i) => { const x=xAt(i), y=yAt(p.v); i?ctx.lineTo(x,y):ctx.moveTo(x,y); });
    ctx.strokeStyle = '#00d35a'; ctx.lineWidth = 2; ctx.stroke();
  }
};
