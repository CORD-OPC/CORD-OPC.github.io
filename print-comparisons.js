(() => {
  'use strict';
  const workspace = document.getElementById('layouts');
  const tablist = workspace.querySelector('[role="tablist"]');
  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
  const defaultCases = {'2': '3', '30': '2', '150': '4'};
  const frames = new Map();
  let active = 'overview';

  function mount(size, featured) {
    const panel = document.getElementById(`comparison-${size}`);
    const frame = document.createElement('iframe');
    frame.className = 'comparison-frame';
    frame.title = `${size} µm resist comparison viewer`;
    const status = document.createElement('p');
    status.className = 'comparison-loading';
    status.setAttribute('role', 'status');
    status.textContent = `Loading the ${size} µm viewer…`;
    const url = new URL(size === '150' ? 'fullchip.html' : 'layout-cases.html', location.href);
    url.searchParams.set('v', 'representative-cases');
    if (size !== '150') url.searchParams.set('size', size);
    url.searchParams.set('case', featured ?? defaultCases[size]);
    url.searchParams.set('embed', '1');
    frame.src = url.href;
    const entry = {frame, status, height: 0, reveal: null};
    frames.set(size, entry);
    panel.replaceChildren(status, frame);
  }

  function show(view, featured) {
    active = view;
    for (const tab of tabs) {
      const selected = tab.id === `comparison-tab-${view}`;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
    }
    if (view !== 'overview' && (!frames.has(view) || featured)) mount(view, featured);
  }

  let address = null;
  function showFromAddress() {
    const hash = location.hash;
    if (hash === address) return;
    address = hash;
    if (hash === '#layouts') {
      show('overview');
      return;
    }
    const match = /^#layouts-(2|30|150)(?:-case-(\d+))?$/.exec(hash);
    if (!match) return;
    show(match[1], match[2]);
  }

  function select(tab) {
    const id = tab.id.slice('comparison-tab-'.length);
    const hash = id === 'overview' ? '#layouts' : `#layouts-${id}`;
    if (location.hash === hash) return;
    history.pushState(null, '', hash);
    window.dispatchEvent(new Event('hashchange'));
  }

  function reveal(entry) {
    if (workspace.hidden || frames.get(active) !== entry || entry.reveal === null || entry.height < entry.reveal) return;
    const headerHeight = document.querySelector('.topbar').getBoundingClientRect().height;
    const top = entry.frame.getBoundingClientRect().top + window.scrollY + entry.reveal - headerHeight - 12;
    window.scrollTo({top: Math.max(0, top), behavior: 'instant'});
    entry.reveal = null;
  }

  window.addEventListener('message', event => {
    const localFileMessage = location.protocol === 'file:' && event.origin === 'null';
    if (!localFileMessage && event.origin !== location.origin) return;
    const entry = [...frames.values()].find(item => item.frame.contentWindow === event.source);
    if (!entry || !event.data) return;
    const {type, value} = event.data;
    if (!Number.isFinite(value) || value < 0 || value > 12000) return;
    if (type === 'cord-comparison-height' && value > 30) {
      entry.height = value;
      entry.frame.style.height = `${value}px`;
      entry.status.hidden = true;
      reveal(entry);
    } else if (type === 'cord-comparison-reveal') {
      entry.reveal = value;
      reveal(entry);
    }
  });

  for (const tab of tabs) tab.addEventListener('click', () => select(tab));
  tablist.addEventListener('keydown', event => {
    const index = tabs.indexOf(event.target);
    if (index < 0) return;
    const next = {
      ArrowLeft: (index + tabs.length - 1) % tabs.length,
      ArrowRight: (index + 1) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(tabs[next]);
    tabs[next].focus();
  });
  window.addEventListener('hashchange', showFromAddress);
  showFromAddress();
})();
