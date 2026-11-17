async function unpackChipGzip(base64) {
  const compressed = Uint8Array.fromBase64
    ? Uint8Array.fromBase64(base64)
    : Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

function createChipIouMap(frame, onCrop) {
  const $ = id => document.getElementById(id);
  const grid = window.chipIouGrid;
  const {bounds, count, cellSize, metrics} = grid;
  const map = $('chip-iou-cells');
  const tooltip = $('chip-iou-tooltip');
  const readout = $('chip-iou-readout');
  const status = $('chip-iou-status');
  const requests = new Map();
  const [west, south, east, north] = bounds;
  const width = east - west;
  const height = north - south;
  const changes = metrics.map(([fuilt, proteus]) => fuilt === null || proteus === null ? null : proteus - fuilt);
  const available = changes.filter(change => change !== null);
  const range = Math.max(1, Math.ceil(Math.max(...available.map(Math.abs))));
  const hasNegative = available.some(change => change < 0);
  const low = available.length ? Math.max(0, Math.floor(Math.min(...available) * 10) / 10) : 0;
  const high = Math.max(low + .1, Math.ceil(Math.max(...available) * 10) / 10);
  let hovered = null;
  let chosen = null;
  let selection = 0;

  function cellColor(change) {
    if (change === null) return '#d5dce3';
    const neutral = [225, 238, 249];
    const endpoint = change < 0 ? [157, 63, 25] : [20, 82, 152];
    const t = hasNegative ? Math.abs(change) / range : (change - low) / (high - low);
    return `rgb(${neutral.map((value, i) => Math.round(value + (endpoint[i] - value) * t)).join(' ')})`;
  }

  function rectangle(x, y) {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', cellSize);
    rect.setAttribute('height', cellSize);
    return rect;
  }

  map.setAttribute('viewBox', `0 0 ${width} ${height}`);
  map.style.left = `${100 * (west - chipLayout.left) / chipLayout.span}%`;
  map.style.top = `${100 * (chipLayout.top - north) / chipLayout.span}%`;
  map.style.width = `${100 * width / chipLayout.span}%`;
  map.style.height = `${100 * height / chipLayout.span}%`;
  const cells = document.createDocumentFragment();
  changes.forEach((change, index) => {
    const rect = rectangle(index % count * cellSize, Math.floor(index / count) * cellSize);
    rect.dataset.cellIndex = index;
    rect.setAttribute('fill', cellColor(change));
    cells.append(rect);
  });
  const highlight = rectangle(0, 0);
  highlight.classList.add('chip-iou-highlight');
  highlight.setAttribute('hidden', '');
  map.append(cells, highlight);

  const stops = hasNegative ? [-range, 0, range] : [low, high];
  $('chip-iou-ramp').style.background = `linear-gradient(90deg, ${stops.map(cellColor).join(', ')})`;
  for (const value of stops) {
    const tick = document.createElement('span');
    tick.textContent = `${value > 0 ? '+' : ''}${hasNegative ? value : value.toFixed(1)}`;
    $('chip-iou-ticks').append(tick);
  }
  const gains = available.filter(change => change > 0).length;
  $('chip-iou-summary').textContent = `${gains} of ${available.length} comparable cells improve · ${count} × ${count} grid`;
  $('chip-iou-shading').textContent = hasNegative
    ? 'Blue favors CORD-OPC and orange favors FuILT.'
    : 'Darker blue shows a larger gain for CORD-OPC.';
  const bestCell = changes.indexOf(Math.max(...available));
  const starter = $('chip-iou-start');
  starter.hidden = bestCell < 0;
  starter.addEventListener('click', () => chooseCell(bestCell));

  const percent = value => value === null ? 'N/A' : `${value.toFixed(2)}%`;
  const delta = value => value === null ? 'N/A' : `${value > 0 ? '+' : ''}${value.toFixed(2)} pp`;
  const cellName = index => `R${String(Math.floor(index / count) + 1).padStart(2, '0')}C${String(index % count + 1).padStart(2, '0')}`;

  function cellReadout(index) {
    if (index === null) {
      readout.hidden = true;
      return;
    }
    const [fuilt, proteus] = metrics[index];
    const x = west + index % count * cellSize;
    const y = north - (Math.floor(index / count) + 1) * cellSize;
    $('chip-iou-cell-name').textContent = cellName(index);
    $('chip-iou-cell-position').textContent = `x ${x}–${x + cellSize} · y ${y}–${y + cellSize} µm`;
    $('chip-iou-fuilt').textContent = percent(fuilt);
    $('chip-iou-proteus').textContent = percent(proteus);
    $('chip-iou-delta').textContent = delta(changes[index]);
    readout.hidden = false;
  }

  function hoverCell(index) {
    if (hovered === index) return;
    hovered = index;
    highlight.toggleAttribute('hidden', hovered === null);
    if (hovered !== null) {
      highlight.setAttribute('x', hovered % count * cellSize);
      highlight.setAttribute('y', Math.floor(hovered / count) * cellSize);
      const [fuilt, proteus] = metrics[hovered];
      tooltip.textContent = `${cellName(hovered)}  ·  ${delta(changes[hovered])}\nFuILT  ${percent(fuilt)}\nCORD-OPC  ${percent(proteus)}`;
    }
    cellReadout(hovered ?? chosen);
  }

  function positionTooltip(event) {
    tooltip.hidden = hovered === null || event.pointerType !== 'mouse';
    if (tooltip.hidden) return;
    const box = frame.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const nextX = x + tooltip.offsetWidth + 12 < frame.clientWidth ? x + 12 : x - tooltip.offsetWidth - 8;
    const nextY = y + tooltip.offsetHeight + 12 < frame.clientHeight ? y + 12 : y - tooltip.offsetHeight - 8;
    tooltip.style.left = `${Math.max(4, nextX)}px`;
    tooltip.style.top = `${Math.max(4, nextY)}px`;
  }

  window.registerChipIouCrop = async (index, payload) => {
    const request = requests.get(index);
    if (!request) return;
    try {
      const data = await unpackChipGzip(payload);
      request.resolve(JSON.parse(new TextDecoder().decode(data)));
    } catch (error) {
      request.reject(error);
    }
  };

  function loadCrop(index) {
    if (requests.has(index)) return requests.get(index).promise;
    const request = {};
    const script = document.createElement('script');
    script.src = `assets/fullchip/iou/${index}.js`;
    request.promise = new Promise((resolve, reject) => {
      request.resolve = resolve;
      request.reject = reject;
      script.onerror = reject;
    }).finally(() => {
      script.remove();
      requests.delete(index);
    });
    requests.set(index, request);
    document.head.append(script);
    return request.promise;
  }

  async function chooseCell(index) {
    const attempt = ++selection;
    chosen = index;
    cellReadout(chosen);
    tooltip.hidden = true;
    status.textContent = `Loading contours for ${cellName(index)}…`;
    try {
      const crop = await loadCrop(index);
      if (attempt !== selection) return;
      hoverCell(null);
      cellReadout(chosen);
      status.textContent = '';
      onCrop({...crop, id: cellName(index), iouIndex: index});
    } catch {
      if (attempt === selection) status.textContent = 'Contours unavailable. Select the cell again to retry.';
    }
  }

  map.addEventListener('pointermove', event => {
    const index = event.target.dataset.cellIndex;
    hoverCell(index === undefined ? null : Number(index));
    positionTooltip(event);
  });
  map.addEventListener('pointerleave', () => {
    hoverCell(null);
    tooltip.hidden = true;
  });
  map.addEventListener('click', event => {
    const index = event.target.dataset.cellIndex;
    if (index !== undefined) chooseCell(Number(index));
  });

  return {
    setVisible(visible) {
      map.toggleAttribute('hidden', !visible);
      if (!visible) tooltip.hidden = true;
    },
    reset() {
      selection++;
      chosen = null;
      hoverCell(null);
      cellReadout(null);
      tooltip.hidden = true;
      status.textContent = '';
    },
    keydown(event) {
      const index = hovered ?? Math.floor(count / 2) * (count + 1);
      const moves = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]};
      if (Object.hasOwn(moves, event.key)) {
        event.preventDefault();
        const [dx, dy] = moves[event.key];
        const bound = value => Math.max(0, Math.min(count - 1, value));
        hoverCell(bound(Math.floor(index / count) + dy) * count + bound(index % count + dx));
        const [fuilt, proteus] = metrics[hovered];
        status.textContent = `${cellName(hovered)}, FuILT ${percent(fuilt)}, CORD-OPC ${percent(proteus)}, ${delta(changes[hovered])}`;
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        chooseCell(index);
      }
    },
  };
}
