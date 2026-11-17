(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const {frames, rings, target_um: target, sraf_um: sraf, roi_um: roi, full_window_um: full} = window.rolloutData;
  const last = frames.length - 1;
  const palette = {target: '#415365', mask: '#1765b9', resist: '#007c73', sraf: '#7448a3', previous: '#748194', ap: '#884267'};
  const canvas = $('replay-canvas');
  const epePanels = ['full', 'roi'].map(scope => {
    const samples = frames.map(frame => stats(frame, scope));
    return {
      chart: $(`epe-${scope}-chart`),
      mean: $(`epe-${scope}-mean`),
      count: $(`epe-${scope}-count`),
      samples,
      series: samples.map(sample => sample.mean_abs_nm),
    };
  });
  const methodSection = $('method');
  const methodTabs = [...methodSection.querySelectorAll('.method-list [role="tab"]')];
  const methodPanels = methodTabs.map(tab => $(tab.getAttribute('aria-controls')));
  const networkPanel = $('method-update');
  const networkStages = [...networkPanel.querySelectorAll('[data-network-stage]')];
  const networkViews = [...networkPanel.querySelectorAll('[data-network-view]')];
  const temporalView = $('network-temporal');
  const geometryView = $('network-geometry');
  const {show: drawInitialization, last: initEnd} = window.methodInitialization;
  const initSlider = $('method-init-step');
  const updateCanvas = $('method-update-canvas');
  const updateSlider = $('method-update-time');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const slider = $('iteration');
  const play = $('play');
  const layers = Object.fromEntries([...document.querySelectorAll('[data-layer]')].map(input => [input.dataset.layer, input]));
  const measurement = window.epeSiteData;
  const gaugePositions = measurement.points.map(([, x, y]) => [x, y]);
  let iteration = 1;
  let view = 'roi';
  let timer = null;
  let methodStep = 0;
  let methodStage = 0;
  let methodTimer = null;
  const range = () => view === 'roi' ? roi : full;
  const inside = ([x, y], box) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
  const gauges = {roi: [], full: []};
  gaugePositions.forEach((point, index) => {
    if (inside(point, roi)) gauges.roi.push(index);
    if (inside(point, full)) gauges.full.push(index);
  });
  const value = n => n == null ? '—' : n.toFixed(3);

  function surface(element, {width, height} = element.getBoundingClientRect()) {
    const ratio = window.devicePixelRatio || 1;
    const wantedWidth = Math.round(width * ratio);
    const wantedHeight = Math.round(height * ratio);
    if (element.width !== wantedWidth || element.height !== wantedHeight) {
      element.width = wantedWidth;
      element.height = wantedHeight;
    }
    const ctx = element.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return {ctx, width, height};
  }

  function transform(width, height, box, margin = 20) {
    const [left, , right, top] = box;
    const size = Math.max(1, Math.min(width - margin, height - margin));
    const scale = size / (right - left);
    const x = (width - size) / 2;
    const y = (height - size) / 2;
    return {x, y, size, scale, map: ([a, b]) => [x + (a - left) * scale, y + (top - b) * scale]};
  }

  function polyPath(ctx, polygons, map) {
    ctx.beginPath();
    for (const [first, ...points] of polygons) {
      ctx.moveTo(...map(first));
      for (const point of points) ctx.lineTo(...map(point));
      ctx.closePath();
    }
  }

  function cubicPath(ctx, cubics, map) {
    ctx.beginPath();
    for (const ring of rings) {
      ctx.moveTo(...map(cubics[ring[0]][0]));
      for (const index of ring) {
        const [, p1, p2, end] = cubics[index];
        ctx.bezierCurveTo(...map(p1), ...map(p2), ...map(end));
      }
      ctx.closePath();
    }
  }

  function stroke(ctx, color, width, dash = []) {
    ctx.setLineDash(dash);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function arrow(ctx, [x0, y0], [x1, y1], weight) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    if (length < 1.3) return;
    const head = Math.min(6, length * .45);
    const ux = dx / length;
    const uy = dy / length;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.moveTo(x1 - head * ux + head * .49 * uy, y1 - head * uy - head * .49 * ux);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1 - head * ux - head * .49 * uy, y1 - head * uy + head * .49 * ux);
    stroke(ctx, palette.ap, weight);
  }

  function grid(ctx, g) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(g.x, g.y, g.size, g.size);
    ctx.beginPath();
    for (let i = 1; i < 7; i++) {
      const d = i * g.size / 7;
      ctx.moveTo(g.x + d, g.y); ctx.lineTo(g.x + d, g.y + g.size);
      ctx.moveTo(g.x, g.y + d); ctx.lineTo(g.x + g.size, g.y + d);
    }
    stroke(ctx, '#e8eff4', 1);
  }

  function scaleBar(ctx, g, microns) {
    const width = microns * g.scale;
    const y = g.y + g.size - 11;
    const x = g.x + g.size - width - 11;
    ctx.fillStyle = '#fffffff5';
    ctx.fillRect(x - 6, y - 19, width + 12, 25);
    ctx.beginPath();
    ctx.moveTo(x, y - 3); ctx.lineTo(x, y + 3);
    ctx.moveTo(x, y); ctx.lineTo(x + width, y);
    ctx.moveTo(x + width, y - 3); ctx.lineTo(x + width, y + 3);
    stroke(ctx, '#253d4e', 1.2);
    ctx.fillStyle = '#253d4e';
    ctx.textAlign = 'center';
    ctx.font = '11px Consolas, monospace';
    ctx.fillText(`${Math.round(microns * 1000)} nm`, x + width / 2, y - 6);
  }

  function visibleAnchors(frame, box) {
    const visible = [];
    frame.ap_um.forEach((position, index) => {
      if (inside(position, box)) {
        const delta = frame.delta_nm?.[index];
        visible.push({position, index, length: delta ? Math.hypot(...delta) : 0});
      }
    });
    return visible;
  }

  function mark(ctx, pos, color, radius) {
    ctx.beginPath();
    ctx.arc(...pos, radius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawGauges(ctx, g) {
    const values = measurement.iterations[iteration];
    const radius = view === 'roi' ? 2.7 : 1.55;
    for (const index of gauges[view]) {
      const point = g.map(gaugePositions[index]);
      const reading = values[index];
      if (reading === null) {
        ctx.fillStyle = '#667582a0';
        ctx.fillRect(point[0] - radius * .65, point[1] - radius * .65, radius * 1.3, radius * 1.3);
      } else {
        ctx.globalAlpha = .33 + .6 * Math.min(1, Math.abs(reading) / 18);
        mark(ctx, point, reading < 0 ? '#235aba' : '#bd601d', radius);
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawLayout() {
    const {ctx, width, height} = surface(canvas);
    const box = range();
    const g = transform(width, height, box, 24);
    const frame = frames[iteration];
    const prior = frames[iteration - 1];
    grid(ctx, g);
    ctx.save();
    ctx.beginPath(); ctx.rect(g.x, g.y, g.size, g.size); ctx.clip();
    if (layers.resist.checked) {
      polyPath(ctx, frame.resist_um, g.map);
      ctx.fillStyle = '#b8ded344'; ctx.fill('evenodd');
      stroke(ctx, palette.resist, 1.65);
    }
    if (layers.sraf.checked) {
      polyPath(ctx, sraf, g.map);
      ctx.fillStyle = '#956bb840'; ctx.fill('evenodd');
      stroke(ctx, palette.sraf, 1.15);
    }
    if (prior && layers.previous.checked) {
      cubicPath(ctx, prior.cubics_um, g.map);
      stroke(ctx, palette.previous, 1.15, [4, 3]);
    }
    if (layers.mask.checked) {
      cubicPath(ctx, frame.cubics_um, g.map);
      stroke(ctx, palette.mask, 1.6);
    }
    if (layers.target.checked) {
      polyPath(ctx, target, g.map);
      stroke(ctx, palette.target, 1.1, [5, 4]);
    }
    if (layers.ap.checked) {
      const visible = visibleAnchors(frame, box).sort((a, b) => b.length - a.length);
      const leading = visible.slice(0, view === 'roi' ? 21 : 28);
      for (const {position} of view === 'roi' ? visible : leading) mark(ctx, g.map(position), '#36597098', 1.75);
      if (prior) leading.forEach(({position, index}) => arrow(ctx, g.map(prior.ap_um[index]), g.map(position), 1.12));
    }
    if (layers.epe.checked) drawGauges(ctx, g);
    if (view === 'full') {
      const [x, y] = g.map([roi[0], roi[3]]);
      ctx.strokeStyle = '#ab6d15'; ctx.lineWidth = 2;
      ctx.strokeRect(x, y, (roi[2] - roi[0]) * g.scale, (roi[3] - roi[1]) * g.scale);
    }
    ctx.restore();
    ctx.strokeStyle = '#c4d3df'; ctx.lineWidth = 1;
    ctx.strokeRect(g.x, g.y, g.size, g.size);
    scaleBar(ctx, g, view === 'roi' ? .05 : .25);
  }

  function drawMethodGeometry(element, draw) {
    const {ctx, width, height} = surface(element);
    const g = transform(width, height, roi, 19);
    grid(ctx, g);
    ctx.save();
    ctx.beginPath(); ctx.rect(g.x, g.y, g.size, g.size); ctx.clip();
    draw(ctx, g);
    ctx.restore();
    ctx.lineWidth = 1; ctx.strokeStyle = '#c4d3df';
    ctx.strokeRect(g.x, g.y, g.size, g.size);
    scaleBar(ctx, g, .05);
  }

  function drawCorrections() {
    updateSlider.value = methodStage;
    updateSlider.setAttribute('aria-valuetext', methodStage === 0 ? 'Initial mask' : `Iteration ${methodStage} of ${last}`);
    $('method-update-stage').textContent = methodStage === 0 ? 'Initial mask'
      : `Iteration ${String(methodStage).padStart(2, '0')} / ${last}`;
    drawMethodGeometry(updateCanvas, (ctx, g) => {
      const frame = frames[methodStage];
      for (let index = Math.max(0, methodStage - 3); index < methodStage; index++) {
        cubicPath(ctx, frames[index].cubics_um, g.map);
        const opacity = 0.58 / (methodStage - index);
        stroke(ctx, `rgba(83,111,137,${opacity})`, 1.4, [4, 3]);
      }
      cubicPath(ctx, frame.cubics_um, g.map);
      ctx.fillStyle = '#cce4f150'; ctx.fill('evenodd');
      stroke(ctx, palette.mask, 1.9);
      const prior = frames[methodStage - 1];
      const anchors = visibleAnchors(frame, roi).sort((a, b) => b.length - a.length).slice(0, 14);
      for (const {position, index} of anchors) {
        const point = g.map(position);
        if (prior) arrow(ctx, g.map(prior.ap_um[index]), point, 1.4);
        mark(ctx, point, '#fff', 2.05);
        stroke(ctx, palette.ap, 1.15);
      }
    });
  }

  function renderMethod() {
    methodPanels[methodStep].dataset.stage = methodStage;
    if (methodStep === 0) drawInitialization(methodStage);
    if (methodStep === 2 && !temporalView.hidden) drawCorrections();
  }

  function stopMethod() {
    window.clearTimeout(methodTimer);
    methodTimer = null;
  }

  function playNetworkFlow(view) {
    view.classList.remove('is-flowing');
    if (reducedMotion.matches) return;
    // Reset the CSS animation when replay is pressed before the current flow ends.
    void view.offsetWidth;
    view.classList.add('is-flowing');
  }

  function chooseMethod(step, animate = step === 2 && !temporalView.hidden && !reducedMotion.matches) {
    stopMethod();
    methodStep = step;
    const end = [initEnd, 0, last][step];
    methodStage = animate || step !== 2 ? 0 : end;
    methodTabs.forEach((tab, index) => {
      const active = index === step;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      methodPanels[index].hidden = !active;
    });
    renderMethod();
    if (step === 2) playNetworkFlow(networkViews.find(view => !view.hidden));
    if (animate) {
      const delay = step === 0 ? 1650 : 250;
      function advance() {
        methodStage++;
        renderMethod();
        methodTimer = methodStage < end ? window.setTimeout(advance, delay) : null;
      }
      methodTimer = window.setTimeout(advance, delay);
    }
  }

  function stats(frame, scope) {
    if (scope === 'roi') return frame.roi_epe;
    const m = frame.metrics;
    return {mean_abs_nm: m.epe_mean_abs_nm, sites: m.epe_sites,
            valid_sites: m.epe_valid_sites, exceptions: m.epe_search_exceptions};
  }

  function plotBox(width, height) {
    return {left: 36, right: width - 15, top: 16, bottom: height - 25};
  }

  function drawSeries(element, ys, color) {
    const {ctx, width, height} = surface(element);
    const {left, right, top, bottom} = plotBox(width, height);
    const maximum = Math.max(.1, ...ys.filter(Number.isFinite));
    const unit = 10 ** Math.floor(Math.log10(maximum / 4));
    const step = Math.ceil(maximum / 4 / unit) * unit;
    const x = i => left + i / last * (right - left);
    const y = n => bottom - n / (step * 4) * (bottom - top);
    ctx.font = '11px Consolas, monospace';
    ctx.fillStyle = '#526b7e';
    ctx.textAlign = 'right';
    for (let tick = 0; tick <= 4; tick++) {
      const n = tick * step;
      ctx.beginPath(); ctx.moveTo(left, y(n)); ctx.lineTo(right, y(n));
      stroke(ctx, '#deE8ef', 1);
      ctx.fillText(Number(n.toPrecision(4)), left - 6, y(n) + 4);
    }
    ctx.textAlign = 'center';
    [0, 4, 8, 12, last].forEach(i => ctx.fillText(i, x(i), bottom + 16));
    ctx.beginPath(); ctx.moveTo(x(iteration), top); ctx.lineTo(x(iteration), bottom);
    stroke(ctx, '#839fb7', 1, [3, 4]);
    ctx.beginPath();
    let connected = false;
    ys.forEach((n, i) => {
      if (n === null) { connected = false; return; }
      if (connected) ctx.lineTo(x(i), y(n)); else ctx.moveTo(x(i), y(n));
      connected = true;
    });
    stroke(ctx, color, 2);
    ys.forEach((n, i) => {
      if (n === null) return;
      if (i === iteration) {
        mark(ctx, [x(i), y(n)], '#fff', 4.1);
        stroke(ctx, color, 2);
      } else {
        mark(ctx, [x(i), y(n)], color, 2.1);
      }
    });
  }

  function drawEpeCharts() {
    for (const {chart, series} of epePanels) drawSeries(chart, series, palette.mask);
  }

  function render() {
    $('replay-dimension').textContent = view === 'roi' ? '350 × 350 nm' : '2 × 2 µm';
    $('iteration-text').textContent = iteration === 0 ? `Initial / ${last}` : `${String(iteration).padStart(2, '0')} / ${last}`;
    slider.value = iteration;
    slider.setAttribute('aria-valuetext', iteration === 0 ? 'Initial state' : `Iteration ${iteration}`);
    $('prev').disabled = iteration === 0;
    $('next').disabled = iteration === last;
    layers.previous.disabled = iteration === 0;
    for (const panel of epePanels) {
      const result = panel.samples[iteration];
      panel.mean.textContent = `${value(result.mean_abs_nm)} nm`;
      panel.count.textContent = `${result.valid_sites.toLocaleString('en-US')} / ${result.sites.toLocaleString('en-US')} valid sites · ${result.exceptions.toLocaleString('en-US')} search exceptions`;
    }
    $('epe-probe').hidden = !layers.epe.checked;
    drawLayout();
    drawEpeCharts();
  }

  function stop() {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    play.textContent = '▶ Play';
  }
  new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) stop(); }).observe($('rollout'));
  new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) stopMethod(); }).observe(methodSection);
  methodTabs.forEach((tab, index) => tab.addEventListener('click', () => chooseMethod(index)));
  for (const path of networkPanel.querySelectorAll('.network-links path')) path.setAttribute('pathLength', '100');
  for (const button of networkStages) {
    button.addEventListener('click', () => {
      const stage = button.dataset.networkStage;
      for (const control of networkStages) control.setAttribute('aria-pressed', String(control === button));
      for (const view of networkViews) view.hidden = view.dataset.networkView !== stage;
      chooseMethod(2);
    });
  }
  for (const button of networkPanel.querySelectorAll('[data-network-replay]')) {
    button.addEventListener('click', () => playNetworkFlow(button.closest('[data-network-view]')));
  }
  const tokenLevels = [...geometryView.querySelectorAll('[data-token-level]')];
  const tokenNotes = {
    ap: 'AP tokens encode Fourier features of anchor coordinates and local state attributes.',
    polygon: 'The polygon token combines attention-pooled AP features with the centroid and coordinate spread. A polygon Transformer processes the polygon tokens.',
    layout: 'Pooled polygon features combine with a target-layout embedding to encode global context.',
  };
  for (const button of tokenLevels) {
    button.addEventListener('click', () => {
      const level = button.dataset.tokenLevel;
      geometryView.dataset.token = level;
      $('network-token-note').textContent = tokenNotes[level];
      for (const choice of tokenLevels) choice.setAttribute('aria-pressed', String(choice === button));
    });
  }
  $('method-init-replay').addEventListener('click', () => chooseMethod(0, true));
  $('method-update-replay').addEventListener('click', () => chooseMethod(2, true));
  updateSlider.max = last;
  for (const control of [initSlider, updateSlider]) {
    control.addEventListener('input', () => {
      stopMethod();
      methodStage = Number(control.value);
      renderMethod();
    });
  }
  methodTabs[0].parentElement.addEventListener('keydown', event => {
    const count = methodTabs.length;
    const next = {
      ArrowUp: (methodStep + count - 1) % count, ArrowDown: (methodStep + 1) % count,
      Home: 0, End: count - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    chooseMethod(next);
    methodTabs[next].focus();
  });
  reducedMotion.addEventListener('change', () => { if (!methodSection.hidden) chooseMethod(methodStep); });

  function go(next) {
    iteration = Math.min(last, Math.max(0, next));
    render();
  }

  function bindChoice(attribute, onChange) {
    const buttons = [...document.querySelectorAll(`[data-${attribute}]`)];
    buttons.forEach(button => button.addEventListener('click', () => {
      buttons.forEach(candidate => candidate.setAttribute('aria-pressed', String(candidate === button)));
      onChange(button.dataset[attribute]);
      render();
    }));
  }

  bindChoice('view', selection => { view = selection; });
  Object.values(layers).forEach(input => input.addEventListener('change', render));
  slider.max = last;
  slider.addEventListener('input', () => { stop(); go(Number(slider.value)); });
  $('prev').addEventListener('click', () => { stop(); go(iteration - 1); });
  $('next').addEventListener('click', () => { stop(); go(iteration + 1); });
  play.addEventListener('click', () => {
    if (timer !== null) { stop(); return; }
    if (iteration === last) go(0);
    play.textContent = '▮▮ Pause';
    timer = window.setInterval(() => {
      go(iteration + 1);
      if (iteration === last) stop();
    }, 560);
  });
  for (const {chart} of epePanels) {
    chart.addEventListener('click', event => {
      const rect = chart.getBoundingClientRect();
      const box = plotBox(rect.width, rect.height);
      stop();
      go(Math.round((event.clientX - rect.left - box.left) / (box.right - box.left) * last));
    });
  }

  render();
  if (!methodSection.hidden) chooseMethod(0);
  const resize = new ResizeObserver(() => { drawLayout(); drawEpeCharts(); });
  resize.observe(canvas);
  for (const {chart} of epePanels) resize.observe(chart);
  new ResizeObserver(() => {
    if (!methodSection.hidden && methodStep === 2 && !temporalView.hidden) drawCorrections();
  }).observe(updateCanvas);
})();
