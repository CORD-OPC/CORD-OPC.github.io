(() => {
  'use strict';
  const {frames, target_um: target, roi_um: bounds} = window.rolloutData;
  const [left, bottom, right, top] = bounds;
  const figure = document.getElementById('hero-film');
  const control = document.getElementById('hero-motion');
  const curve = document.getElementById('hero-mask-curve');
  const resist = document.getElementById('hero-resist-contours');
  const resistCurrent = document.getElementById('hero-resist-current');
  const resistNext = document.getElementById('hero-resist-next');
  const anchors = document.getElementById('hero-anchor-points');
  const counter = document.getElementById('hero-iteration');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const last = frames.length - 1;
  const duration = 7200;
  const hold = 1500;
  const resetDuration = 350;
  const cycle = duration + hold + resetDuration;
  let elapsed = reducedMotion.matches ? duration : 0;
  let paused = reducedMotion.matches;
  let inView = false;
  let request = 0;
  let previousTime = null;
  let displayedIteration = -1;

  const point = ([x, y]) => [((x - left) * 1000).toFixed(2), ((top - y) * 1000).toFixed(2)].join(',');
  const resistPaths = frames.map(frame => frame.resist_um.filter(vertices => {
    const xs = vertices.map(p => p[0]);
    const ys = vertices.map(p => p[1]);
    return Math.max(...xs) >= left && Math.min(...xs) <= right &&
      Math.max(...ys) >= bottom && Math.min(...ys) <= top;
  }).map(vertices => 'M' + vertices.map(point).join('L') + 'Z').join(''));
  const inside = ([x, y]) => x >= left && x <= right && y >= bottom && y <= top;
  const segments = frames[0].cubics_um.flatMap((_, index) => {
    const intersects = frames.some(frame => {
      const controls = frame.cubics_um[index];
      const xs = controls.map(p => p[0]);
      const ys = controls.map(p => p[1]);
      return Math.max(...xs) >= left && Math.min(...xs) <= right &&
        Math.max(...ys) >= bottom && Math.min(...ys) <= top;
    });
    return intersects ? [index] : [];
  });
  const anchorIds = segments.filter(index => frames.some(frame => inside(frame.ap_um[index])));
  const markers = anchorIds.map(() => {
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    marker.setAttribute('r', '2.3');
    anchors.append(marker);
    return marker;
  });

  function blend(first, second, progress) {
    return first.map((value, axis) => value + (second[axis] - value) * progress);
  }

  function render() {
    const phase = elapsed % cycle;
    const progress = Math.min(1, phase / duration) * last;
    const index = Math.floor(progress);
    const first = frames[index];
    const second = frames[Math.min(last, index + 1)];
    const fraction = progress - index;
    resistCurrent.style.opacity = 1 - fraction;
    resistNext.style.opacity = fraction;
    curve.setAttribute('d', segments.map(id => {
      const controls = first.cubics_um[id].map((p, n) => point(blend(p, second.cubics_um[id][n], fraction)));
      return 'M' + controls[0] + 'C' + controls.slice(1).join(' ');
    }).join(''));
    anchorIds.forEach((id, n) => {
      const [x, y] = blend(first.ap_um[id], second.ap_um[id], fraction);
      markers[n].setAttribute('cx', ((x - left) * 1000).toFixed(2));
      markers[n].setAttribute('cy', ((top - y) * 1000).toFixed(2));
    });
    const opacity = phase > duration + hold ? 1 - (phase - duration - hold) / resetDuration
      : Math.min(1, phase / resetDuration);
    curve.style.opacity = opacity;
    anchors.style.opacity = opacity;
    resist.style.opacity = opacity;
    if (displayedIteration !== index) {
      displayedIteration = index;
      resistCurrent.setAttribute('d', resistPaths[index]);
      resistNext.setAttribute('d', resistPaths[Math.min(last, index + 1)]);
      counter.textContent = `Iteration ${String(index).padStart(2, '0')} / ${last}`;
    }
  }

  function animate(time) {
    if (previousTime !== null) elapsed += time - previousTime;
    previousTime = time;
    render();
    request = requestAnimationFrame(animate);
  }

  function syncPlayback() {
    cancelAnimationFrame(request);
    previousTime = null;
    control.textContent = paused ? 'Play loop' : 'Pause loop';
    if (inView && !paused && !document.hidden) request = requestAnimationFrame(animate);
  }

  document.getElementById('hero-target-outline').setAttribute('d',
    target.map(vertices => 'M' + vertices.map(point).join('L') + 'Z').join(''));
  render();
  control.hidden = false;
  control.addEventListener('click', () => {
    paused = !paused;
    syncPlayback();
  });
  reducedMotion.addEventListener('change', () => {
    paused = reducedMotion.matches;
    if (paused) elapsed = duration;
    render();
    syncPlayback();
  });
  document.addEventListener('visibilitychange', syncPlayback);
  new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    syncPlayback();
  }, {threshold: .18}).observe(figure);
})();
