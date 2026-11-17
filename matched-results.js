(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const dataset = window.pairedResults;
  const canvas = $('paired-plot');
  const ctx = canvas.getContext('2d');
  const baseline = $('paired-baseline');
  const sizes = [...document.querySelectorAll('[data-result-size]')];
  const metrics = [...document.querySelectorAll('[data-result-metric]')];
  const formatCount = value => value.toLocaleString('en-US');
  const specs = [
    {label: 'IoU', unit: '%', change: 'pp', digits: 2, better: 1, axis: 'IoU gain'},
    {label: 'Mean |EPE|', unit: 'nm', change: 'nm', digits: 2, better: -1, axis: 'EPE reduction'},
    {label: 'PVB', unit: 'µm²', change: 'µm²', digits: 3, better: -1, axis: 'PVB reduction'},
  ];
  let size = '2';
  let metric = 1;
  let rows = [];
  let plotted = [];
  let hovered = null;
  let pinned = null;

  dataset.methods.forEach(method => baseline.add(new Option(method, method)));

  function caseName(id) {
    const row = /__row_(\d+)__col_(\d+)/.exec(id);
    if (row) return `Row ${Number(row[1])} · Col ${Number(row[2])}`;
    return `${id.split('__')[0].toUpperCase()} · ${id.split('_').at(-1)}`;
  }

  function number(value, spec) {
    return `${value.toFixed(spec.digits)}${spec.unit === '%' ? '' : ' '}${spec.unit}`;
  }

  function formatGain(value, spec) {
    const sign = value > 0 ? '+' : value < 0 ? '−' : '';
    return `${sign}${Math.abs(value).toFixed(spec.digits)} ${spec.change}`;
  }

  function updateControls() {
    sizes.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.resultSize === size)));
    metrics.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.resultMetric) === metric)));
    const {cases, results} = dataset.datasets[size];
    const spec = specs[metric];
    rows = cases.flatMap((id, index) => {
      const other = results[baseline.value][index];
      const ours = results['CORD-OPC'][index];
      return other ? [{id, other, ours, gain: spec.better * (ours[metric] - other[metric])}] : [];
    }).sort((a, b) => b.gain - a.gain);
    const middle = (rows.length - 1) / 2;
    $('paired-count').textContent = formatCount(rows.length);
    $('paired-wins').textContent = formatCount(rows.filter(row => row.gain > 0).length);
    $('paired-median-name').textContent = `Median ${spec.axis}`;
    $('paired-median').textContent = rows.length
      ? formatGain((rows[Math.floor(middle)].gain + rows[Math.ceil(middle)].gain) / 2, spec)
      : '—';
    const missing = cases.length - rows.length;
    const coverage = $('paired-coverage');
    coverage.hidden = !missing;
    coverage.textContent = `${missing} of ${formatCount(cases.length)} layouts lack a complete archived pair.`;
    $('paired-detail-baseline').textContent = baseline.value;
  }

  function renderReading() {
    const row = hovered || pinned;
    $('paired-case-title').textContent = row ? caseName(row.id) : 'Case readings';
    $('paired-pinned').hidden = !row || row !== pinned;
    $('paired-details').hidden = !row;
    $('paired-empty').hidden = Boolean(row);
    if (!row) return;
    const spec = specs[metric];
    $('paired-case-difference').textContent = `${spec.axis} · ${formatGain(row.gain, spec)}`;
    $('paired-case-id').textContent = row.id;
    const body = $('paired-values');
    body.replaceChildren();
    const reports = [row.other, row.ours];
    const readings = specs.map((spec, index) =>
      [spec.label, ...reports.map(values => number(values[index], spec))]);
    readings.push(['Valid EPE sites', ...reports.map(([, , , valid, total]) =>
      valid === null || total === null ? '—' : `${formatCount(valid)} / ${formatCount(total)}`)]);
    for (const [label, ...values] of readings) {
      const line = document.createElement('tr');
      const name = document.createElement('th');
      name.scope = 'row';
      name.textContent = label;
      line.append(name);
      for (const reading of values) {
        const value = document.createElement('td');
        value.textContent = reading;
        line.append(value);
      }
      body.append(line);
    }
  }

  function plotBounds() {
    const low = Math.min(0, rows.at(-1).gain);
    const high = Math.max(0, rows[0].gain);
    const estimate = (high - low || 1) / 5;
    const magnitude = 10 ** Math.floor(Math.log10(estimate));
    const step = [1, 2, 2.5, 5, 10].find(value => value * magnitude >= estimate) * magnitude;
    const start = Math.floor(low / step) * step;
    const end = Math.max(start + step, Math.ceil(high / step) * step);
    return {start, end, step};
  }

  function renderPlot() {
    const {width, height} = canvas.getBoundingClientRect();
    if (!width || !height) return;
    const scale = devicePixelRatio;
    const pixels = [Math.round(width * scale), Math.round(height * scale)];
    if (canvas.width !== pixels[0]) canvas.width = pixels[0];
    if (canvas.height !== pixels[1]) canvas.height = pixels[1];
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, width, height);
    plotted = [];
    if (!rows.length) return;
    const {start, end, step} = plotBounds();
    const left = 66;
    const top = 14;
    const right = width - 20;
    const bottom = height - 49;
    const x = index => rows.length === 1 ? (left + right) / 2 : left + index * (right - left) / (rows.length - 1);
    const y = value => bottom - (value - start) * (bottom - top) / (end - start);
    const zero = y(0);
    const spec = specs[metric];

    ctx.fillStyle = '#eaf6f3';
    ctx.fillRect(left, top, right - left, zero - top);
    ctx.fillStyle = '#fcf2eb';
    ctx.fillRect(left, zero, right - left, bottom - zero);
    ctx.strokeStyle = '#d8e4ec';
    ctx.fillStyle = '#405d72';
    ctx.lineWidth = 1;
    ctx.font = '11px Consolas, monospace';
    ctx.textAlign = 'right';
    const digits = Number.isInteger(step) ? 0 : Math.max(1, 2 - Math.ceil(Math.log10(step)));
    for (let i = 0; i <= Math.round((end - start) / step); i++) {
      const value = start + i * step;
      const label = Math.abs(value) < step / 100 ? '0' : (value > 0 ? '+' : '−') + Math.abs(value).toFixed(digits);
      ctx.beginPath();
      ctx.moveTo(left, y(value));
      ctx.lineTo(right, y(value));
      ctx.stroke();
      ctx.fillText(label, left - 7, y(value) + 4);
    }
    ctx.strokeRect(left, top, right - left, bottom - top);
    ctx.strokeStyle = '#587188';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(left, zero);
    ctx.lineTo(right, zero);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.textAlign = 'center';
    for (const index of new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])) {
      ctx.fillText(formatCount(index + 1), x(index), bottom + 16);
    }
    ctx.fillStyle = '#17384f';
    ctx.font = '12px "Segoe UI", sans-serif';
    ctx.fillText('Matched layouts in improvement order', (left + right) / 2, bottom + 36);
    ctx.save();
    ctx.translate(14, (top + bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`${spec.axis} (${spec.change})`, 0, 0);
    ctx.restore();

    plotted = rows.map((row, index) => ({row, x: x(index), y: y(row.gain)}));
    const radius = rows.length > 80 ? 2 : 4.5;
    for (const point of plotted) {
      ctx.fillStyle = point.row.gain > 0 ? '#18786b' : point.row.gain < 0 ? '#a65326' : '#587188';
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const point of plotted.filter(point => point.row === pinned || point.row === hovered)) {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#0b3f75';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius + 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  function render() {
    renderPlot();
    renderReading();
  }

  function reset() {
    hovered = pinned = null;
    updateControls();
    render();
  }

  function nearest(event) {
    const bounds = canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    let nearest = null;
    let best = 12 ** 2;
    for (const point of plotted) {
      const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
      if (distance < best) {
        nearest = point.row;
        best = distance;
      }
    }
    return nearest;
  }

  sizes.forEach(button => button.addEventListener('click', () => {
    size = button.dataset.resultSize;
    reset();
  }));
  metrics.forEach(button => button.addEventListener('click', () => {
    metric = Number(button.dataset.resultMetric);
    reset();
  }));
  baseline.addEventListener('change', reset);
  canvas.addEventListener('pointermove', event => {
    const next = nearest(event);
    if (next !== hovered) {
      hovered = next;
      render();
    }
  });
  canvas.addEventListener('pointerleave', () => {
    hovered = null;
    render();
  });
  canvas.addEventListener('click', event => {
    pinned = nearest(event);
    render();
    if (pinned && matchMedia('(max-width: 780px)').matches) {
      $('paired-reading').scrollIntoView({block: 'nearest', behavior: 'instant'});
    }
  });
  canvas.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const index = rows.indexOf(pinned || hovered);
    hovered = null;
    pinned = rows[Math.max(0, Math.min(rows.length - 1, index + direction))];
    render();
  });
  new ResizeObserver(renderPlot).observe(canvas);

  window.initProcessExample = process => {
    const panels = [...document.querySelectorAll('[data-process-method]')];
    const baselinePicker = $('process-baseline');
    const names = Object.keys(process.methods).filter(name => name !== 'CORD-OPC');
    for (const name of names) baselinePicker.add(new Option(name, name));
    const views = [...document.querySelectorAll('[data-process-view]')];
    const nominalFocus = process.focusNm.indexOf(0);
    const nominalDose = process.dose.indexOf(1);
    let focusIndex = nominalFocus;
    let doseIndex = nominalDose;
    let mode = 'print';
    const focusText = value => `${value > 0 ? '+' : ''}${value} nm`;
    const doseText = value => `${value.toFixed(2)}×`;
    const selectors = [
      {id: 'process-focus', values: process.focusNm, format: focusText, select: index => { focusIndex = index; }},
      {id: 'process-dose', values: process.dose, format: doseText, select: index => { doseIndex = index; }},
    ];
    for (const {id, values, format, select} of selectors) {
      values.forEach((value, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = format(value);
        button.addEventListener('click', () => { select(index); renderCondition(); });
        $(id).append(button);
      });
    }
    for (const panel of panels) {
      panel.querySelector('svg').setAttribute('viewBox', `0 0 ${process.viewNm} ${process.viewNm}`);
      panel.querySelector('.process-target').setAttribute('d', process.target);
    }
    baselinePicker.addEventListener('change', renderCondition);
    for (const view of views) {
      view.addEventListener('click', () => { mode = view.dataset.processView; renderCondition(); });
    }

    function renderCondition() {
      const showBand = mode === 'band';
      const available = [baselinePicker.value, 'CORD-OPC'].every(name => process.methods[name].corners?.length === 9);
      if (!available) {
        focusIndex = nominalFocus;
        doseIndex = nominalDose;
      }
      const nominal = focusIndex === nominalFocus && doseIndex === nominalDose;
      $('process-condition-controls').hidden = showBand || !available;
      $('process-change-key').hidden = showBand || nominal || !available;
      views.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.processView === mode)));
      for (const [id, selected] of [['process-focus', focusIndex], ['process-dose', doseIndex]]) {
        [...$(id).children].forEach((button, index) => button.setAttribute('aria-pressed', String(index === selected)));
      }
      const condition = `Focus ${focusText(process.focusNm[focusIndex])} · Dose ${doseText(process.dose[doseIndex])}`;
      const reading = showBand ? 'All 9 conditions · 3 focus levels × 3 doses' : (nominal ? `${condition} · nominal` : condition);
      $('process-conditions').textContent = reading;
      for (const panel of panels) {
        const name = panel.dataset.processMethod === 'baseline' ? baselinePicker.value : panel.dataset.processMethod;
        const {metrics: values, resist, band, corners} = process.methods[name];
        const corner = corners?.[focusIndex * process.dose.length + doseIndex];
        panel.querySelector('figcaption strong').textContent = name;
        panel.querySelector('svg').setAttribute('aria-label', `${name} · ${reading}`);
        const layers = [
          ['band', band, showBand],
          ['resist', corner?.resist ?? resist, !showBand],
          ['lost', corner?.lost ?? '', !showBand],
          ['gained', corner?.gained ?? '', !showBand],
        ];
        for (const [layer, path, visible] of layers) {
          const element = panel.querySelector(`.process-${layer}`);
          element.setAttribute('d', path);
          element.toggleAttribute('hidden', !visible);
        }
        let metricText;
        if (showBand) metricText = `PV-band area ${number(values[2], specs[2])}`;
        else if (!corner) metricText = `Nominal IoU ${number(values[0], specs[0])}`;
        else {
          metricText = `Window IoU ${number(corner.iou, specs[0])}`;
          if (!nominal) metricText += ` · ${formatCount(Math.round(corner.changeNm2))} nm² changed`;
        }
        panel.querySelector('figcaption span').textContent = metricText;
      }
    }

    renderCondition();
    $('process-note').textContent = `${caseName(process.case)} · All methods share the same target and optical settings. Window IoU and coverage changes use the displayed window with a 25 nm margin. PV-band areas use the archived measurements.`;
  };
  reset();
})();
