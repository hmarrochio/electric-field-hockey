(() => {
  const canvas = document.getElementById('arena');
  const ctx = canvas.getContext('2d');
  const W = 900, H = 520, LIMIT = 5, PUCK_R = 11;
  const goal = { x: 866, top: 211, bottom: 309 };
  const walls = [
    { x: 250, y: 0, w: 22, h: 205 }, { x: 250, y: 315, w: 22, h: 205 },
    { x: 445, y: 0, w: 22, h: 145 }, { x: 445, y: 255, w: 22, h: 265 },
    { x: 640, y: 0, w: 22, h: 205 }, { x: 640, y: 315, w: 22, h: 205 }
  ];
  const ui = {
    left: document.getElementById('charges-left'), dots: document.getElementById('charge-dots'),
    status: document.getElementById('status'), best: document.getElementById('best-score'),
    plus: document.getElementById('choose-plus'), minus: document.getElementById('choose-minus'),
    go: document.getElementById('go'), reset: document.getElementById('reset'), tip: document.getElementById('tip')
  };
  let charges = [], puck, placingSign = 1, running = false, finished = false;
  let fieldLines = null;
  let lastTime = 0, slowTime = 0, animation = 0, bestScore = Number(localStorage.getItem('electricHockeyBest')) || 0;
  ui.best.textContent = bestScore ? bestScore : '—';

  function newPuck() { return { x: 55, y: H / 2, vx: 105, vy: 0, trail: [] }; }
  function updateUI(message) {
    ui.left.textContent = String(LIMIT - charges.length);
    ui.dots.innerHTML = Array.from({ length: LIMIT }, (_, i) => `<i class="${i < charges.length ? 'used' : ''}"></i>`).join('');
    if (message) ui.status.textContent = message;
    ui.go.disabled = running || finished;
    ui.plus.disabled = running || finished;
    ui.minus.disabled = running || finished;
  }
  function setSign(sign) {
    placingSign = sign;
    ui.plus.classList.toggle('selected', sign === 1);
    ui.minus.classList.toggle('selected', sign === -1);
    ui.plus.setAttribute('aria-pressed', String(sign === 1));
    ui.minus.setAttribute('aria-pressed', String(sign === -1));
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.width * H / W * dpr);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.width / W, 0, 0);
    draw();
  }

  function roundedRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#17402f'); bg.addColorStop(1, '#123324');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // Hockey markings
    ctx.strokeStyle = 'rgba(199,245,220,.20)'; ctx.lineWidth = 2;
    ctx.strokeRect(20, 20, W - 40, H - 40);
    ctx.beginPath(); ctx.moveTo(W / 2, 20); ctx.lineTo(W / 2, H - 20); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, 68, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(205,245,221,.55)'; ctx.beginPath(); ctx.arc(W / 2, H / 2, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(196,238,214,.12)';
    ctx.fillRect(0, 20, 18, H - 40); ctx.fillRect(W - 18, goal.top, 18, goal.bottom - goal.top);
    ctx.strokeStyle = 'rgba(220,250,232,.42)'; ctx.setLineDash([5, 8]); ctx.lineWidth = 1;
    for (const x of [250, 445, 640]) { ctx.beginPath(); ctx.moveTo(x + 11, 24); ctx.lineTo(x + 11, H - 24); ctx.stroke(); }
    ctx.setLineDash([]);

    // Approximate electric-field streamlines, rendered behind the obstacles.
    drawFieldLines();

    // Goal target
    ctx.fillStyle = 'rgba(114,237,192,.16)'; ctx.fillRect(840, goal.top, 50, goal.bottom - goal.top);
    ctx.strokeStyle = '#72edc0'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(870, goal.top); ctx.lineTo(890, goal.top); ctx.lineTo(890, goal.bottom); ctx.lineTo(870, goal.bottom); ctx.stroke();
    ctx.fillStyle = '#b8f9df'; ctx.font = '700 12px "DM Sans", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('GOAL', 864, goal.top - 9);

    // Obstacles
    for (const wall of walls) {
      roundedRect(wall.x, wall.y, wall.w, wall.h, 5);
      ctx.fillStyle = '#d5dfe2'; ctx.fill();
      ctx.fillStyle = 'rgba(31,49,58,.16)'; ctx.fillRect(wall.x + 4, wall.y, 4, wall.h);
      ctx.strokeStyle = 'rgba(255,255,255,.42)'; ctx.lineWidth = 1; ctx.stroke();
    }
    // Force hints from fixed, light field line segments
    drawCharges();
    if (puck.trail.length > 1) {
      ctx.beginPath(); ctx.moveTo(puck.trail[0].x, puck.trail[0].y);
      for (const point of puck.trail.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.strokeStyle = 'rgba(255,210,112,.42)'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke();
    }
    // Puck with direction indicator
    ctx.save(); ctx.shadowColor = '#ffd77e'; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.arc(puck.x, puck.y, PUCK_R, 0, Math.PI * 2);
    ctx.fillStyle = '#ffc957'; ctx.fill(); ctx.restore();
    ctx.strokeStyle = '#fff2c6'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(puck.x - 3, puck.y - 3, 2.3, 0, Math.PI * 2); ctx.fillStyle = '#fff9e8'; ctx.fill();
  }

  function fieldDirection(x, y) {
    let ax = 0, ay = 0;
    for (const c of charges) {
      const dx = (x - c.x) / 100, dy = (y - c.y) / 100;
      const r2 = dx * dx + dy * dy + .055;
      const scale = 920 * c.sign / (r2 * Math.sqrt(r2));
      ax += scale * dx; ay += scale * dy;
    }
    const magnitude = Math.hypot(ax, ay);
    return magnitude > 1e-8 ? { x: ax / magnitude, y: ay / magnitude, magnitude } : null;
  }

  function traceFieldLine(startX, startY, direction) {
    const points = [{ x: startX, y: startY }];
    let x = startX, y = startY;
    for (let i = 0; i < 240; i++) {
      const first = fieldDirection(x, y);
      if (!first) break;
      const mid = fieldDirection(x + first.x * direction * 2.5, y + first.y * direction * 2.5);
      if (!mid) break;
      x += mid.x * direction * 5;
      y += mid.y * direction * 5;
      points.push({ x, y });
      if (x < 20 || x > W - 20 || y < 20 || y > H - 20) break;
      if (charges.some(c => Math.hypot(x - c.x, y - c.y) < 19)) break;
    }
    return points;
  }

  function buildFieldLines() {
    const sources = charges.filter(c => c.sign > 0);
    const direction = sources.length ? 1 : -1;
    const origins = sources.length ? sources : charges;
    fieldLines = [];
    for (const c of origins) {
      for (let i = 0; i < 16; i++) {
        const angle = i * Math.PI * 2 / 16;
        const points = traceFieldLine(c.x + Math.cos(angle) * 22, c.y + Math.sin(angle) * 22, direction);
        // For an all-negative layout, reverse the traces so arrowheads still point with E.
        if (!sources.length) points.reverse();
        fieldLines.push(points);
      }
    }
  }

  function drawFieldLines() {
    if (!charges.length) return;
    if (!fieldLines) buildFieldLines();
    ctx.save();
    ctx.strokeStyle = 'rgba(205, 246, 222, .42)';
    ctx.fillStyle = 'rgba(220, 250, 232, .68)';
    ctx.lineWidth = 1.35;
    ctx.lineCap = 'round';
    for (const points of fieldLines) {
      if (points.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();

      let distance = 0, nextArrow = 95;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        distance += Math.hypot(b.x - a.x, b.y - a.y);
        if (distance < nextArrow) continue;
        nextArrow += 95;
        const angle = Math.atan2(b.y - a.y, b.x - a.x), size = 5;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - size * Math.cos(angle - .55), b.y - size * Math.sin(angle - .55));
        ctx.lineTo(b.x - size * Math.cos(angle + .55), b.y - size * Math.sin(angle + .55));
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawCharges() {
    for (const c of charges) {
      const color = c.sign > 0 ? '#f16b61' : '#5ca9f4';
      ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(c.x, c.y, 17, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill(); ctx.restore();
      ctx.beginPath(); ctx.arc(c.x, c.y, 17, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = 'white'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(c.x - 6, c.y); ctx.lineTo(c.x + 6, c.y);
      if (c.sign > 0) { ctx.moveTo(c.x, c.y - 6); ctx.lineTo(c.x, c.y + 6); }
      ctx.stroke(); ctx.lineCap = 'butt';
    }
  }

  function overlapsWall(x, y, radius) {
    if (x < 25 + radius || x > W - 25 - radius || y < 25 + radius || y > H - 25 - radius) return true;
    return walls.some(w => {
      const nx = Math.max(w.x, Math.min(x, w.x + w.w));
      const ny = Math.max(w.y, Math.min(y, w.y + w.h));
      return (x - nx) ** 2 + (y - ny) ** 2 < radius ** 2;
    });
  }
  function placeAt(event) {
    if (running || finished) return;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * W / rect.width;
    const y = (event.clientY - rect.top) * H / rect.height;
    const existing = charges.findIndex(c => Math.hypot(x - c.x, y - c.y) < 22);
    if (existing >= 0) {
      charges.splice(existing, 1);
      fieldLines = null;
      updateUI('Charge removed. Place it somewhere else or press Go.');
      draw();
      return;
    }
    if (charges.length >= LIMIT) return;
    if (Math.hypot(x - puck.x, y - puck.y) < 35 || x > 835 && y > goal.top - 20 && y < goal.bottom + 20 || overlapsWall(x, y, 20)) {
      ui.status.textContent = 'That spot is blocked—choose an open space.';
      return;
    }
    charges.push({ x, y, sign: placingSign });
    fieldLines = null;
    updateUI(charges.length === LIMIT ? 'All charges placed. Press Go when ready.' : `${LIMIT - charges.length} charge${LIMIT - charges.length === 1 ? '' : 's'} left. Place another or press Go.`);
    draw();
  }

  function collide() {
    // Keep the puck within the rink; the right edge is the goal opening.
    if (puck.x < 31) { puck.x = 31; puck.vx = Math.abs(puck.vx) * .45; }
    if (puck.y < 31) { puck.y = 31; puck.vy = Math.abs(puck.vy) * .45; }
    if (puck.y > H - 31) { puck.y = H - 31; puck.vy = -Math.abs(puck.vy) * .45; }
    if (puck.x > W - 30 && !(puck.y > goal.top && puck.y < goal.bottom)) {
      puck.x = W - 30; puck.vx = -Math.abs(puck.vx) * .45;
    }
    for (const w of walls) {
      const nx = Math.max(w.x, Math.min(puck.x, w.x + w.w));
      const ny = Math.max(w.y, Math.min(puck.y, w.y + w.h));
      let dx = puck.x - nx, dy = puck.y - ny, d = Math.hypot(dx, dy);
      if (d < PUCK_R) {
        if (d < 0.001) {
          const edges = [
            { distance: puck.x - w.x, x: w.x - PUCK_R - .5, y: puck.y, nx: -1, ny: 0 },
            { distance: w.x + w.w - puck.x, x: w.x + w.w + PUCK_R + .5, y: puck.y, nx: 1, ny: 0 },
            { distance: puck.y - w.y, x: puck.x, y: w.y - PUCK_R - .5, nx: 0, ny: -1 },
            { distance: w.y + w.h - puck.y, x: puck.x, y: w.y + w.h + PUCK_R + .5, nx: 0, ny: 1 }
          ].sort((a, b) => a.distance - b.distance);
          const edge = edges[0];
          puck.x = edge.x; puck.y = edge.y; dx = edge.nx; dy = edge.ny; d = 1;
        }
        const ux = dx / d, uy = dy / d;
        if (d > 1) { puck.x = nx + ux * (PUCK_R + .5); puck.y = ny + uy * (PUCK_R + .5); }
        const impact = puck.vx * ux + puck.vy * uy;
        if (impact < 0) { puck.vx -= 1.45 * impact * ux; puck.vy -= 1.45 * impact * uy; }
      }
    }
  }

  function step(dt) {
    // Give the puck inertia: the field accelerates it, rather than forcing it
    // to stay tangent to a streamline. This lets its path cross field lines.
    const direction = fieldDirection(puck.x, puck.y);
    if (direction) {
      const acceleration = Math.min(220, direction.magnitude * .018);
      puck.vx += direction.x * acceleration * dt;
      puck.vy += direction.y * acceleration * dt;
    }
    const friction = Math.pow(.9985, dt * 60);
    puck.vx *= friction; puck.vy *= friction;
    let speed = Math.hypot(puck.vx, puck.vy);
    if (speed > 260) { puck.vx *= 260 / speed; puck.vy *= 260 / speed; }
    if (speed < 4) slowTime += dt; else slowTime = 0;
    puck.x += puck.vx * dt; puck.y += puck.vy * dt;
    collide();
    puck.trail.push({ x: puck.x, y: puck.y });
    if (puck.trail.length > 70) puck.trail.shift();

    if (puck.x >= goal.x && puck.y > goal.top + PUCK_R && puck.y < goal.bottom - PUCK_R) {
      win(); return;
    }
    if (slowTime > 5) {
      finish('The puck ran out of momentum. Reset and try a new charge layout.');
    }
  }

  function animate(now) {
    if (!running) return;
    const dt = Math.min((now - lastTime) / 1000 || 0, .025);
    lastTime = now;
    // A fixed small step keeps wall collisions and field forces stable.
    const count = Math.max(1, Math.ceil(dt / .008)), sub = dt / count;
    for (let i = 0; i < count && running; i++) step(sub);
    draw();
    if (running) animation = requestAnimationFrame(animate);
  }
  function finish(message) {
    running = false; finished = true; cancelAnimationFrame(animation);
    updateUI(message);
  }
  function win() {
    running = false; finished = true; cancelAnimationFrame(animation);
    const score = Math.max(1, (LIMIT - charges.length + 1) * 100);
    if (!bestScore || score > bestScore) {
      bestScore = score; localStorage.setItem('electricHockeyBest', String(score));
      ui.best.textContent = score;
    }
    ui.status.textContent = `GOAL! You scored ${score} points with ${charges.length} charge${charges.length === 1 ? '' : 's'}!`;
    ui.tip.textContent = 'Great shot! Reset to try again and see if you can score with fewer charges.';
    updateUI(); draw();
  }
  function start() {
    if (running || finished) return;
    running = true; slowTime = 0; ui.tip.textContent = 'The field accelerates the puck, but its momentum carries it across field lines. Wall collisions can deflect it.';
    updateUI('The puck is moving—watch it curve through the field!');
    lastTime = performance.now(); animation = requestAnimationFrame(animate);
  }
  function reset() {
    cancelAnimationFrame(animation); charges = []; fieldLines = null; puck = newPuck();
    running = false; finished = false; slowTime = 0;
    ui.tip.textContent = 'Tip: A positive puck is pushed away by + charges and pulled toward − charges. Use the wall openings!';
    updateUI('Place up to 5 charges on the field.'); draw();
  }

  canvas.addEventListener('pointerdown', placeAt);
  ui.plus.addEventListener('click', () => setSign(1));
  ui.minus.addEventListener('click', () => setSign(-1));
  ui.go.addEventListener('click', start);
  ui.reset.addEventListener('click', reset);
  window.addEventListener('resize', resize);
  puck = newPuck(); updateUI('Place up to 5 charges on the field.'); resize();
})();
