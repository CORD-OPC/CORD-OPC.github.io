(() => {
  'use strict';
  const embedded = window.parent !== window && new URLSearchParams(location.search).get('embed') === '1';
  const origin = location.protocol === 'file:' ? '*' : location.origin;
  const send = (type, value) => window.parent.postMessage({type, value}, origin);
  const main = () => document.getElementById('main');
  const sendHeight = () => send('cord-comparison-height', Math.ceil(main().getBoundingClientRect().height));
  window.comparisonIsStacked = () => main().clientWidth <= 772;
  window.revealComparisonTarget = target => {
    if (embedded) {
      sendHeight();
      send('cord-comparison-reveal', Math.round(target.getBoundingClientRect().top + window.scrollY));
    } else {
      target.scrollIntoView({block: 'start', behavior: 'instant'});
    }
  };
  if (!embedded) return;

  document.documentElement.dataset.comparisonEmbed = '';
  window.addEventListener('DOMContentLoaded', () => {
    new ResizeObserver(sendHeight).observe(main());
    sendHeight();
    document.addEventListener('click', event => {
      const back = event.target.closest('.chip-back-to-map');
      if (!back) return;
      const target = document.getElementById(back.hash.slice(1));
      if (!target) return;
      event.preventDefault();
      window.revealComparisonTarget(target);
    });
  }, {once: true});
})();
