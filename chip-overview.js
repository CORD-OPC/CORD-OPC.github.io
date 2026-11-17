(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const frame = $('chip-frame');
  const canvas = $('chip-canvas');
  const context = canvas.getContext('2d');
  const zoomInput = $('chip-zoom');
  const detail = $('chip-detail');
  const layerCaption = $('chip-layer-caption');
  const pins = $('chip-pins');
  const pinLeaders = $('chip-pin-leaders');
  const exampleBounds = $('chip-example-bounds');
  const exampleStatus = $('chip-example-status');
  const comparison = $('chip-example-compare');
  const comparisonPanels = [...comparison.querySelectorAll('[data-example-method]')];
  const displayButtons = [...comparison.querySelectorAll('[data-crop-display]')];
  const sourceButtons = [...document.querySelectorAll('[data-chip-source]')];
  const outline = $('chip-outline');
  const stacked = window.comparisonIsStacked;
  const layerButtons = [...document.querySelectorAll('[data-chip-layer]')];
  const {left: chipLeft, top: chipTop, span, tileSize, tileCount, ticksPerMicron} = chipLayout;
  const worldX = value => (value - chipLeft) / span;
  const worldY = value => (chipTop - value) / span;
  const maxZoom = Number(zoomInput.max);
  const vectorZoom = 5;
  const colors = ['overlap', 'missing', 'extra'].map(name =>
    getComputedStyle(canvas).getPropertyValue(`--chip-${name}`).trim()
  );
  const layers = {
    difference: {caption: 'Differences between the target and simulated resist', regions: [0, 1, 2]},
    target: {caption: 'Target layout', regions: [0, 1], color: '#416c8b'},
    resist: {caption: 'CORD-OPC simulated resist', regions: [0, 2], color: '#245e77'},
  };
  const tiles = new Map();
  const mask = document.createElement('canvas');
  const maskContext = mask.getContext('2d');
  let zoom = 1;
  let x = 0;
  let y = 0;
  let drag = null;
  let layer = 'resist';
  let overview = null;
  let overviewFailed = false;
  let animation = 0;
  let vectorView = null;
  let selectedCrop = null;
  let fieldRequest = null;
  let fieldBounds = null;
  let display = 'contours';
  let source = 'examples';
  const fieldControls = [];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const percent = value => `${100 * value}%`;
  const exampleName = example => `Example ${example.id}, ${example.title}`;
  const svgNode = tag => document.createElementNS('http://www.w3.org/2000/svg', tag);
  const pinOffsets = [[0, 0], [0, -34], [34, 0], [0, 34], [-34, 0], [34, -34],
                      [-34, -34], [34, 34], [-34, 34], [0, 68], [68, 0], [-68, 0], [0, -68]];

  const exampleControls = chipExamples.map(example => {
    const pin = document.createElement('button');
    pin.className = 'chip-pin';
    pin.type = 'button';
    pin.textContent = example.id;
    pin.title = exampleName(example);
    pin.setAttribute('aria-label', `Zoom to ${exampleName(example)}`);
    pin.addEventListener('click', () => focusCrop(example, true));
    pins.append(pin);
    const leader = svgNode('g');
    const line = svgNode('line');
    const dot = svgNode('circle');
    dot.setAttribute('r', '3.5');
    leader.append(line, dot);
    pinLeaders.append(leader);

    const row = document.createElement('li');
    const button = document.createElement('button');
    button.className = 'chip-example-link';
    button.type = 'button';
    button.setAttribute('aria-label', `Zoom to ${exampleName(example)}`);
    const id = document.createElement('span');
    id.className = 'chip-example-id';
    id.textContent = example.id;
    const label = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = example.title;
    const baseline = document.createElement('small');
    baseline.textContent = `FuILT · ${example.outcomes.fuilt}`;
    label.append(title, baseline);
    button.append(id, label);
    button.addEventListener('click', () => focusCrop(example));
    row.append(button);
    $('chip-example-list').append(row);
    return {crop: example, pin, button, leader, line, dot};
  });
  const iouMap = createChipIouMap(frame, crop => focusCrop(crop, true));
  const isIouOverview = () => source === 'iou' && !selectedCrop;
  const layoutLabel = frame.getAttribute('aria-label');

  function scheduleRender() {
    if (!animation) animation = requestAnimationFrame(render);
  }

  function loadOverview(name) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = `assets/fullchip/overview-${name}.webp`;
    });
  }

  async function decodeTile(key, base64) {
    const data = new Int32Array(await unpackChipGzip(base64));
    const [i, j] = key.split('-').map(Number);
    const originX = i * tileSize;
    const originY = j * tileSize;
    let offset = 0;
    return colors.map(() => {
      const path = new Path2D();
      const rings = data[offset++];
      for (let ring = 0; ring < rings; ring++) {
        let points = data[offset++];
        path.moveTo(originX + data[offset++] / ticksPerMicron, originY + data[offset++] / ticksPerMicron);
        while (--points > 0) {
          path.lineTo(originX + data[offset++] / ticksPerMicron, originY + data[offset++] / ticksPerMicron);
        }
        path.closePath();
      }
      return path;
    });
  }

  window.registerChipTile = (key, payload) => {
    const tile = tiles.get(key);
    decodeTile(key, payload).then(paths => {
      tile.paths = paths;
    }).catch(() => {
      tile.failed = true;
    }).finally(scheduleRender);
  };

  function requestTile(key) {
    const existing = tiles.get(key);
    if (existing) {
      tiles.delete(key);
      tiles.set(key, existing);
      return existing;
    }
    const tile = {};
    tiles.set(key, tile);
    const script = document.createElement('script');
    script.src = `assets/fullchip/${key}.js`;
    script.onload = () => script.remove();
    script.onerror = () => {
      tile.failed = true;
      script.remove();
      scheduleRender();
    };
    document.head.append(script);
    return tile;
  }

  function viewportKeys() {
    const index = micron => clamp(Math.floor(micron / tileSize), 0, tileCount - 1);
    const west = index(chipLeft - x * span / zoom);
    const east = index(chipLeft + (1 - x) * span / zoom);
    const north = index(chipTop + y * span / zoom);
    const south = index(chipTop - (1 - y) * span / zoom);
    const keys = [];
    for (let j = south; j <= north; j++) {
      for (let i = west; i <= east; i++) keys.push(`${i}-${j}`);
    }
    return keys;
  }

  function renderOverview(width, height) {
    if (!overview) return;
    for (const index of layers[layer].regions) {
      maskContext.clearRect(0, 0, width, height);
      maskContext.drawImage(overview[index], x * width, y * height, zoom * width, zoom * height);
      maskContext.globalCompositeOperation = 'source-in';
      maskContext.fillStyle = layers[layer].color ?? colors[index];
      maskContext.fillRect(0, 0, width, height);
      maskContext.globalCompositeOperation = 'source-over';
      context.drawImage(mask, 0, 0);
    }
  }

  function renderVectors(keys, visible, width, height) {
    const signature = `${layer}:${keys.join(',')}`;
    if (vectorView?.signature !== signature) {
      const {regions, color} = layers[layer];
      const paths = color ? [new Path2D()] : regions.map(() => new Path2D());
      for (const tile of visible) {
        regions.forEach((index, position) => paths[color ? 0 : position].addPath(tile.paths[index]));
      }
      vectorView = {signature, paths, inks: color ? [color] : colors};
    }
    const sx = width * zoom / span;
    const sy = height * zoom / span;
    context.setTransform(sx, 0, 0, -sy, x * width - sx * chipLeft, y * height + sy * chipTop);
    vectorView.paths.forEach((path, index) => {
      context.fillStyle = vectorView.inks[index];
      context.fill(path);
    });
    context.resetTransform();
  }

  function drawChip() {
    const width = Math.round(frame.clientWidth * devicePixelRatio);
    const height = Math.round(frame.clientHeight * devicePixelRatio);
    if (!width || !height) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = mask.width = width;
      canvas.height = mask.height = height;
    }
    context.clearRect(0, 0, width, height);
    const keys = zoom >= vectorZoom ? viewportKeys() : [];
    const visible = keys.map(requestTile);
    const ready = visible.length && visible.every(tile => tile.paths);
    if (ready) {
      renderVectors(keys, visible, width, height);
    } else {
      renderOverview(width, height);
    }
    for (const [key, tile] of tiles) {
      if (!keys.includes(key) && (tile.failed || (tiles.size > 40 && tile.paths))) tiles.delete(key);
    }
    const status = ready ? 'Vector detail'
      : visible.some(tile => tile.failed) ? 'Vector detail unavailable'
      : visible.length ? 'Loading vector detail…'
      : overview ? 'Full-chip overview'
      : overviewFailed ? 'Overview unavailable' : 'Loading overview…';
    if (detail.textContent !== status) detail.textContent = status;
    return ready;
  }

  function renderSelection(vectorReady) {
    pins.hidden = source === 'iou' || zoom >= vectorZoom;
    pinLeaders.toggleAttribute('hidden', pins.hidden);
    if (!pins.hidden) {
      const width = frame.clientWidth;
      const height = frame.clientHeight;
      const positions = [];
      for (const {crop, pin, leader, line, dot} of exampleControls) {
        const px = (x + worldX(crop.point[0]) * zoom) * width;
        const py = (y + worldY(crop.point[1]) * zoom) * height;
        pin.hidden = Math.min(px, py, width - px, height - py) < 0;
        leader.toggleAttribute('hidden', pin.hidden);
        if (pin.hidden) continue;
        const candidates = pinOffsets.map(([dx, dy]) =>
          [clamp(px + dx, 16, width - 16), clamp(py + dy, 16, height - 16)]
        );
        const [left, top] = candidates.find(([cx, cy]) =>
          positions.every(([ox, oy]) => Math.abs(cx - ox) >= 32 || Math.abs(cy - oy) >= 32)
        ) ?? candidates[0];
        positions.push([left, top]);
        pin.style.left = `${left}px`;
        pin.style.top = `${top}px`;
        line.setAttribute('x1', px);
        line.setAttribute('y1', py);
        line.setAttribute('x2', left);
        line.setAttribute('y2', top);
        dot.setAttribute('cx', px);
        dot.setAttribute('cy', py);
      }
    }
    const region = source === 'field' ? fieldBounds : null;
    const bounds = selectedCrop?.bounds ?? region;
    if (!bounds || (selectedCrop && !vectorReady)) {
      exampleBounds.hidden = true;
      return;
    }
    const [west, south, east, north] = bounds;
    const left = x + worldX(west) * zoom;
    const right = x + worldX(east) * zoom;
    const top = y + worldY(north) * zoom;
    const bottom = y + worldY(south) * zoom;
    exampleBounds.style.left = percent(left);
    exampleBounds.style.top = percent(top);
    exampleBounds.style.width = percent(right - left);
    exampleBounds.style.height = percent(bottom - top);
    exampleBounds.dataset.site = selectedCrop?.id ?? 'field';
    exampleBounds.hidden = right <= 0 || left >= 1 || bottom <= 0 || top >= 1;
  }

  function render() {
    animation = 0;
    const showIou = isIouOverview();
    const mapLabel = showIou
      ? 'Whole-chip map. Use arrow keys to read the IoU values. Press Enter to compare.'
      : layoutLabel;
    if (frame.getAttribute('aria-label') !== mapLabel) frame.setAttribute('aria-label', mapLabel);
    iouMap.setVisible(showIou);
    $('chip-iou-legend').hidden = !showIou;
    $('chip-iou-back').hidden = source !== 'iou' || showIou;
    $('chip-map-title').textContent = showIou ? 'Whole-chip map · 5 × 5 µm squares' : '150 × 150 µm layout';
    $('chip-iou-instruction').hidden = $('chip-iou-caption').hidden = !showIou;
    $('chip-field-location').hidden = source !== 'field' || !fieldBounds || Boolean(selectedCrop);
    $('chip-scale').hidden = $('chip-tools').hidden = $('chip-layer-controls').hidden = showIou;
    canvas.hidden = detail.hidden = showIou;
    $('chip-legend').hidden = showIou || layer !== 'difference';
    layerCaption.hidden = showIou || layer === 'difference';
    frame.dataset.zoomed = String(zoom > 1);
    if (document.activeElement !== zoomInput) zoomInput.value = Number(zoom.toFixed(1));
    $('chip-zoom-in').disabled = zoom >= maxZoom;
    $('chip-zoom-out').disabled = zoom <= 1;
    const scale = [20, 10, 5, 2, 1, .5, .2].find(length => length * zoom / span <= .18);
    $('chip-scale-bar').style.width = `${100 * scale * zoom / span}cqw`;
    $('chip-scale-text').textContent = scale < 1 ? `${scale * 1000} nm` : `${scale} µm`;
    renderSelection(!showIou && drawChip());
  }

  function pan(nextX, nextY) {
    x = clamp(nextX, 1 - zoom, 0);
    y = clamp(nextY, 1 - zoom, 0);
    scheduleRender();
  }

  function changeZoom(factor, focusX = .5, focusY = .5) {
    const nextZoom = clamp(zoom * factor, 1, maxZoom);
    const ratio = nextZoom / zoom;
    zoom = nextZoom;
    pan(focusX - ratio * (focusX - x), focusY - ratio * (focusY - y));
  }

  function coordinates(event) {
    const rect = frame.getBoundingClientRect();
    return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
  }

  function selectCrop(crop) {
    selectedCrop = crop;
    exampleBounds.hidden = true;
    for (const control of exampleControls) {
      for (const element of [control.button, control.pin]) {
        if (control.crop === crop) element.setAttribute('aria-current', 'true');
        else element.removeAttribute('aria-current');
      }
    }
    for (const control of fieldControls) control.button.setAttribute('aria-pressed', String(control.crop === crop));
    exampleStatus.textContent = crop ? `${cropTitle(crop)} selected` : '';
    comparison.hidden = !crop;
    if (crop) renderComparison(crop);
  }

  function cropTitle(crop) {
    if (crop.iouIndex !== undefined) return `Cell ${crop.id}`;
    return crop.title ? `Example ${crop.id} · ${crop.title}` : `Tile ${crop.id}`;
  }

  function witnessBracket(witness) {
    const [[x0, y0], [x1, y1]] = witness;
    const length = Math.hypot(x1 - x0, y1 - y0);
    const direction = y1 >= y0 ? 1 : -1;
    const dx = direction * (y1 - y0) * 53 / length;
    const dy = direction * (x0 - x1) * 53 / length;
    return `M${x0} ${y0}L${x0 + dx} ${y0 + dy}L${x1 + dx} ${y1 + dy}L${x1} ${y1}`;
  }

  function renderComparison(crop) {
    const [west, south, east, north] = crop.bounds;
    const nm = Math.round((east - west) * 1000);
    const unit = nm >= 1000 ? 'µm' : 'nm';
    const size = nm >= 1000 ? nm / 1000 : nm;
    const difference = display === 'difference';
    const guide = crop.witness && !difference ? witnessBracket(crop.witness) : '';
    $('chip-example-title').textContent = cropTitle(crop);
    $('chip-crop-size').textContent = `${size} × ${size} ${unit}`;
    $('chip-crop-coordinates').textContent = `x ${((west + east) / 2).toFixed(3)}, y ${((south + north) / 2).toFixed(3)} µm`;
    comparison.dataset.display = display;
    $('chip-outline-toggle').hidden = difference;
    $('chip-crop-legend').hidden = !difference;
    for (const panel of comparisonPanels) {
      const method = panel.dataset.exampleMethod;
      const outcome = crop.outcomes?.[method];
      const name = panel.querySelector('h3').textContent;
      const label = panel.querySelector('.crop-outcome');
      const svg = panel.querySelector('svg');
      label.textContent = outcome ?? '';
      label.hidden = !outcome;
      svg.setAttribute('aria-label', outcome ? `${name}: ${outcome}` : `${name} contour of ${cropTitle(crop)}`);
      svg.setAttribute('viewBox', `0 0 ${nm} ${nm}`);
      svg.querySelector('.example-shape').setAttribute('d', difference ? crop.paths.target : crop.paths[method]);
      svg.querySelector('.example-guide').setAttribute('d', guide);
      if (method === 'target') continue;
      const {missing, extra, missing_area, extra_area} = crop.errors[method];
      svg.querySelector('.example-outline').setAttribute('d', !difference && outline.checked ? crop.paths.target : '');
      svg.querySelector('.example-missing').setAttribute('d', difference ? missing : '');
      svg.querySelector('.example-extra').setAttribute('d', difference ? extra : '');
      const iou = crop.iou[method];
      panel.querySelector('.crop-foot').textContent = difference
        ? `Missing ${missing_area.toFixed(3)} · Extra ${extra_area.toFixed(3)} µm²`
        : `Crop IoU ${iou === null ? '—' : `${iou.toFixed(1)}%`}`;
    }
  }

  function centerOn(bounds, requestedZoom) {
    const [west, south, east, north] = bounds;
    zoom = clamp(requestedZoom, 1, maxZoom);
    pan(.5 - worldX((west + east) / 2) * zoom, .5 - worldY((south + north) / 2) * zoom);
  }

  function focusCrop(crop, fromPin = false) {
    if (crop.title) setSource('examples');
    selectCrop(crop);
    setLayer('resist');
    const cropWidth = crop.bounds[2] - crop.bounds[0];
    centerOn(crop.bounds, span / (cropWidth * 1.32));
    if (fromPin || stacked()) comparison.focus({preventScroll: true});
    if (stacked()) window.revealComparisonTarget(comparison);
  }

  function resetView() {
    iouMap.reset();
    selectCrop(null);
    zoom = 1;
    pan(0, 0);
  }

  function renderField(field) {
    fieldBounds = field.bounds;
    const [west, south, east, north] = fieldBounds;
    $('chip-field-coordinates').textContent = `x ${west}–${east} · y ${south}–${north} µm`;
    $('chip-field-frame').querySelector('path').setAttribute('d', field.context);
    const grid = $('chip-field-tiles');
    grid.style.gridTemplateColumns = `repeat(${field.columns}, minmax(0,1fr))`;
    const gains = field.tiles.map(tile => tile.iou.proteus - tile.iou.fuilt);
    const low = Math.min(...gains);
    const high = Math.max(...gains);
    $('tile-legend-range').textContent = `${low.toFixed(1)} to ${high.toFixed(1)} pp`;
    field.tiles.forEach((crop, index) => {
      const button = document.createElement('button');
      button.className = 'tile-cell';
      button.type = 'button';
      button.textContent = crop.id;
      button.setAttribute('aria-label', `Compare tile ${crop.id}`);
      button.setAttribute('aria-pressed', 'false');
      button.title = `${crop.id} · ΔIoU ${gains[index].toFixed(1)} percentage points`;
      const t = (gains[index] - low) / (high - low || 1);
      const color = [237 - 109 * t, 246 - 59 * t, 251 - 25 * t].map(Math.round).join(' ');
      button.style.setProperty('--tile-shade', `rgb(${color} / .88)`);
      button.addEventListener('click', () => focusCrop(crop, true));
      fieldControls.push({crop, button});
      grid.append(button);
    });
    $('chip-field-legend').hidden = false;
    const starter = $('chip-field-start');
    starter.addEventListener('click', () => focusCrop(field.tiles[gains.indexOf(high)], true));
    starter.hidden = false;
  }

  function loadField() {
    if (fieldRequest) return fieldRequest;
    const script = document.createElement('script');
    const status = $('chip-field-status');
    status.hidden = false;
    status.textContent = 'Loading field…';
    script.src = 'assets/fullchip/field.js';
    fieldRequest = new Promise((resolve, reject) => {
      script.onload = () => resolve(window.chipInspectionField);
      script.onerror = reject;
      document.head.append(script);
    }).then(field => {
      renderField(field);
      status.hidden = true;
      return field;
    }).catch(() => {
      status.textContent = 'Local grid unavailable. Select Local grid to retry.';
      fieldRequest = null;
      return null;
    }).finally(() => script.remove());
    return fieldRequest;
  }

  function setSource(value) {
    source = value;
    $('chip-examples').hidden = source !== 'examples';
    $('chip-field').hidden = source !== 'field';
    $('chip-iou-panel').hidden = source !== 'iou';
    sourceButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.chipSource === source)));
  }

  sourceButtons.forEach(button => button.addEventListener('click', async () => {
    const value = button.dataset.chipSource;
    if (value !== 'field' && source === value) return;
    if (source !== value) resetView();
    setSource(value);
    if (value === 'field') {
      const field = await loadField();
      if (field && source === value && !selectedCrop) centerOn(field.bounds, 10);
    }
  }));
  $('chip-iou-back').addEventListener('click', () => {
    resetView();
    frame.focus({preventScroll: true});
    if (stacked()) window.revealComparisonTarget(frame);
  });

  displayButtons.forEach(button => button.addEventListener('click', () => {
    display = button.dataset.cropDisplay;
    displayButtons.forEach(control => control.setAttribute('aria-pressed', String(control === button)));
    if (selectedCrop) renderComparison(selectedCrop);
  }));
  outline.addEventListener('change', () => {
    if (selectedCrop) renderComparison(selectedCrop);
  });

  $('chip-zoom-in').addEventListener('click', () => changeZoom(1.5));
  $('chip-zoom-out').addEventListener('click', () => changeZoom(1 / 1.5));
  $('chip-reset').addEventListener('click', resetView);
  zoomInput.addEventListener('change', () => {
    if (Number.isFinite(zoomInput.valueAsNumber)) changeZoom(zoomInput.valueAsNumber / zoom);
    zoomInput.value = Number(zoom.toFixed(1));
  });
  zoomInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') zoomInput.blur();
  });
  function setLayer(value) {
    layer = value;
    layerButtons.forEach(control => control.setAttribute('aria-pressed', String(control.dataset.chipLayer === layer)));
    $('chip-legend').hidden = layer !== 'difference';
    layerCaption.hidden = layer === 'difference';
    layerCaption.textContent = layers[layer].caption;
    canvas.setAttribute('aria-label', layers[layer].caption);
    scheduleRender();
  }
  layerButtons.forEach(button => button.addEventListener('click', () => setLayer(button.dataset.chipLayer)));
  frame.addEventListener('dblclick', event => {
    if (!isIouOverview() && !event.target.closest('a, button')) changeZoom(1.5, ...coordinates(event));
  });
  frame.addEventListener('wheel', event => {
    if (isIouOverview() || !event.ctrlKey) return;
    event.preventDefault();
    changeZoom(Math.exp(-event.deltaY * .009), ...coordinates(event));
  }, {passive: false});
  frame.addEventListener('pointerdown', event => {
    if (event.button !== 0 || zoom === 1 || event.target.closest('a, button')) return;
    const [pointerX, pointerY] = coordinates(event);
    drag = {id: event.pointerId, x: pointerX - x, y: pointerY - y};
    frame.setPointerCapture(event.pointerId);
    frame.dataset.dragging = 'true';
  });
  frame.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const [pointerX, pointerY] = coordinates(event);
    pan(pointerX - drag.x, pointerY - drag.y);
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => frame.addEventListener(type, event => {
    if (event.pointerId === drag?.id) {
      drag = null;
      frame.dataset.dragging = 'false';
    }
  }));
  frame.addEventListener('keydown', event => {
    if (event.target !== frame) return;
    if (isIouOverview()) {
      iouMap.keydown(event);
      return;
    }
    const action = {
      '+': () => changeZoom(1.5), '=': () => changeZoom(1.5), '-': () => changeZoom(1 / 1.5),
      '0': resetView,
      ArrowLeft: () => pan(x + .12, y), ArrowRight: () => pan(x - .12, y),
      ArrowUp: () => pan(x, y + .12), ArrowDown: () => pan(x, y - .12),
    }[event.key];
    if (action) { event.preventDefault(); action(); }
  });
  new ResizeObserver(scheduleRender).observe(frame);
  const query = new URLSearchParams(location.search);
  const featured = chipExamples.find(example => example.id === (query.get('case') ?? query.get('preview-case') ?? '4'));
  if (featured) {
    if (query.has('case') || !query.has('preview-case')) focusCrop(featured);
    else selectCrop(featured);
  }
  else if (query.get('view') === 'iou') setSource('iou');
  window.addEventListener('resize', scheduleRender);
  Promise.all(['overlap', 'missing', 'extra'].map(loadOverview)).then(images => {
    overview = images;
  }).catch(() => {
    overviewFailed = true;
  }).finally(scheduleRender);
  scheduleRender();
})();
