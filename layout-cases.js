(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const query = new URLSearchParams(location.search);
  const size = query.get('size') === '30' ? 30 : 2;
  const span = size * 1000;
  const {layouts, cases} = window.layoutCaseData[size];
  const picker = $('layout-picker');
  const fit = $('layout-fit');
  const map = $('layout-map');
  const mapCrop = $('layout-map-crop');
  const comparison = $('layout-comparison');
  const comparisonHint = $('layout-comparison-hint');
  const panels = [...comparison.querySelectorAll('[data-example-method]')];
  const baselinePicker = $('layout-baseline-picker');
  const viewButtons = [...document.querySelectorAll('[data-layout-view]')];
  const outline = $('layout-outline');
  const guide = $('layout-guide');
  const sraf = $('layout-sraf');
  const stacked = window.comparisonIsStacked;
  let layout = cases[0].layout;
  let active = null;
  let zoomed = false;
  let mode = 'print';

  $('layout-page-title').textContent = `${size} µm layout cases`;
  document.title = `${size} µm cases · CORD-OPC`;
  document.querySelector(`[data-layout-size="${size}"]`).setAttribute('aria-current', 'page');
  for (const [id, data] of Object.entries(layouts)) {
    picker.add(new Option(data.title, id));
  }

  const controls = cases.map(example => {
    const pin = document.createElement('button');
    pin.className = 'chip-pin';
    pin.type = 'button';
    if (size === 2) {
      pin.classList.add('layout-location-pin');
      pin.setAttribute('aria-label', `Inspect ${example.title}`);
    } else {
      pin.textContent = example.id;
      pin.setAttribute('aria-label', `Inspect case ${example.id}, ${example.title}`);
    }
    pin.addEventListener('click', () => choose(example));
    $('layout-map-pins').append(pin);
    return {example, pin};
  });

  function showLayout(id) {
    layout = id;
    picker.value = layout;
    $('layout-map-title').textContent = layouts[layout].title;
    map.querySelector('.layout-map-target').setAttribute('d', layouts[layout].target);
  }

  function cropFrame(example) {
    const [west, south, east, north] = example.bounds;
    return [west * 1000, (size - north) * 1000, (east - west) * 1000, (north - south) * 1000];
  }

  function renderMap() {
    let x = 0;
    let y = 0;
    let width = span;
    if (active) {
      const [west, north, w, h] = cropFrame(active);
      mapCrop.setAttribute('x', west);
      mapCrop.setAttribute('y', north);
      mapCrop.setAttribute('width', w);
      mapCrop.setAttribute('height', h);
      if (zoomed) {
        width = Math.min(span, 1.45 * Math.max(w, h));
        x = Math.min(span - width, Math.max(0, west + (w - width) / 2));
        y = Math.min(span - width, Math.max(0, north + (h - width) / 2));
      }
    }
    mapCrop.toggleAttribute('hidden', !active);
    map.setAttribute('viewBox', `${x} ${y} ${width} ${width}`);
    map.setAttribute('aria-label', `${layouts[layout].title} target ${zoomed ? 'zoomed to the selected crop' : 'overview'}`);
    fit.disabled = !zoomed;
    const bar = [5000, 2000, 1000, 500, 200, 100, 50].find(length => length <= width / 4);
    $('layout-scale-bar').style.width = `${100 * bar / width}cqw`;
    $('layout-scale-text').textContent = bar >= 1000 ? `${bar / 1000} µm` : `${bar} nm`;
    $('layout-map-extent').textContent = zoomed
      ? `${Number((span / width).toFixed(1))}× · selected region`
      : `${size} × ${size} µm`;
    const note = zoomed ? 'Dashed outline marks the three-panel comparison window.'
      : 'Target layout · Select a marker to zoom in.';
    $('layout-map-caption').textContent = note;
    for (const {example, pin} of controls) {
      const [px, py] = example.point;
      pin.hidden = zoomed || example.layout !== layout;
      pin.style.left = `${100 * px / size}%`;
      pin.style.top = `${100 * (size - py) / size}%`;
      if (example === active) pin.setAttribute('aria-current', 'true');
      else pin.removeAttribute('aria-current');
    }
  }

  function guidePath(example) {
    const [west, , , north] = example.bounds;
    const project = ([x, y]) => [(x - west) * 1000, (north - y) * 1000];
    if (mode === 'mask') {
      if (!example.maskFocus) return '';
      const [left, bottom, right, top] = example.maskFocus;
      const [x0, y0] = project([left, top]);
      const [x1, y1] = project([right, bottom]);
      return `M${x0} ${y0}H${x1}V${y1}H${x0}Z`;
    }
    if (!example.guide) return '';
    if (example.guide.circle) {
      const [cx, cy, radius] = example.guide.circle;
      const [x, y] = project([cx, cy]);
      const r = radius * 1000;
      return `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
    }
    const [[x0, y0], [x1, y1]] = example.guide.line.map(project);
    const length = Math.hypot(x1 - x0, y1 - y0);
    const side = y1 >= y0 ? 1 : -1;
    const dx = side * (y1 - y0) * 43 / length;
    const dy = side * (x0 - x1) * 43 / length;
    return `M${x0} ${y0}L${x0 + dx} ${y0 + dy}L${x1 + dx} ${y1 + dy}L${x1} ${y1}`;
  }

  function toggleLayers() {
    for (const panel of panels) {
      const targetOutline = panel.querySelector('.example-outline');
      if (targetOutline) targetOutline.toggleAttribute('hidden', !outline.checked);
      panel.querySelector('.layout-guide').toggleAttribute('hidden', !guide.checked);
      panel.querySelector('.layout-sraf')?.toggleAttribute('hidden', mode !== 'mask' || !sraf.checked);
      panel.querySelector('.layout-width-marker')?.toggleAttribute('hidden', mode !== 'mask' || !guide.checked);
    }
  }

  function renderComparison(example) {
    const [, , w, h] = cropFrame(example);
    const baseline = baselinePicker.value;
    const baselineMask = example.masks[baseline];
    const print = baseline === example.baseline ? {
      path: example.paths.baseline,
      outcome: example.outcomes.baseline,
      iou: example.iou.baseline,
      note: example.printNote,
    } : example.variants?.[baseline];
    const showMask = mode === 'mask';
    const mark = guidePath(example);
    $('layout-comparison-title').textContent = `Case ${example.id} · ${example.title}`;
    const [x, y] = example.point;
    $('layout-crop-meta').textContent = `${Math.round(w)} × ${Math.round(h)} nm · x ${x.toFixed(3)}, y ${y.toFixed(3)} µm`;
    $('layout-baseline').textContent = baseline;
    for (const button of viewButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.layoutView === mode));
    }
    $('layout-sraf-control').hidden = !showMask;
    $('layout-guide-control').hidden = !mark;
    let note = print?.note ?? '';
    if (showMask) {
      note = 'The solid shapes show the main mask. Violet polygons show sub-resolution assist features (SRAF).';
      if (example.maskFocus) {
        note = 'widthMarker' in example.masks[baseline]
          ? 'Orange marks the archived minimum-width violations for the 30 nm rule in the outline.'
          : `Archived width marker geometry is unavailable for ${baseline} in this case.`;
      }
    }
    const caption = $('layout-comparison-note');
    caption.textContent = note;
    caption.hidden = !note;
    const gain = print && example.iou.proteus - print.iou;
    const signedGain = print ? ` · ${gain >= 0 ? '+' : '−'}${Math.abs(gain).toFixed(1)} pp` : '';
    for (const panel of panels) {
      const method = panel.dataset.exampleMethod;
      const svg = panel.querySelector('svg');
      const name = method === 'baseline' ? baseline : panel.querySelector('h3').textContent;
      let path = example.paths[method];
      let outcome = example.outcomes[method];
      const missing = method === 'baseline' && (showMask ? !baselineMask : !print);
      let hasDefect = false;
      if (method === 'baseline') {
        path = print?.path ?? '';
        outcome = print?.outcome ?? 'No archived contour';
        if (showMask && missing) {
          path = '';
          outcome = 'No archived mask';
        }
      }
      if (method === 'target' && showMask) outcome = 'Design target';
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.toggleAttribute('data-missing', missing);
      svg.querySelector('.layout-guide').setAttribute('d', missing ? '' : mark);
      if (method !== 'target') {
        const mask = showMask ? example.masks[method === 'baseline' ? baseline : 'Ours'] : null;
        const iou = method === 'baseline' ? print?.iou : example.iou.proteus;
        svg.querySelector('.example-outline').setAttribute('d', missing ? '' : example.paths.target);
        svg.querySelector('.layout-sraf').setAttribute('d', mask?.sraf ?? '');
        svg.querySelector('.layout-width-marker').setAttribute('d', mask?.widthMarker ?? '');
        const footer = panel.querySelector('.crop-foot');
        if (mask) {
          footer.textContent = 'Main mask · layer 100';
          path = mask.main;
          outcome = 'Archived mask';
          hasDefect = Boolean(mask.widthMarker);
          if (example.maskFocus) {
            outcome = 'Width markers unavailable';
            if ('widthMarker' in mask) outcome = hasDefect ? 'Below 30 nm minimum' : 'No width violation in the box';
          }
        } else {
          const delta = method === 'proteus' ? signedGain : '';
          footer.textContent = missing ? (showMask ? 'Mask unavailable' : 'Crop IoU unavailable')
            : `Crop IoU ${iou.toFixed(1)}%${delta}`;
          hasDefect = method === 'baseline' && /bridged|break|unprinted|shortening|island/.test(outcome);
        }
      }
      svg.setAttribute('aria-label', `${name} · ${outcome}`);
      const label = panel.querySelector('.crop-outcome');
      label.textContent = outcome;
      label.classList.toggle('defect', hasDefect);
      svg.querySelector('.example-shape').setAttribute('d', path);
    }
    toggleLayers();
    comparison.hidden = false;
  }

  function choose(example, {fromUrl = false, overview = false} = {}) {
    active = example;
    zoomed = !overview;
    mode = example.initialView ?? 'print';
    const methods = [...new Set([example.baseline, ...Object.keys(example.masks), ...Object.keys(example.variants ?? {})])]
      .filter(name => name !== 'Ours');
    baselinePicker.replaceChildren(...methods.map(name => new Option(name, name)));
    if (fromUrl && methods.includes(query.get('baseline'))) baselinePicker.value = query.get('baseline');
    if (fromUrl && ['mask', 'print'].includes(query.get('view'))) mode = query.get('view');
    $('layout-baseline-control').hidden = methods.length < 2;
    if (layout !== example.layout) showLayout(example.layout);
    renderMap();
    renderComparison(example);
    comparisonHint.hidden = true;
    if (!overview) {
      if (!fromUrl || stacked()) comparison.focus({preventScroll: true});
      if (stacked()) window.revealComparisonTarget(comparison);
    }
  }

  picker.addEventListener('change', () => {
    const example = cases.find(example => example.layout === picker.value);
    if (example) {
      choose(example, {overview: true});
      return;
    }
    active = null;
    zoomed = false;
    comparison.hidden = true;
    comparisonHint.hidden = false;
    showLayout(picker.value);
    renderMap();
  });
  fit.addEventListener('click', () => {
    zoomed = false;
    renderMap();
  });
  outline.addEventListener('change', toggleLayers);
  guide.addEventListener('change', toggleLayers);
  sraf.addEventListener('change', toggleLayers);
  baselinePicker.addEventListener('change', () => renderComparison(active));
  for (const button of viewButtons) {
    button.addEventListener('click', () => {
      mode = button.dataset.layoutView;
      renderComparison(active);
    });
  }
  showLayout(layout);
  const featured = cases.find(example => example.id === (query.get('case') ?? query.get('preview-case') ?? (size === 2 ? '3' : '2')));
  if (featured) choose(featured, {fromUrl: true, overview: query.has('preview-case') && !query.has('case')});
  else renderMap();
})();
