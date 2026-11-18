(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const {width, height, j, i, direction, background, frames, probeRadius, probeLimit} = window.methodIntensitySweep;
  const panel = $('method-optics');
  const field = $('method-optical-field');
  const source = $('coupling-source-point');
  const range = $('coupling-shift');
  const reset = $('coupling-reset');
  const probe = $('coupling-probe-image');
  const deltaImage = $('coupling-delta-image');
  const baseline = frames.find(frame => frame.shift === 0);
  const minimum = frames[0].shift;
  const maximum = frames.at(-1).shift;
  const step = frames[1].shift - minimum;
  let frame = baseline;
  let drag;

  function pngImage(data) {
    return 'data:image/png;base64,' + data;
  }

  function sourcePosition(shift) {
    return j.map((coordinate, axis) => coordinate + shift * direction[axis]);
  }

  function signed(value, digits) {
    const magnitude = Math.abs(value).toFixed(digits);
    if (Number(magnitude) === 0) return magnitude;
    return (value > 0 ? '+' : '−') + magnitude;
  }

  function show(shift) {
    const snapped = Math.min(maximum, Math.max(minimum, shift));
    frame = frames[Math.round((snapped - minimum) / step)];
    const delta = frame.intensity - baseline.intensity;
    const response = delta > 0 ? 'brighter' : delta < 0 ? 'darker' : 'baseline';
    panel.dataset.response = response;
    $('coupling-status').textContent = {brighter: 'Brighter', darker: 'Darker', baseline: 'At baseline'}[response];
    $('coupling-current').textContent = `${frame.intensity.toFixed(5)} a.u.`;
    $('coupling-value').value = `${signed(delta, 5)} a.u.`;
    $('coupling-percent').textContent = `${signed(100 * delta / baseline.intensity, 2)}%`;
    $('coupling-displacement').textContent = `${signed(frame.shift, 1)} nm`;
    $('coupling-mask').setAttribute('d', frame.mask);
    $('coupling-arc').setAttribute('d', frame.arc);
    const deltaMap = pngImage(frame.probeImage);
    probe.setAttribute('href', deltaMap);
    deltaImage.src = deltaMap;
    source.setAttribute('transform', `translate(${sourcePosition(frame.shift).join(' ')})`);
    range.value = frame.shift;
    range.setAttribute('aria-valuetext', `${frame.shift} nanometers, light ${response === 'baseline' ? 'at baseline' : response} at i`);
    reset.disabled = frame.shift === 0;
  }

  function projectedPointer(event) {
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(field.getScreenCTM().inverse());
    return (point.x - j[0]) * direction[0] + (point.y - j[1]) * direction[1];
  }

  field.setAttribute('viewBox', `0 0 ${width} ${height}`);
  $('coupling-background').setAttribute('d', background);
  $('coupling-arc-initial').setAttribute('d', baseline.arc);
  $('coupling-receiver-point').setAttribute('transform', `translate(${i.join(' ')})`);
  for (const id of ['coupling-probe-clip-ring', 'coupling-probe-border']) {
    $(id).setAttribute('r', probeRadius);
  }
  const probeSize = 2 * probeRadius + 1;
  const probeStart = -probeSize / 2;
  for (const [name, value] of Object.entries({x: probeStart, y: probeStart, width: probeSize, height: probeSize})) {
    probe.setAttribute(name, value);
  }
  $('coupling-probe-label').setAttribute('x', probeRadius + 5);
  $('coupling-delta-min').textContent = signed(-probeLimit, 3);
  $('coupling-delta-max').textContent = signed(probeLimit, 3);
  $('coupling-source-origin').setAttribute('cx', j[0]);
  $('coupling-source-origin').setAttribute('cy', j[1]);
  const guide = $('coupling-guide');
  const [x1, y1] = sourcePosition(minimum - 4);
  const [x2, y2] = sourcePosition(maximum + 4);
  for (const [name, value] of Object.entries({x1, y1, x2, y2})) guide.setAttribute(name, value);
  source.querySelector('.coupling-source-arrows').setAttribute('transform',
    `rotate(${Math.atan2(direction[1], direction[0]) * 180 / Math.PI - 90})`);
  $('coupling-before').textContent = `${baseline.intensity.toFixed(5)} a.u.`;
  range.min = minimum;
  range.max = maximum;
  range.step = step;
  range.addEventListener('input', () => show(range.valueAsNumber));
  reset.addEventListener('click', () => {
    show(0);
    range.focus();
  });
  source.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    drag = {id: event.pointerId, offset: projectedPointer(event) - frame.shift};
    source.setPointerCapture(event.pointerId);
    source.setAttribute('data-dragging', '');
  });
  source.addEventListener('pointermove', event => {
    if (drag?.id === event.pointerId) show(projectedPointer(event) - drag.offset);
  });
  source.addEventListener('lostpointercapture', () => {
    drag = undefined;
    source.removeAttribute('data-dragging');
  });
  show(range.valueAsNumber);
})();
