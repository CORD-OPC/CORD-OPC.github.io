(() => {
  'use strict';
  const section = document.getElementById('benchmarks');
  const tablist = section.querySelector('[role="tablist"]');
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  const status = document.getElementById('results-load-status');
  const example = document.getElementById('process-band');
  const processStatus = document.getElementById('process-load-status');
  const overall = 'results-overall';
  let active = overall;
  let detailsReady = false;
  let pending = null;
  let processReady = false;
  let processPending = null;

  function loadScript(source) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = source;
      script.onload = resolve;
      script.onerror = () => {
        script.remove();
        reject(new Error(`Could not load ${source}`));
      };
      document.head.append(script);
    });
  }

  function loadDetails() {
    if (detailsReady) return;
    status.textContent = 'Loading detailed results…';
    status.hidden = false;
    if (pending) return;
    pending = loadScript('assets/paired-results.js?v=matched-baselines')
      .then(() => loadScript('matched-results.js?v=all-pvb-baselines'))
      .then(() => {
        for (const content of section.querySelectorAll('[data-results-content]')) content.hidden = false;
        detailsReady = true;
        status.hidden = true;
        if (example.open) loadProcess();
      }).catch(() => {
        status.textContent = 'Detailed results are unavailable. Select the tab again to retry.';
        status.hidden = active === overall;
      }).finally(() => {
        pending = null;
      });
  }

  function loadProcess() {
    if (!detailsReady || processReady) return null;
    if (processPending) return processPending;
    processStatus.textContent = 'Loading the 2 µm process example…';
    processStatus.hidden = false;
    processPending = loadScript('assets/process-band.js?v=matched-baselines').then(() => {
      window.initProcessExample(window.processBand);
      document.getElementById('process-card').hidden = false;
      processReady = true;
      processStatus.hidden = true;
    }).catch(() => {
      processStatus.textContent = 'The process example is unavailable. Reopen it to retry.';
    }).finally(() => {
      processPending = null;
    });
    return processPending;
  }

  example.addEventListener('toggle', () => {
    if (example.open) loadProcess();
  });

  function show(tab, updateAddress = false) {
    active = tab.getAttribute('aria-controls');
    for (const option of tabs) {
      const selected = option === tab;
      option.setAttribute('aria-selected', String(selected));
      option.tabIndex = selected ? 0 : -1;
      document.getElementById(option.getAttribute('aria-controls')).hidden = !selected;
    }
    status.hidden = true;
    if (active !== overall) loadDetails();
    if (updateAddress) {
      const hash = active === overall ? '#benchmarks' : `#${active}`;
      if (location.hash !== hash) history.replaceState(null, '', hash);
    }
  }

  function showFromAddress() {
    const hash = location.hash.slice(1);
    const previewProcess = hash === 'process-band' || hash === 'results-process';
    const panel = hash === 'benchmarks' ? overall : previewProcess ? 'results-matched' : hash;
    const tab = tabs.find(option => option.getAttribute('aria-controls') === panel);
    if (!tab) return;
    show(tab);
    if (previewProcess) {
      example.open = true;
      Promise.resolve(pending).then(loadProcess).then(() => {
        if (!example.hidden && location.hash.slice(1) === hash) example.scrollIntoView({block: 'start', behavior: 'instant'});
      });
      return;
    }
  }

  for (const tab of tabs) tab.addEventListener('click', () => show(tab, true));
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
    show(tabs[next], true);
    tabs[next].focus();
  });
  window.addEventListener('hashchange', showFromAddress);
  showFromAddress();
})();
