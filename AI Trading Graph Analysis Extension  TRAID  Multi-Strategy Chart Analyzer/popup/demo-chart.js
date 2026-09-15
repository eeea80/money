// Deterministic example chart used by the free "See a live example" scan.
// Drawn in-canvas (no bundled image) so it is always identical, works offline,
// and is clearly watermarked as sample data — the AI analyses it for real.
const TraidDemoChart = (() => {
  const WIDTH = 920;
  const HEIGHT = 540;
  const PAD = { top: 44, right: 74, bottom: 30, left: 14 };
  const VOL_H = 78;

  const UP = '#26a69a';
  const DOWN = '#ef5350';
  const BG = '#131722';
  const GRID = '#1e222d';
  const TEXT = '#b2b5be';

  // Small seeded PRNG so every user sees the exact same chart
  function seeded(seed) {
    let a = seed >>> 0;
    return function () {
      a += 0x6d2b79f5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A clean, readable setup: impulse up, pullback into a support zone, then basing.
  // Built from fixed anchor points so the shape is guaranteed, not left to a random walk.
  const ANCHORS = [
    { i: 0, p: 100.0 },   // start
    { i: 24, p: 118.5 },  // impulse high
    { i: 38, p: 108.2 },  // pullback into support
    { i: 49, p: 111.8 }   // basing / early bounce
  ];

  function trendPrice(i) {
    for (let a = 0; a < ANCHORS.length - 1; a++) {
      const from = ANCHORS[a];
      const to = ANCHORS[a + 1];
      if (i >= from.i && i <= to.i) {
        const t = (i - from.i) / (to.i - from.i);
        return from.p + (to.p - from.p) * t;
      }
    }
    return ANCHORS[ANCHORS.length - 1].p;
  }

  function buildCandles() {
    const rand = seeded(20260719);
    const closes = [];
    for (let i = 0; i < 50; i++) {
      // Trend plus small deterministic noise so it reads like a real market
      closes.push(trendPrice(i) + (rand() - 0.5) * 1.6);
    }

    const candles = [];
    let prevClose = closes[0] - 0.55;
    for (let i = 0; i < closes.length; i++) {
      const close = closes[i];
      const open = prevClose;
      const body = Math.abs(close - open);
      const wick = 0.22 + rand() * 0.85;
      const high = Math.max(open, close) + wick;
      const low = Math.min(open, close) - (0.22 + rand() * 0.85);
      const volume = 0.35 + rand() * 0.45 + (body > 1 ? 0.3 : 0);
      candles.push({ open, high, low, close, volume });
      prevClose = close;
    }
    return candles;
  }

  // Draw the support line where price actually reacted, not at a hardcoded level
  function supportLevel(candles) {
    let low = Infinity;
    for (let i = 30; i < candles.length; i++) low = Math.min(low, candles[i].low);
    return low;
  }

  function render() {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');

    const candles = buildCandles();
    const plotW = WIDTH - PAD.left - PAD.right;
    const plotH = HEIGHT - PAD.top - PAD.bottom - VOL_H;

    let hi = -Infinity;
    let lo = Infinity;
    candles.forEach(c => { hi = Math.max(hi, c.high); lo = Math.min(lo, c.low); });
    const span = hi - lo;
    hi += span * 0.08;
    lo -= span * 0.08;
    const yOf = (p) => PAD.top + (hi - p) / (hi - lo) * plotH;

    // Background
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Grid + price axis
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.font = '12px Arial, sans-serif';
    ctx.fillStyle = TEXT;
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 6; i++) {
      const price = lo + (hi - lo) * (i / 6);
      const y = Math.round(yOf(price)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(WIDTH - PAD.right, y);
      ctx.stroke();
      ctx.fillText(price.toFixed(2), WIDTH - PAD.right + 9, y);
    }
    for (let i = 0; i <= 8; i++) {
      const x = Math.round(PAD.left + plotW * (i / 8)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, PAD.top + plotH + VOL_H);
      ctx.stroke();
    }

    // Support zone the pullback is reacting from
    const supportY = yOf(supportLevel(candles));
    ctx.save();
    ctx.setLineDash([7, 5]);
    ctx.strokeStyle = 'rgba(41, 98, 255, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(PAD.left, supportY);
    ctx.lineTo(WIDTH - PAD.right, supportY);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(41, 98, 255, 0.95)';
    ctx.font = 'bold 11px Arial, sans-serif';
    ctx.fillText('SUPPORT', PAD.left + 8, supportY - 10);

    // Candles + volume
    const step = plotW / candles.length;
    const bodyW = Math.max(3, step * 0.62);
    const volBase = PAD.top + plotH + VOL_H;
    candles.forEach((c, i) => {
      const cx = PAD.left + step * i + step / 2;
      const bull = c.close >= c.open;
      const color = bull ? UP : DOWN;

      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(Math.round(cx) + 0.5, yOf(c.high));
      ctx.lineTo(Math.round(cx) + 0.5, yOf(c.low));
      ctx.stroke();

      const top = yOf(Math.max(c.open, c.close));
      const h = Math.max(1.5, Math.abs(yOf(c.close) - yOf(c.open)));
      ctx.fillRect(cx - bodyW / 2, top, bodyW, h);

      ctx.globalAlpha = 0.45;
      const vh = c.volume * (VOL_H - 12);
      ctx.fillRect(cx - bodyW / 2, volBase - vh, bodyW, vh);
      ctx.globalAlpha = 1;
    });

    // Header
    const last = candles[candles.length - 1];
    ctx.fillStyle = '#d1d4dc';
    ctx.font = 'bold 17px Arial, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('EXAMPLE / USD', PAD.left + 4, 26);
    ctx.font = '13px Arial, sans-serif';
    ctx.fillStyle = TEXT;
    ctx.fillText('1H  |  Sample chart', PAD.left + 168, 26);
    ctx.fillStyle = last.close >= last.open ? UP : DOWN;
    ctx.font = 'bold 15px Arial, sans-serif';
    ctx.fillText(last.close.toFixed(2), PAD.left + 320, 26);

    // Honest watermark — this is demo data, not a live market
    ctx.save();
    ctx.globalAlpha = 0.13;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 54px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('EXAMPLE CHART', WIDTH / 2, HEIGHT / 2 - 6);
    ctx.font = 'bold 22px Arial, sans-serif';
    ctx.fillText('SAMPLE DATA - NOT A LIVE MARKET', WIDTH / 2, HEIGHT / 2 + 30);
    ctx.restore();

    return canvas.toDataURL('image/jpeg', 0.92);
  }

  return { render };
})();
