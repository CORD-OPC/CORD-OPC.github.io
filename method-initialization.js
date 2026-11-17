(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const svg = $('method-init-diagram');
  const slider = $('method-init-step');
  const geometry = window.methodInitGeometry;
  const steps = [
    {
      figure: '(a)', algorithm: 1, title: 'Extract the target contour', operation: 'Clip target layout',
      text: 'Clip the target layout to the task window. The L-shaped polygon is the input to the placement process.',
      key: [],
    },
    {
      figure: '(b)', algorithm: 1, title: 'Place B-spline controls', operation: 'GenerateControls',
      text: 'Keep the polygon vertices. The default offset for edge controls is 50 nm and adapts near short edges. Edges longer than 100 nm get both controls. On a shorter edge, place a control only if the edge is at least twice that control’s offset.',
      key: [['vertex', 'Retained vertex'], ['control', 'Added spline control']],
    },
    {
      figure: '(c)', algorithm: 1, title: 'Form the quadratic B-spline', operation: 'Periodic quadratic B-spline',
      text: 'Use the ordered controls to form a closed quadratic B-spline. The squares shape this curve.',
      key: [['vertex', 'Spline control positions']],
    },
    {
      figure: '(d)', algorithm: 1, title: 'Sample and simplify the seed', operation: 'GridEval → Concat → Simplify',
      text: 'Sample nine interior positions per span, snap them to the grid, join the samples and remove redundant vertices. The rings mark the vertices retained in the seed contour.',
      key: [['seed', 'Retained seed vertex']],
    },
    {
      figure: '(e)', algorithm: 2, title: 'Add dense candidate nodes', operation: 'DensifyAndSnap',
      text: 'Order the seed counterclockwise from its smallest (x, y) vertex, subdivide its segments using h = 1.5 nm, then snap the nodes to the grid. These are available positions for later AP selection.',
      key: [['candidate', 'Candidate node']],
    },
    {
      figure: '(f)', algorithm: 2, title: 'Mark inherited anchors', operation: 'SelectNearbyAPs → ProjectAndMark',
      text: 'Project nearby anchors from the predecessor cache onto the candidate chain and enforce spacing. The green diamonds show inherited APs. With no valid match, the first node becomes the starting AP.',
      key: [['candidate', 'Candidate node'], ['inherited', 'Inherited AP']],
    },
    {
      figure: '(g)', algorithm: 3, title: 'Walk inward along long arcs', operation: 'ArcLength → WalkFromBothEnds',
      text: `The inherited APs split the ring into arcs. With M = 20 nm, walk inward from both ends on arcs longer than 3M. For the highlighted ${geometry.exampleArcLength.toFixed(1)} nm arc, the walk is 60 nm per end.`,
      key: [['inherited', 'Inherited AP'], ['walk', 'AP selected during the walk']],
      arcRules: true,
    },
    {
      figure: '(g)', algorithm: 3, title: 'Resolve the remaining gaps', operation: 'ResolveCenter',
      text: `After the walks, check each remaining gap for eligible extra APs. The highlighted arc leaves a ${geometry.exampleCenterLength.toFixed(1)} nm center gap, with two APs at its trisection points.`,
      key: [['inherited', 'Inherited AP'], ['walk', 'AP selected during the walk'], ['center', 'AP added in the center']],
    },
    {
      figure: '(h)', algorithm: 4, title: 'Extract the final APs', operation: 'Boundary rules → Extract marked nodes',
      text: 'Apply the eligibility and boundary rules, then extract the marked nodes in contour order with any inherited constraints. These are the anchors updated during optimization.',
      key: [['inherited', 'Inherited AP'], ['final', 'New optimization AP']],
    },
  ];

  function append(tag, attributes) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    svg.append(node);
  }

  function path(points, className, closed = true) {
    const coordinates = points.map(([x, y]) => `${x} ${-y}`).join('L');
    append('path', {d: `M${coordinates}${closed ? 'Z' : ''}`, class: className});
  }

  function mark(points, kind, radius) {
    for (const [x, y] of points) {
      const attrs = {class: `init-point init-${kind}`, 'data-point-kind': kind};
      if (kind === 'control' || kind === 'vertex') {
        append('rect', {...attrs, x: x - radius, y: -y - radius, width: 2 * radius, height: 2 * radius});
      } else if (kind === 'inherited') {
        append('path', {...attrs, d: `M${x} ${-y - radius}l${radius} ${radius} -${radius} ${radius} -${radius} -${radius}Z`});
      } else {
        append('circle', {...attrs, cx: x, cy: -y, r: radius});
      }
    }
  }

  function spline() {
    const points = geometry.controls;
    const middle = ([ax, ay], [bx, by]) => `${(ax + bx) / 2} ${-(ay + by) / 2}`;
    const segments = points.map(([x, y], index) => `Q${x} ${-y} ${middle(points[index], points[(index + 1) % points.length])}`);
    append('path', {d: `M${middle(points.at(-1), points[0])}${segments.join('')}Z`, class: 'init-spline'});
  }

  function renderDiagram(index) {
    svg.replaceChildren();
    if (index <= 1) path(geometry.layout, index === 0 ? 'init-target' : 'init-reference');
    if (index === 1) {
      const vertices = new Set(geometry.layout.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`));
      mark(geometry.layout, 'vertex', 2.5);
      mark(geometry.controls.filter(([x, y]) => !vertices.has(`${x.toFixed(1)},${y.toFixed(1)}`)), 'control', 2.5);
    }
    if (index === 2) {
      path(geometry.controls, 'init-reference');
      mark(geometry.controls, 'vertex', 1.9);
      spline();
    }
    if (index >= 3) path(geometry.seed, index === 8 ? 'init-final-curve' : 'init-seed-curve');
    if (index === 3) mark(geometry.seed, 'seed', 1.65);
    if (index >= 4 && index <= 7) mark(geometry.candidates, 'candidate', index === 4 ? .58 : .4);
    if (index === 6 || index === 7) {
      path(geometry.exampleArc, 'init-highlight', false);
      mark(geometry.walk, 'walk', 1.9);
    }
    if (index === 7) mark(geometry.center, 'center', 2.65);
    if (index === 8) mark([...geometry.walk, ...geometry.center], 'final', 2.1);
    if (index >= 5) mark(geometry.inherited, 'inherited', 3);
  }

  function show(index) {
    const step = steps[index];
    slider.value = index;
    slider.setAttribute('aria-valuetext', step.title);
    $('method-init-counter').value = `${index + 1} / ${steps.length}`;
    $('method-init-source').textContent = `Fig. 3${step.figure} · Algorithm 1, Stage ${step.algorithm}`;
    $('method-init-stage').textContent = step.title;
    $('method-init-explanation').textContent = step.text;
    $('method-init-operation').textContent = step.operation;
    $('method-init-arc-rules').hidden = !step.arcRules;
    const key = $('method-init-key');
    key.replaceChildren(...step.key.map(([kind, label]) => {
      const item = document.createElement('li');
      item.dataset.pointKind = kind;
      item.textContent = label;
      return item;
    }));
    svg.setAttribute('aria-label', step.title);
    renderDiagram(index);
  }

  slider.max = steps.length - 1;
  window.methodInitialization = {show, last: steps.length - 1};
})();
