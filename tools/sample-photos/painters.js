/*
 * Painted placeholder "photos" for the sample trips.
 * Each painter draws a stylised scene on a 2D canvas. They stand in for real
 * club photos until members add their own; see tools/sample-photos/README.md.
 */
(function () {
  const TAU = Math.PI * 2;

  function rng(seed) {
    let s = seed >>> 0;
    return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  }
  function grad(g, y0, y1, stops) {
    const gr = g.createLinearGradient(0, y0, 0, y1);
    stops.forEach((s) => gr.addColorStop(s[0], s[1]));
    return gr;
  }
  function glow(g, x, y, r, stops) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    stops.forEach((s) => gr.addColorStop(s[0], s[1]));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }

  function pagoda(g, cx, baseY, H) {
    const tier = H * 0.15;
    const topY = baseY - tier * 5.2;
    g.beginPath();
    g.moveTo(cx - H * 0.12, baseY);
    g.lineTo(cx - H * 0.075, topY);
    g.lineTo(cx + H * 0.075, topY);
    g.lineTo(cx + H * 0.12, baseY);
    g.closePath();
    g.fill();
    for (let i = 0; i < 5; i++) {
      const y = baseY - tier * 0.75 - i * tier;
      const hw = H * 0.23 * Math.pow(0.86, i);
      const rh = tier * 0.42;
      g.beginPath();
      g.moveTo(cx - hw, y - rh * 0.42);
      g.quadraticCurveTo(cx - hw * 0.72, y + rh * 0.1, cx - hw * 0.42, y + rh * 0.08);
      g.lineTo(cx + hw * 0.42, y + rh * 0.08);
      g.quadraticCurveTo(cx + hw * 0.72, y + rh * 0.1, cx + hw, y - rh * 0.42);
      g.quadraticCurveTo(cx + hw * 0.55, y - rh * 0.45, cx + hw * 0.3, y - rh);
      g.lineTo(cx - hw * 0.3, y - rh);
      g.quadraticCurveTo(cx - hw * 0.55, y - rh * 0.45, cx - hw, y - rh * 0.42);
      g.fill();
    }
    const sy = baseY - tier * 5.17;
    g.fillRect(cx - H * 0.007, sy - H * 0.2, H * 0.014, H * 0.2);
    for (let k = 0; k < 9; k++) g.fillRect(cx - H * 0.02, sy - H * 0.04 - k * H * 0.016, H * 0.04, H * 0.005);
  }
  function rooftops(g, w, h, y0, R, s) {
    let x = -20 * s;
    while (x < w + 20 * s) {
      const bw = (50 + R() * 90) * s;
      const bh = (18 + R() * 40) * s;
      const top = y0 - bh;
      g.fillRect(x, top, bw + 1, h - top);
      if (R() < 0.6) {
        g.beginPath();
        g.moveTo(x - 6 * s, top + 2 * s);
        g.lineTo(x + bw / 2, top - (10 + R() * 14) * s);
        g.lineTo(x + bw + 6 * s, top + 2 * s);
        g.fill();
      }
      x += bw;
    }
  }
  function wires(g, w, h, s, poleX) {
    g.fillRect(poleX - 4 * s, h * 0.18, 8 * s, h);
    g.fillRect(poleX - 34 * s, h * 0.22, 68 * s, 4 * s);
    g.fillRect(poleX - 26 * s, h * 0.29, 52 * s, 3 * s);
    g.strokeStyle = g.fillStyle;
    g.lineWidth = 1.6 * s;
    [[0.22, -30], [0.22, 30], [0.29, -22], [0.29, 22]].forEach((a, i) => {
      const px = poleX + a[1] * s;
      const py = h * a[0];
      g.beginPath();
      g.moveTo(-10, h * (a[0] - 0.06 + i * 0.03));
      g.quadraticCurveTo(px / 2, py + h * 0.1, px, py);
      g.stroke();
      g.beginPath();
      g.moveTo(px, py);
      g.quadraticCurveTo((px + w) / 2, py + h * 0.07, w + 10, h * (a[0] + 0.02 + i * 0.02));
      g.stroke();
    });
  }
  function person(g, x, base, H) {
    const hr = H * 0.16;
    g.beginPath();
    g.arc(x, base - H + hr, hr, 0, TAU);
    g.fill();
    g.beginPath();
    g.moveTo(x - H * 0.34, base);
    g.quadraticCurveTo(x - H * 0.34, base - H * 0.62, x - H * 0.08, base - H * 0.68);
    g.lineTo(x + H * 0.08, base - H * 0.68);
    g.quadraticCurveTo(x + H * 0.34, base - H * 0.62, x + H * 0.34, base);
    g.fill();
    g.fillRect(x - hr * 0.45, base - H * 0.74, hr * 0.9, H * 0.1);
  }

  const P = {};

  P.yasaka = (g, w, h, R, v) => {
    const s = h / 512;
    const skies = [
      [[0, '#1b1f4a'], [0.4, '#6e3a6c'], [0.68, '#dd6a55'], [0.86, '#ffb06c'], [1, '#ffd49c']],
      [[0, '#0f1a44'], [0.45, '#33427c'], [0.75, '#8a6aa0'], [0.92, '#e09a8a'], [1, '#f2c0a0']],
    ];
    g.fillStyle = grad(g, 0, h, skies[v % 2]);
    g.fillRect(0, 0, w, h);
    glow(g, w * 0.72, h * 0.76, h * 0.7, [[0, 'rgba(255,236,190,.9)'], [0.1, 'rgba(255,196,128,.5)'], [1, 'rgba(255,150,100,0)']]);
    g.globalAlpha = 0.28;
    for (let i = 0; i < 9; i++) {
      g.fillStyle = i % 2 ? '#f6a07c' : '#a64d78';
      g.beginPath();
      g.ellipse(w * R(), h * (0.18 + R() * 0.4), w * (0.12 + R() * 0.22), h * (0.006 + R() * 0.012), 0, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
    g.fillStyle = '#170d1b';
    pagoda(g, w * (0.3 + R() * 0.12), h * 0.9, h * 0.66);
    rooftops(g, w, h, h * 0.9, R, s);
    wires(g, w, h, s, w * 0.86);
  };

  P.fireworks = (g, w, h, R) => {
    const s = h / 512;
    const hor = h * 0.76;
    g.fillStyle = grad(g, 0, hor, [[0, '#03050d'], [0.75, '#0c1129'], [1, '#1a1733']]);
    g.fillRect(0, 0, w, hor);
    const cols = ['255,176,96', '150,205,255', '255,120,170', '255,222,140', '170,255,190'];
    const bursts = [];
    const n = 3 + Math.floor(R() * 3);
    for (let i = 0; i < n; i++) bursts.push([0.15 + R() * 0.7, 0.15 + R() * 0.35, 0.07 + R() * 0.16, cols[Math.floor(R() * cols.length)]]);
    g.globalCompositeOperation = 'lighter';
    for (const b of bursts) {
      const cx = w * b[0];
      const cy = h * b[1];
      const rr = h * b[2];
      const c = b[3];
      glow(g, cx, cy, rr * 1.2, [[0, 'rgba(' + c + ',.3)'], [1, 'rgba(' + c + ',0)']]);
      for (let k = 0; k < 130; k++) {
        const a = R() * TAU;
        const u = R() * 2 - 1;
        const rad = Math.sqrt(1 - u * u) * rr * (0.85 + R() * 0.2);
        const ex = cx + Math.cos(a) * rad;
        const ey = cy + Math.sin(a) * rad + rad * 0.18;
        g.strokeStyle = 'rgba(' + c + ',' + (0.18 + R() * 0.3) + ')';
        g.lineWidth = 1.1 * s;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * rad * 0.2, cy + Math.sin(a) * rad * 0.2);
        g.quadraticCurveTo(cx + Math.cos(a) * rad * 0.8, cy + Math.sin(a) * rad * 0.8, ex, ey);
        g.stroke();
        g.fillStyle = 'rgba(' + c + ',.9)';
        g.beginPath();
        g.arc(ex, ey, 1.6 * s, 0, TAU);
        g.fill();
      }
    }
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#04060f';
    g.fillRect(0, hor, w, h - hor);
    g.globalCompositeOperation = 'lighter';
    for (const b of bursts) {
      for (let k = 0; k < 60; k++) {
        g.fillStyle = 'rgba(' + b[3] + ',' + (0.05 + R() * 0.12) + ')';
        g.fillRect(w * b[0] + (R() - 0.5) * h * b[2] * 1.6, hor + 4 * s + R() * (h - hor) * 0.7, (8 + R() * 22) * s, 1.4 * s);
      }
    }
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#020308';
    for (let x = 0; x < w; x += 14 * s) {
      g.beginPath();
      g.ellipse(x, hor, (10 + R() * 12) * s, (3 + R() * 9) * s, 0, Math.PI, TAU);
      g.fill();
    }
    for (let i = 0; i < 26; i++) {
      const x = R() * w;
      const r = h * (0.035 + R() * 0.03);
      g.beginPath();
      g.arc(x, h - r * 0.2, r, 0, TAU);
      g.fill();
      g.beginPath();
      g.ellipse(x, h + r * 1.2, r * 2.2, r * 1.6, 0, 0, TAU);
      g.fill();
    }
  };

  P.inari = (g, w, h, R) => {
    const s = h / 512;
    const cx = w * (0.44 + R() * 0.12);
    const cy = h * 0.5;
    g.fillStyle = grad(g, 0, h, [[0, '#0d160e'], [1, '#070a06']]);
    g.fillRect(0, 0, w, h);
    glow(g, cx, cy * 0.98, h * 0.42, [[0, '#fff3cf'], [0.22, '#f0bd72'], [0.6, 'rgba(120,70,20,.35)'], [1, 'rgba(40,30,10,0)']]);
    g.fillStyle = grad(g, cy, h, [[0, '#6b5137'], [1, '#20170f']]);
    g.beginPath();
    g.moveTo(cx - 6 * s, cy + 8 * s);
    g.lineTo(cx + 6 * s, cy + 8 * s);
    g.lineTo(w * 0.9, h);
    g.lineTo(w * 0.1, h);
    g.fill();
    const N = 30;
    for (let i = N - 1; i >= 0; i--) {
      const k = 1 / (0.62 + i * 0.38);
      const lit = Math.pow(1 - i / (N - 1), 0.6);
      const r = Math.round(90 + 140 * lit);
      const gg = Math.round(24 + 50 * lit);
      const b = Math.round(10 + 14 * lit);
      const col = 'rgb(' + r + ',' + gg + ',' + b + ')';
      const dark = 'rgb(' + Math.round(r * 0.55) + ',' + Math.round(gg * 0.5) + ',' + Math.round(b * 0.5) + ')';
      const half = w * 0.4 * k;
      const pw = w * 0.07 * k;
      const top = cy - h * 0.5 * k;
      const bot = Math.min(h * 1.2, cy + h * 0.66 * k);
      g.fillStyle = col;
      g.fillRect(cx - half - pw / 2, top, pw, bot - top);
      g.fillRect(cx + half - pw / 2, top, pw, bot - top);
      g.fillStyle = dark;
      g.fillRect(cx - half - pw / 2, top, pw * 0.35, bot - top);
      g.fillRect(cx + half + pw * 0.15, top, pw * 0.35, bot - top);
      g.fillStyle = col;
      g.fillRect(cx - half * 1.12, top + h * 0.1 * k, half * 2.24, h * 0.03 * k);
      g.fillRect(cx - half * 1.3, top - h * 0.06 * k, half * 2.6, h * 0.05 * k);
      g.fillStyle = '#140805';
      g.fillRect(cx - half * 1.34, top - h * 0.075 * k, half * 2.68, h * 0.022 * k);
    }
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 14; i++) {
      g.fillStyle = 'rgba(255,214,150,' + (0.03 + R() * 0.05) + ')';
      g.fillRect(w * (0.08 + R() * 0.84), 0, (2 + R() * 5) * s, h);
    }
    g.globalCompositeOperation = 'source-over';
  };

  P.aquarium = (g, w, h, R, v) => {
    const s = h / 512;
    g.fillStyle = grad(g, 0, h, [[0, '#2a8cc0'], [0.4, '#0d4d80'], [1, '#020f1f']]);
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const x = w * (R() * 1.2 - 0.1);
      const dx = w * (0.04 + R() * 0.08);
      g.fillStyle = 'rgba(190,235,255,' + (0.035 + R() * 0.04) + ')';
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + dx, 0);
      g.lineTo(x + dx * 3 + w * 0.15, h);
      g.lineTo(x + w * 0.12, h);
      g.fill();
    }
    for (let i = 0; i < 140; i++) {
      g.fillStyle = 'rgba(210,240,255,' + (0.08 + R() * 0.3) + ')';
      g.beginPath();
      g.arc(R() * w, R() * h * 0.85, (0.6 + R() * 1.6) * s, 0, TAU);
      g.fill();
    }
    const count = 4 + Math.floor(R() * 4);
    for (let j = 0; j < count; j++) {
      const x = w * (0.08 + R() * 0.84);
      const y = h * (0.12 + R() * 0.45);
      const r = h * (0.03 + R() * 0.05);
      const gr = g.createRadialGradient(x, y - r * 0.2, r * 0.1, x, y, r);
      gr.addColorStop(0, 'rgba(240,248,255,.55)');
      gr.addColorStop(1, 'rgba(150,205,255,.12)');
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(x, y, r, r * 0.75, 0, Math.PI, TAU);
      g.fill();
      g.strokeStyle = 'rgba(200,228,255,.28)';
      g.lineWidth = s;
      for (let k = 0; k < 6; k++) {
        const tx = x - r * 0.7 + k * r * 0.28;
        g.beginPath();
        g.moveTo(tx, y);
        g.bezierCurveTo(tx + r * 0.3, y + r * 0.8, tx - r * 0.3, y + r * 1.6, tx + r * 0.1, y + r * (2.2 + R() * 0.8));
        g.stroke();
      }
    }
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = grad(g, h * 0.7, h, [[0, 'rgba(1,8,18,0)'], [1, 'rgba(1,8,18,.9)']]);
    g.fillRect(0, h * 0.7, w, h * 0.3);
    g.fillStyle = '#01060e';
    if (v % 2 === 0) {
      person(g, w * 0.64, h, h * 0.36);
      person(g, w * 0.5, h, h * 0.29);
    } else {
      person(g, w * 0.3, h, h * 0.42);
    }
  };

  P.crossing = (g, w, h, R) => {
    const s = h / 512;
    const gy = h * 0.8;
    const ink = '#141019';
    g.fillStyle = grad(g, 0, gy, [[0, '#25355e'], [0.42, '#7a6692'], [0.72, '#ec9a77'], [0.9, '#ffcd9c'], [1, '#ffe0b0']]);
    g.fillRect(0, 0, w, gy);
    glow(g, w * 0.82, gy, h * 0.5, [[0, 'rgba(255,230,180,.8)'], [1, 'rgba(255,180,120,0)']]);
    g.fillStyle = ink;
    rooftops(g, w, h, gy, R, s * 0.7);
    g.fillRect(0, gy, w, h - gy);
    g.strokeStyle = '#3a2e36';
    g.lineWidth = 2 * s;
    g.beginPath();
    g.moveTo(0, h * 0.9);
    g.lineTo(w, h * 0.86);
    g.moveTo(0, h * 0.96);
    g.lineTo(w, h * 0.92);
    g.stroke();
    const px = w * (0.55 + R() * 0.15);
    g.fillStyle = ink;
    g.fillRect(px - 5 * s, h * 0.2, 10 * s, h);
    for (const a of [0.62, -0.62]) {
      g.save();
      g.translate(px, h * 0.24);
      g.rotate(a);
      g.fillRect(-h * 0.12, -h * 0.016, h * 0.24, h * 0.032);
      g.restore();
    }
    g.fillRect(px - h * 0.11, h * 0.355, h * 0.22, 8 * s);
    for (const side of [-1, 1]) {
      g.beginPath();
      g.arc(px + side * h * 0.085, h * 0.39, h * 0.042, 0, TAU);
      g.fill();
    }
    g.globalCompositeOperation = 'lighter';
    glow(g, px - h * 0.085, h * 0.39, h * 0.2, [[0, 'rgba(255,90,60,.95)'], [0.15, 'rgba(255,60,40,.55)'], [1, 'rgba(255,40,30,0)']]);
    g.fillStyle = '#ff6a4a';
    g.beginPath();
    g.arc(px - h * 0.085, h * 0.39, h * 0.03, 0, TAU);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = ink;
    g.save();
    g.translate(px - 6 * s, h * 0.7);
    g.rotate(-0.06);
    g.fillRect(-w * 0.5, -4 * s, w * 0.5, 8 * s);
    g.restore();
    wires(g, w, h, s, w * 0.14);
    for (const bx of [0.33, 0.36, 0.41]) {
      g.beginPath();
      g.ellipse(w * bx, h * 0.262 + bx * 12 * s, 5 * s, 4 * s, 0, 0, TAU);
      g.fill();
    }
  };

  P.street = (g, w, h, R) => {
    const s = h / 512;
    g.fillStyle = grad(g, 0, h, [[0, '#04060b'], [0.6, '#0a0d16'], [1, '#07080c']]);
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';
    const cols = ['255,180,110', '255,110,90', '110,190,255', '255,240,200', '170,255,200'];
    for (let i = 0; i < 34; i++) {
      const c = cols[i % cols.length];
      const a = 0.12 + R() * 0.25;
      glow(g, w * (0.35 + R() * 0.65), h * (0.2 + R() * 0.45), (5 + R() * 24) * s, [[0, 'rgba(' + c + ',' + a * 0.6 + ')'], [0.85, 'rgba(' + c + ',' + a + ')'], [1, 'rgba(' + c + ',0)']]);
    }
    const vx = w * (0.06 + R() * 0.08);
    const vy = h * 0.3;
    const vw = w * 0.2;
    const vh = h * 0.56;
    glow(g, vx + vw / 2, vy + vh * 0.5, vh * 0.9, [[0, 'rgba(170,215,255,.35)'], [1, 'rgba(120,180,255,0)']]);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#dbe9f5';
    g.fillRect(vx, vy, vw, vh);
    g.fillStyle = '#c23a3a';
    g.fillRect(vx, vy, vw, vh * 0.08);
    g.fillStyle = '#f4fbff';
    g.fillRect(vx + vw * 0.06, vy + vh * 0.11, vw * 0.88, vh * 0.5);
    const dc = ['#e2523c', '#2f7fd0', '#f2b23a', '#3aa66b', '#8b5ad0', '#e9e2d0', '#20252e'];
    const cw = (vw * 0.88) / 6;
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 6; c++) {
        g.fillStyle = dc[(r * 7 + c * 3) % dc.length];
        g.fillRect(vx + vw * 0.06 + c * cw + cw * 0.22, vy + vh * (0.13 + r * 0.12), cw * 0.56, vh * 0.08);
      }
    g.fillStyle = '#2a3340';
    g.fillRect(vx + vw * 0.1, vy + vh * 0.8, vw * 0.8, vh * 0.1);
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = grad(g, vy + vh, h, [[0, 'rgba(170,215,255,.28)'], [1, 'rgba(170,215,255,0)']]);
    g.fillRect(vx - vw * 0.1, vy + vh, vw * 1.2, h - vy - vh);
    const lx = w * 0.8;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#0b0d12';
    g.fillRect(lx, h * 0.12, 6 * s, h);
    g.fillRect(lx - 40 * s, h * 0.12, 46 * s, 5 * s);
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = 'rgba(255,214,150,.9)';
    g.fillRect(lx - 42 * s, h * 0.12 + 5 * s, 22 * s, 4 * s);
    g.fillStyle = grad(g, h * 0.13, h, [[0, 'rgba(255,200,130,.22)'], [1, 'rgba(255,200,130,0)']]);
    g.beginPath();
    g.moveTo(lx - 40 * s, h * 0.13);
    g.lineTo(lx - 22 * s, h * 0.13);
    g.lineTo(lx + 60 * s, h);
    g.lineTo(lx - 140 * s, h);
    g.fill();
    g.globalCompositeOperation = 'source-over';
  };

  P.bamboo = (g, w, h, R) => {
    const s = h / 512;
    g.fillStyle = grad(g, 0, h, [[0, '#cfe3a0'], [0.35, '#6f9a4a'], [1, '#1e3318']]);
    g.fillRect(0, 0, w, h);
    for (let layer = 0; layer < 4; layer++) {
      const depth = layer / 3;
      const n = 14 + layer * 6;
      for (let i = 0; i < n; i++) {
        const x = R() * w;
        const bw = (6 + layer * 7 + R() * 6) * s;
        const shade = Math.round(40 + 90 * (1 - depth));
        g.fillStyle = 'rgb(' + Math.round(shade * 0.55) + ',' + Math.round(shade * 1.1) + ',' + Math.round(shade * 0.45) + ')';
        g.save();
        g.translate(x, h);
        g.rotate((R() - 0.5) * 0.06);
        g.fillRect(-bw / 2, -h * 1.2, bw, h * 1.2);
        g.fillStyle = 'rgba(0,0,0,.25)';
        for (let y = -40 * s; y > -h * 1.2; y -= (55 + R() * 30) * s) g.fillRect(-bw / 2, y, bw, 2 * s);
        g.restore();
      }
    }
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const x = w * (0.1 + R() * 0.8);
      g.fillStyle = 'rgba(255,250,210,' + (0.04 + R() * 0.05) + ')';
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + 30 * s, 0);
      g.lineTo(x + 140 * s, h);
      g.lineTo(x + 60 * s, h);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = 'rgba(40,30,20,.85)';
    g.fillRect(0, h * 0.9, w, h * 0.1);
  };

  P.momiji = (g, w, h, R) => {
    const s = h / 512;
    g.fillStyle = grad(g, 0, h, [[0, '#f3e2c8'], [0.5, '#e7b48a'], [1, '#6a3a26']]);
    g.fillRect(0, 0, w, h);
    // temple roof silhouette
    g.fillStyle = '#2a1712';
    const ry = h * (0.42 + R() * 0.1);
    g.beginPath();
    g.moveTo(-10, ry + 40 * s);
    g.quadraticCurveTo(w * 0.3, ry + 10 * s, w * 0.55, ry - 60 * s);
    g.quadraticCurveTo(w * 0.8, ry + 10 * s, w + 10, ry + 30 * s);
    g.lineTo(w + 10, ry + 70 * s);
    g.lineTo(-10, ry + 80 * s);
    g.fill();
    g.fillRect(0, ry + 70 * s, w, h);
    // maple leaves in clusters
    const reds = ['#d8341f', '#e5502a', '#f07a2c', '#b8231c', '#f4a23a'];
    for (let c = 0; c < 9; c++) {
      const cx = R() * w;
      const cy = R() * h * 0.55;
      const rad = (40 + R() * 90) * s;
      for (let i = 0; i < 160; i++) {
        const a = R() * TAU;
        const d = Math.sqrt(R()) * rad;
        g.fillStyle = reds[Math.floor(R() * reds.length)];
        g.globalAlpha = 0.55 + R() * 0.45;
        g.save();
        g.translate(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.7);
        g.rotate(R() * TAU);
        const ls = (4 + R() * 6) * s;
        g.beginPath();
        for (let p = 0; p < 5; p++) {
          const pa = (p / 5) * TAU;
          g.lineTo(Math.cos(pa) * ls, Math.sin(pa) * ls);
          g.lineTo(Math.cos(pa + 0.6) * ls * 0.35, Math.sin(pa + 0.6) * ls * 0.35);
        }
        g.fill();
        g.restore();
      }
    }
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(20,10,8,.9)';
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(R() * w, -10);
      g.quadraticCurveTo(R() * w, h * 0.3, R() * w, h * 0.55);
      g.lineWidth = (3 + R() * 5) * s;
      g.strokeStyle = 'rgba(30,15,10,.8)';
      g.stroke();
    }
  };

  P.tram = (g, w, h, R, v) => {
    const s = h / 512;
    g.fillStyle = grad(g, 0, h, [[0, '#9cc3e6'], [0.6, '#e8eef2'], [1, '#c9c3b8']]);
    g.fillRect(0, 0, w, h);
    // cherry blossoms behind
    if (v % 2 === 0) {
      for (let i = 0; i < 1400; i++) {
        g.fillStyle = ['#f7c6d4', '#f2a9bf', '#fde3ea'][i % 3];
        g.globalAlpha = 0.5 + R() * 0.5;
        g.beginPath();
        g.arc(R() * w, h * (0.02 + R() * 0.42), (2 + R() * 5) * s, 0, TAU);
        g.fill();
      }
      g.globalAlpha = 1;
    }
    // platform and rails
    g.fillStyle = '#6f6a62';
    g.fillRect(0, h * 0.78, w, h * 0.22);
    g.fillStyle = '#3d3a36';
    g.fillRect(0, h * 0.86, w, 4 * s);
    g.fillRect(0, h * 0.95, w, 4 * s);
    // the tram (front three-quarter view, Kyoto purple)
    const tx = w * (0.28 + R() * 0.12);
    const ty = h * 0.3;
    const tw = w * 0.42;
    const th = h * 0.5;
    g.fillStyle = '#5b2a64';
    g.beginPath();
    g.moveTo(tx, ty + 20 * s);
    g.quadraticCurveTo(tx, ty, tx + 30 * s, ty);
    g.lineTo(tx + tw - 30 * s, ty);
    g.quadraticCurveTo(tx + tw, ty, tx + tw, ty + 20 * s);
    g.lineTo(tx + tw, ty + th);
    g.lineTo(tx, ty + th);
    g.fill();
    g.fillStyle = '#e9dccb';
    g.fillRect(tx, ty + th * 0.62, tw, th * 0.08);
    g.fillStyle = '#26323e';
    g.fillRect(tx + tw * 0.08, ty + th * 0.12, tw * 0.38, th * 0.36);
    g.fillRect(tx + tw * 0.54, ty + th * 0.12, tw * 0.38, th * 0.36);
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = 'rgba(200,230,255,.25)';
    g.fillRect(tx + tw * 0.1, ty + th * 0.14, tw * 0.1, th * 0.32);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#fff4c8';
    g.beginPath();
    g.arc(tx + tw * 0.15, ty + th * 0.8, 9 * s, 0, TAU);
    g.arc(tx + tw * 0.85, ty + th * 0.8, 9 * s, 0, TAU);
    g.fill();
    g.fillStyle = '#ffb347';
    g.fillRect(tx + tw * 0.35, ty + 6 * s, tw * 0.3, 18 * s);
    // pantograph and overhead wire
    g.strokeStyle = '#2a2a2a';
    g.lineWidth = 2 * s;
    g.beginPath();
    g.moveTo(0, h * 0.08);
    g.lineTo(w, h * 0.1);
    g.moveTo(tx + tw * 0.4, ty);
    g.lineTo(tx + tw * 0.55, h * 0.09);
    g.lineTo(tx + tw * 0.62, ty);
    g.stroke();
  };

  window.PAINTERS = P;
  window.rng = rng;

  /** Paint `kind` and return a JPEG data URL of a crop (zoom ≥ 1 around fx, fy). */
  window.renderSample = function (kind, seed, opts) {
    const o = Object.assign({ w: 1400, h: 933, zoom: 1, fx: 0.5, fy: 0.5, variant: 0, portrait: false }, opts || {});
    const big = document.createElement('canvas');
    big.width = 1800;
    big.height = 1200;
    P[kind](big.getContext('2d'), big.width, big.height, rng(seed), o.variant);
    const out = document.createElement('canvas');
    const W = o.portrait ? Math.round(o.h * 0.75) : o.w;
    const H = o.portrait ? o.w : o.h;
    out.width = W;
    out.height = H;
    const g = out.getContext('2d');
    const scale = Math.max(W / big.width, H / big.height) * o.zoom;
    const sw = W / scale;
    const sh = H / scale;
    const sx = Math.min(big.width - sw, Math.max(0, big.width * o.fx - sw / 2));
    const sy = Math.min(big.height - sh, Math.max(0, big.height * o.fy - sh / 2));
    g.drawImage(big, sx, sy, sw, sh, 0, 0, W, H);
    // a little film grain
    const img = g.getImageData(0, 0, W, H);
    const r = rng(seed * 7 + 3);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (r() - 0.5) * 9;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
    return out.toDataURL('image/jpeg', 0.8);
  };
})();
