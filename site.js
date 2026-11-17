(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const setPressed = (element, active) => element.setAttribute('aria-pressed', String(active));
  const benchmark = window.benchmarkData;

  function openLegacyComparison() {
    if (location.hash !== '#chip') return false;
    location.replace('fullchip.html');
    return true;
  }

  if (openLegacyComparison()) return;
  window.addEventListener('hashchange', openLegacyComparison);

  const comparisonRoute = /^layouts-(2|30|150)(?:-case-\d+)?$/;

  function initSectionNavigation() {
    const sections = new Map([...document.querySelectorAll('[data-site-section]')]
      .map(section => [section.dataset.siteSection, section]));
    const header = document.querySelector('.topbar');
    const links = [...document.querySelectorAll('.topbar nav a')];
    const resultViews = ['results-overall', 'results-matched', 'results-process', 'process-band'];
    let scrollUpdate = 0;

    function sectionFromAddress() {
      const hash = location.hash.slice(1) || 'home';
      if (resultViews.includes(hash)) return 'benchmarks';
      if (comparisonRoute.test(hash)) return 'layouts';
      return hash;
    }

    function updateCurrentLink() {
      scrollUpdate = 0;
      const cutoff = header.getBoundingClientRect().bottom + Math.min(145, innerHeight * .21);
      let active = 'home';
      for (const [id, section] of sections) {
        if (section.getBoundingClientRect().top <= cutoff) active = id;
      }
      if (scrollY + innerHeight >= document.documentElement.scrollHeight - 2) active = 'benchmarks';
      for (const link of links) {
        if (link.hash === `#${active}`) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      }
    }

    function scheduleCurrentLink() {
      if (!scrollUpdate) scrollUpdate = requestAnimationFrame(updateCurrentLink);
    }

    function scrollToAddress() {
      const id = sectionFromAddress();
      const section = sections.get(id);
      if (!section) return;
      const top = id === 'home' ? 0 : section.getBoundingClientRect().top + scrollY - header.offsetHeight;
      window.scrollTo({top, behavior: 'instant'});
      scheduleCurrentLink();
    }

    document.addEventListener('click', event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest('a[href^="#"]');
      if (!link) return;
      const hash = link.hash.slice(1);
      if (!sections.has(hash) && !comparisonRoute.test(hash)) return;
      event.preventDefault();
      if (location.hash !== link.hash) history.pushState(null, '', link.hash);
      window.dispatchEvent(new Event('hashchange'));
      if (!link.closest('.topbar nav')) {
        const active = sectionFromAddress();
        const title = sections.get(active).querySelector('h1, h2');
        title.tabIndex = -1;
        title.focus({preventScroll: true});
      }
    });
    window.addEventListener('scroll', scheduleCurrentLink, {passive: true});
    window.addEventListener('hashchange', scrollToAddress);
    new ResizeObserver(() => {
      document.documentElement.style.setProperty('--page-header-offset', `${header.offsetHeight + 12}px`);
      scheduleCurrentLink();
    }).observe(header);
    if (location.hash) scrollToAddress();
    else updateCurrentLink();
  }

  function initHighlights() {
    const ours = benchmark.find(method => method.name === 'CORD-OPC');
    const academic = benchmark.filter(method => method !== ours && method.name !== 'C.T. (Ref.)');
    const sizes = [2, 30, 150];
    const metrics = [
      {list: $('highlight-epe-values'), column: 1, higher: false},
      {list: $('highlight-time-values'), column: 3, higher: false},
      {list: $('highlight-iou-values'), column: 0, higher: true},
    ];
    const seconds = new Intl.NumberFormat('en-US', {minimumFractionDigits: 3, maximumFractionDigits: 3});
    for (const metric of metrics) {
      const direction = metric.higher ? -1 : 1;
      const format = value => {
        if (metric.column === 0) return (Number(value) * 100).toFixed(2) + '%';
        if (metric.column === 3) return seconds.format(Number(value)) + ' s';
        return value + ' nm';
      };
      metric.list.replaceChildren(...sizes.map((size, index) => {
        const baseline = [...academic].sort((a, b) =>
          direction * (Number(a.values[index][metric.column]) - Number(b.values[index][metric.column])))[0];
        const value = ours.values[index][metric.column];
        const rank = 1 + academic.filter(method =>
          direction * (Number(method.values[index][metric.column]) - Number(value)) < 0).length;
        const row = document.createElement('div');
        const label = document.createElement('dt');
        label.textContent = `${size} µm`;
        const reading = document.createElement('dd');
        const amount = document.createElement('span');
        amount.className = 'highlight-value';
        amount.textContent = format(value) + (metric.column === 3 && size === 30 ? '*' : '');
        const place = document.createElement('span');
        place.className = 'highlight-rank';
        place.textContent = `#${rank}`;
        place.setAttribute('aria-label', `Rank ${rank} among CORD-OPC and ${academic.length} academic baselines`);
        const comparator = document.createElement('span');
        comparator.className = 'highlight-comparator';
        comparator.textContent = `${baseline.name} ${format(baseline.values[index][metric.column])}`;
        reading.append(amount, place, comparator);
        row.append(label, reading);
        return row;
      }));
    }
    $('highlight-baseline-list').textContent = new Intl.ListFormat('en-US', {style: 'long', type: 'conjunction'})
      .format(academic.map(method => method.name));
    for (const label of document.querySelectorAll('[data-academic-count]')) label.textContent = academic.length;
  }

  function initBenchmarks() {
    const metricControls = [...document.querySelectorAll('[data-bench-metric]')];
    const chart = $('benchmark-chart');
    const sizes = [2, 30, 150];
    const counts = ['1,000-clip test set', '10 layouts', '1 full-chip layout'];
    const labels = ['mIoU', 'Mean EPE', 'PVB', 'TAT'];
    const units = ['%', 'nm', 'µm²', 's'];
    const format = n => {
      const [integer, fraction] = n.split('.');
      const display = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return fraction === undefined ? display : `${display}.${fraction}`;
    };
    const order = ['CORD-OPC', 'DROPC', 'CardOPC', 'MultiILT', 'FuILT', 'DiffOPC', 'Refragmentation'];
    const rankedMethods = order.map(name => benchmark.find(method => method.name === name));
    const reference = benchmark.find(method => method.name === 'C.T. (Ref.)');
    const methods = [...rankedMethods, reference];
    let activeMetric = 1;

    function ranked(index) {
      const direction = activeMetric === 0 ? -1 : 1;
      const sorted = [...rankedMethods].sort((a, b) =>
        direction * (Number(a.values[index][activeMetric]) - Number(b.values[index][activeMetric])));
      return [...sorted, reference];
    }

    function axisFor(index, metric) {
      const panel = metric === 1 ? methods.flatMap(method => method.values) : methods.map(method => method.values[index]);
      const values = panel.map(values => Number(values[metric]));
      const maximum = Math.max(...values);
      if (metric === 3) {
        const first = Math.floor(Math.log10(Math.min(...values)));
        const last = Math.max(first + 1, Math.ceil(Math.log10(maximum)));
        return {
          ticks: Array.from({length: last - first + 1}, (_, i) => 10 ** (first + i)),
          share: value => (Math.log10(value) - first) / (last - first),
        };
      }
      const magnitude = 10 ** Math.floor(Math.log10(maximum));
      const end = metric === 0 ? 100 : Math.ceil(maximum / magnitude) * magnitude;
      return {ticks: [0, end / 2, end], share: value => value / end};
    }

    function renderPanel(size, index) {
      const metric = activeMetric;
      const axis = axisFor(index, metric);
      const panel = document.createElement('section');
      panel.className = 'bench-panel';
      panel.setAttribute('aria-label', `${size} µm benchmark · ${labels[metric]}`);
      const header = document.createElement('header');
      const title = document.createElement('h3');
      title.textContent = `${size} µm`;
      const count = document.createElement('span');
      count.textContent = counts[index];
      header.append(title, count);
      panel.append(header);

      for (const {name, values} of ranked(index)) {
        const raw = values[index][metric];
        const value = Number(raw) * (metric === 0 ? 100 : 1);
        const row = document.createElement('div');
        row.className = `benchbar${name === 'CORD-OPC' ? ' ours' : name === 'C.T. (Ref.)' ? ' reference' : ''}`;
        const label = document.createElement('span');
        label.textContent = name;
        const amount = document.createElement('span');
        amount.className = 'benchbar-value';
        amount.textContent = `${metric === 0 ? value.toFixed(2) : format(raw)} ${units[metric]}`;
        if (metric === 3 && index === 1 && name === 'CORD-OPC') amount.append(' *');
        const track = document.createElement('span');
        track.className = 'benchbar-track';
        track.setAttribute('aria-hidden', 'true');
        const bar = document.createElement('span');
        bar.className = 'benchbar-fill';
        bar.style.setProperty('--share', `${100 * axis.share(value)}%`);
        track.append(bar);
        row.append(label, amount, track);
        panel.append(row);
      }
      const ticks = document.createElement('div');
      ticks.className = 'benchbar-axis';
      ticks.setAttribute('aria-hidden', 'true');
      for (const value of axis.ticks) {
        const tick = document.createElement('span');
        tick.textContent = format(String(Number(value.toPrecision(6))));
        ticks.append(tick);
      }
      panel.append(ticks);
      return panel;
    }

    function renderChart() {
      const direction = ['Higher is better', 'Lower is better', 'Lower is better', 'Lower is better'];
      const scales = ['Shared linear scale', 'Shared linear scale', 'Linear scales by size', 'Log scales by size'];
      chart.replaceChildren(...sizes.map(renderPanel));
      $('bench-direction').textContent = `${direction[activeMetric]} · ${scales[activeMetric]}`;
      metricControls.forEach(button => setPressed(button, Number(button.dataset.benchMetric) === activeMetric));
    }

    metricControls.forEach(button => button.addEventListener('click', () => {
      activeMetric = Number(button.dataset.benchMetric);
      renderChart();
    }));
    renderChart();
  }

  initSectionNavigation();
  initHighlights();
  initBenchmarks();
})();
