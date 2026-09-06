(function () {
  'use strict';

  // ---- module size constants ----
  const MODULE_HEIGHT  = 640;   // fixed panel height (100mm at AE Modular scale)
  const PIXELS_PER_RU  = 160;   // 1 rack unit = 25mm = 160px

  // Default template shown on first load and after "Clear module".
  // Positions are in native SVG pixel space (before MODULE_SCALE).
  const INIT_COMPONENTS = [
    { type: 'jack', x: 20,  y: 60,  label: '1', labelPosition: 'right' },
    { type: 'jack', x: 20,  y: 90,  label: '2', labelPosition: 'right' },
    { type: 'jack', x: 20,  y: 120, label: '3', labelPosition: 'right' },
    { type: 'jack', x: 20,  y: 150, label: '4', labelPosition: 'right' },
    { type: 'jack', x: 20,  y: 180, label: '5', labelPosition: 'right' },
    { type: 'jack', x: 20,  y: 210, label: '6', labelPosition: 'right' },
    { type: 'jack', x: 20,  y: 240, label: '7', labelPosition: 'right' },
    { type: 'jack', x: 20,  y: 270, label: '8', labelPosition: 'right' },
    { type: 'jack', x: 140, y: 60,  label: '1', labelPosition: 'left' },
    { type: 'jack', x: 140, y: 90,  label: '2', labelPosition: 'left' },
    { type: 'jack', x: 140, y: 120, label: '3', labelPosition: 'left' },
    { type: 'jack', x: 140, y: 150, label: '4', labelPosition: 'left' },
    { type: 'jack', x: 140, y: 180, label: '5', labelPosition: 'left' },
    { type: 'jack', x: 140, y: 210, label: '6', labelPosition: 'left' },
    { type: 'jack', x: 140, y: 240, label: '7', labelPosition: 'left' },
    { type: 'jack', x: 140, y: 270, label: '8', labelPosition: 'left' },
  ];

  // ---- state ----
  const state = {
    name: 'New Module',
    id: 'new-module',
    manufacturer: '',
    url: '',
    documentation: '',
    customImage: false, // true = this module ships its own module.svg; exported as customImage:true
    width: PIXELS_PER_RU,
    height: MODULE_HEIGHT,
    components: [],
    selectedId: null,
    mode: 'select',       // 'select' | 'add-jack' | 'add-knob' | 'add-switch' | 'add-label'
    snapEnabled: true,
    snapSize: 10,
    _nextId: 1,
  };

  // Geometry constants, waveform glyphs, and the SVG-string builder are shared with the
  // patch app via js/panel-render.js (loaded before this file) so the live preview here
  // and any generated panel stay pixel-identical.
  const {
    LABEL_SIZE, LABEL_GAP, LABEL_BELOW_EXTRA,
    JACK_R, JACK_DOT_R,
    KNOB_R, KNOB_TICK_IN, KNOB_TICK_OUT,
    SW_V_HW, SW_V_HH, SW_H_HW, SW_H_HH,
    WAVE_GLYPHS, parseWave, escXml, labelPos, waveRun, buildSVGString,
  } = window.PanelRender;

  // Order/labels for this editor's own wave-symbol picker UI (props panel) — not shared,
  // since js/app.js has no UI that needs them.
  const WAVE_ORDER = ['sine', 'square', 'triangle', 'saw'];
  const WAVE_WORDS = { sine: 'Sine', square: 'Square', triangle: 'Triangle', saw: 'Sawtooth' };

  let ghost = null;     // {x, y} position while in add mode
  let drag = null;      // {id, sx, sy, ox, oy}

  // ---- DOM ----
  const svgEl      = document.getElementById('editor-svg');
  const inputName  = document.getElementById('input-name');
  const inputId    = document.getElementById('input-id');
  const inputW     = document.getElementById('input-width');
  const inputMfr   = document.getElementById('input-manufacturer');
  const inputUrl   = document.getElementById('input-url');
  const inputDocs  = document.getElementById('input-docs');
  const inputCustomImage = document.getElementById('input-custom-image');
  const snapEnable = document.getElementById('snap-enable');
  const snapSizeEl = document.getElementById('snap-size');
  const propsDiv   = document.getElementById('props-content');
  const topbarSub  = document.getElementById('topbar-subtitle');
  const copyFb     = document.getElementById('copy-feedback');

  // ---- helpers ----
  const NS = 'http://www.w3.org/2000/svg';

  function uid() { return 'c' + (state._nextId++); }

  function applyInitState() {
    state.name          = 'Module';
    state.id            = 'module';
    state.manufacturer  = '';
    state.url           = '';
    state.documentation = '';
    state.customImage   = false;
    state.width         = PIXELS_PER_RU;
    state.height        = MODULE_HEIGHT;
    state.selectedId    = null;
    state.mode          = 'select';
    state._nextId       = 1;
    state.components    = INIT_COMPONENTS.map(c => ({ ...c, id: uid() }));
  }

  function syncFormFromState() {
    inputName.value    = state.name;
    inputId.value      = state.id;
    inputMfr.value     = state.manufacturer || '';
    inputUrl.value     = state.url          || '';
    inputDocs.value    = state.documentation || '';
    inputCustomImage.checked = state.customImage;
    inputW.value       = Math.max(1, Math.round(state.width / PIXELS_PER_RU));
    snapEnable.checked = state.snapEnabled;
    snapSizeEl.value   = state.snapSize;
  }

  function snap(v) {
    if (!state.snapEnabled) return Math.round(v);
    return Math.round(v / state.snapSize) * state.snapSize;
  }

  function svgPt(e) {
    const r = svgEl.getBoundingClientRect();
    return { x: snap(e.clientX - r.left), y: snap(e.clientY - r.top) };
  }

  function svgRaw(e) {
    const r = svgEl.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function byId(id) { return state.components.find(c => c.id === id); }

  // Deletes a component, warning first if it came from an imported module.json — its id may
  // already be referenced by cables (jacks) or saved control values (knobs/switches) in patches
  // out in the wild. Labels are never referenced by patches, so they're never warned about.
  function deleteComponent(id) {
    const comp = byId(id);
    if (!comp) return;

    if (comp._imported && comp.type !== 'label') {
      const consequence = comp.type === 'jack'
        ? 'break any cable already connected to it in existing saved patches'
        : 'reset its saved value back to default in existing saved patches';
      const ok = confirm(
        `This ${comp.type}'s id ("${comp.id}") came from the imported module.json. Deleting it will ${consequence}. Continue?`
      );
      if (!ok) return;
    }

    state.components = state.components.filter(c => c.id !== id);
    if (state.selectedId === id) state.selectedId = null;
    render();
    renderProps();
  }

  // Selects the next (offset 1) or previous (offset -1) component in creation order, wrapping
  // around at either end. With nothing selected, offset 1 starts at the first component and
  // offset -1 starts at the last.
  function selectRelative(offset) {
    if (!state.components.length) return;
    const idx = state.components.findIndex(c => c.id === state.selectedId);
    const next = idx === -1
      ? (offset > 0 ? 0 : state.components.length - 1)
      : (idx + offset + state.components.length) % state.components.length;
    state.selectedId = state.components[next].id;
    setMode('select');
    renderProps();
  }

  function nameToId(name) {
    return (name || '')
      .toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'module';
  }

  function mkEl(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    return e;
  }

  function textEl(label, lp, fillColor) {
    const t = mkEl('text', {
      x: lp.x, y: lp.y,
      'text-anchor': lp.anchor,
      fill: fillColor,
      'font-family': 'IBM Plex Mono, monospace',
      'font-size': LABEL_SIZE,
    });
    t.textContent = label;
    return t;
  }

  // Live preview: one or more wave glyphs as a horizontal run at `lp`.
  function waveGlyphEl(names, lp, stroke) {
    const { originX, box, s, gap } = waveRun(names, lp);
    const g = mkEl('g');
    names.forEach((n, i) => {
      const seg = mkEl('g', {
        transform: `translate(${originX + i * (box * s + gap)},${lp.y - LABEL_SIZE}) scale(${s})`,
      });
      seg.appendChild(mkEl('path', {
        d: WAVE_GLYPHS[n], fill: 'none', stroke,
        'stroke-width': 1.5 / s, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      }));
      g.appendChild(seg);
    });
    return g;
  }

  // Live preview: a jack/knob/switch caption that is a wave token renders as a glyph, else text.
  // Named distinctly from labelG() (below), which renders a standalone label *component* —
  // two same-named functions here would silently shadow one another.
  function captionG(label, lp, fillColor) {
    const w = parseWave(label);
    return w ? waveGlyphEl(w, lp, fillColor) : textEl(label, lp, fillColor);
  }

  // ---- SVG rendering ----

  // Each component type: returns an SVG <g> element.
  // isGhost = true → amber tint, reduced opacity, pointer-events:none

  function jackG(comp, isGhost) {
    const g = mkEl('g');
    if (!isGhost) { g.classList.add('comp'); g.dataset.id = comp.id; }
    const a = isGhost ? '0.5' : '1';
    const s = isGhost ? '#e8a33d' : '#8a8270';
    const fill = isGhost ? 'rgba(232,163,61,0.6)' : '#9a9282';

    g.appendChild(mkEl('circle', { cx: comp.x, cy: comp.y, r: JACK_R, fill: '#141210', stroke: s, 'stroke-width': 1.5, opacity: a }));
    g.appendChild(mkEl('circle', { cx: comp.x, cy: comp.y, r: JACK_DOT_R, fill: '#3a352c', opacity: a }));
    if (comp.label) {
      g.appendChild(captionG(comp.label, labelPos(comp.x, comp.y, comp.labelPosition || 'below', JACK_R), fill));
    }
    return g;
  }

  function knobG(comp, isGhost) {
    const g = mkEl('g');
    if (!isGhost) { g.classList.add('comp'); g.dataset.id = comp.id; }
    const a = isGhost ? '0.5' : '1';
    const s = isGhost ? '#e8a33d' : '#8a8270';
    const fill = isGhost ? 'rgba(232,163,61,0.6)' : '#9a9282';

    g.appendChild(mkEl('circle', { cx: comp.x, cy: comp.y, r: KNOB_R, fill: '#1e1c18', stroke: s, 'stroke-width': 1.5, opacity: a }));
    g.appendChild(mkEl('line', {
      x1: comp.x, y1: comp.y - KNOB_TICK_IN, x2: comp.x, y2: comp.y - KNOB_TICK_OUT,
      stroke: isGhost ? 'rgba(232,163,61,0.8)' : '#c8bfaa',
      'stroke-width': 1.5, 'stroke-linecap': 'round', opacity: a,
    }));
    if (comp.label) {
      g.appendChild(captionG(comp.label, labelPos(comp.x, comp.y, comp.labelPosition || 'below', KNOB_R), fill));
    }
    return g;
  }

  function switchG(comp, isGhost) {
    const g = mkEl('g');
    if (!isGhost) { g.classList.add('comp'); g.dataset.id = comp.id; }
    const a = isGhost ? '0.5' : '1';
    const s = isGhost ? '#e8a33d' : '#8a8270';
    const toggleFill = isGhost ? 'rgba(232,163,61,0.4)' : '#8a8270';
    const labelFill  = isGhost ? 'rgba(232,163,61,0.6)' : '#9a9282';
    const horiz = (comp.orientation || 'vertical') === 'horizontal';

    if (horiz) {
      const bw = SW_H_HW * 2, bh = SW_H_HH * 2;
      const tw = Math.round(bw * 0.39), th = bh - 2;
      g.appendChild(mkEl('rect', { x: comp.x - SW_H_HW, y: comp.y - SW_H_HH, width: bw, height: bh, rx: 3, fill: '#1e1c18', stroke: s, 'stroke-width': 1.5, opacity: a }));
      g.appendChild(mkEl('rect', { x: comp.x - SW_H_HW + 2, y: comp.y - SW_H_HH + 1, width: tw, height: th, rx: 2, fill: toggleFill, opacity: a }));
      const ly = comp.y + Math.round(LABEL_SIZE * 0.35);
      if (comp.label)  g.appendChild(captionG(comp.label,  { x: comp.x - SW_H_HW - LABEL_GAP, y: ly, anchor: 'end'   }, labelFill));
      if (comp.label2) g.appendChild(captionG(comp.label2, { x: comp.x + SW_H_HW + LABEL_GAP, y: ly, anchor: 'start' }, labelFill));
    } else {
      const bw = SW_V_HW * 2, bh = SW_V_HH * 2;
      const tw = bw - 2, th = Math.round(bh * 0.39);
      g.appendChild(mkEl('rect', { x: comp.x - SW_V_HW, y: comp.y - SW_V_HH, width: bw, height: bh, rx: 3, fill: '#1e1c18', stroke: s, 'stroke-width': 1.5, opacity: a }));
      g.appendChild(mkEl('rect', { x: comp.x - SW_V_HW + 1, y: comp.y - SW_V_HH + 2, width: tw, height: th, rx: 2, fill: toggleFill, opacity: a }));
      if (comp.label)  g.appendChild(captionG(comp.label,  { x: comp.x, y: comp.y - SW_V_HH - LABEL_GAP,                    anchor: 'middle' }, labelFill));
      if (comp.label2) g.appendChild(captionG(comp.label2, { x: comp.x, y: comp.y + SW_V_HH + LABEL_GAP + LABEL_BELOW_EXTRA, anchor: 'middle' }, labelFill));
    }
    return g;
  }

  function labelG(comp, isGhost) {
    const g = mkEl('g');
    if (!isGhost) { g.classList.add('comp'); g.dataset.id = comp.id; }
    const fill = isGhost ? 'rgba(232,163,61,0.6)' : '#c8bfaa';
    const size = comp.size || LABEL_SIZE;
    const anchor = comp.align || 'middle';

    const t = mkEl('text', {
      x: comp.x, y: comp.y,
      'text-anchor': anchor,
      fill,
      'font-family': 'IBM Plex Mono, monospace',
      'font-size': size,
    });
    t.textContent = isGhost ? (comp.text || 'LABEL') : (comp.text || '');
    g.appendChild(t);
    return g;
  }

  function compG(comp, isGhost) {
    if (comp.type === 'jack')   return jackG(comp, isGhost);
    if (comp.type === 'knob')   return knobG(comp, isGhost);
    if (comp.type === 'switch') return switchG(comp, isGhost);
    if (comp.type === 'label')  return labelG(comp, isGhost);
  }

  function selRadius(comp) {
    return comp.type === 'jack' ? 13 : 17;
  }

  function render() {
    const W = state.width, H = state.height;

    svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svgEl.setAttribute('width', W);
    svgEl.setAttribute('height', H);

    // clear
    while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);

    // panel background
    svgEl.appendChild(mkEl('rect', { x: 0, y: 0, width: W, height: H, fill: '#2b271f' }));
    svgEl.appendChild(mkEl('rect', { x: 4, y: 4, width: W - 8, height: H - 8, fill: 'none', stroke: '#4a4335', 'stroke-width': 2 }));
    for (const [cx, cy] of [[14, 14], [W - 14, 14], [14, H - 14], [W - 14, H - 14]]) {
      svgEl.appendChild(mkEl('circle', { cx, cy, r: 4, fill: '#141210' }));
    }
    const title = mkEl('text', {
      x: W / 2, y: 40,
      'text-anchor': 'middle',
      fill: '#e8a33d',
      'font-family': 'IBM Plex Mono, monospace',
      'font-size': 14,
      'letter-spacing': 1,
    });
    title.textContent = (state.name || 'UNTITLED').toUpperCase();
    svgEl.appendChild(title);

    // components
    let selectedEl = null;
    for (const comp of state.components) {
      const g = compG(comp, false);
      svgEl.appendChild(g);
      if (comp.id === state.selectedId) selectedEl = g;
    }

    // selection ring
    if (state.selectedId) {
      const sel = byId(state.selectedId);
      if (sel) {
        if (sel.type === 'label' && selectedEl) {
          // arbitrary-width text: ring its actual rendered bounding box instead of a fixed radius
          const bbox = selectedEl.getBBox();
          const pad = 4;
          svgEl.appendChild(mkEl('rect', {
            x: bbox.x - pad, y: bbox.y - pad,
            width: bbox.width + pad * 2, height: bbox.height + pad * 2,
            fill: 'none',
            stroke: '#e8a33d',
            'stroke-width': 1.5,
            'stroke-dasharray': '4 3',
            opacity: 0.85,
            'pointer-events': 'none',
          }));
        } else {
          const ring = mkEl('circle', {
            cx: sel.x, cy: sel.y,
            r: selRadius(sel),
            fill: 'none',
            stroke: '#e8a33d',
            'stroke-width': 1.5,
            'stroke-dasharray': '4 3',
            opacity: 0.85,
            'pointer-events': 'none',
          });
          svgEl.appendChild(ring);
        }
      }
    }

    // ghost (add mode)
    if (ghost && state.mode !== 'select') {
      const type = state.mode.replace('add-', '');
      const ghostComp = {
        id: '__ghost__', type, x: ghost.x, y: ghost.y,
        label: '', label2: '', labelPosition: 'below', orientation: 'vertical',
        text: '', size: LABEL_SIZE, align: 'middle',
      };
      const g = compG(ghostComp, true);
      g.setAttribute('pointer-events', 'none');
      svgEl.appendChild(g);
    }

    // cursor class (SVGElement.className is read-only SVGAnimatedString, must use setAttribute)
    svgEl.setAttribute('class', drag ? 'cursor-drag' : state.mode === 'select' ? 'cursor-select' : 'cursor-add');

    topbarSub.textContent = `Module Editor — ${state.name || 'Untitled'}`;
    saveToStorage();
  }

  // ---- properties panel ----
  function renderProps() {
    propsDiv.innerHTML = '';
    const comp = state.selectedId ? byId(state.selectedId) : null;

    if (!comp) {
      propsDiv.innerHTML = '<p class="prop-empty">Select a component to view and edit its properties.</p>';
      return;
    }

    function append(el) { propsDiv.appendChild(el); }

    // ---- jack / knob: label + position picker ----
    if (comp.type === 'jack' || comp.type === 'knob') {
      append(labelEditor(
        comp.type === 'jack' ? 'Connection name' : 'Label',
        () => comp.label || '',
        v => { comp.label = v; },
        'e.g. CV IN'
      ));

      // label position label
      const posLabel = document.createElement('div');
      posLabel.className = 'field-label';
      posLabel.style.marginTop = '8px';
      posLabel.textContent = 'Label position';
      append(posLabel);

      // 3×3 grid: top-row [_, above, _], mid-row [left, ▣, right], bot-row [_, below, _]
      const grid = document.createElement('div');
      grid.className = 'pos-grid';

      const positions = [
        null,    'above', null,
        'left',  null,    'right',
        null,    'below', null,
      ];

      const cur = comp.labelPosition || 'below';

      for (const pos of positions) {
        if (pos === null) {
          const cell = document.createElement('div');
          cell.className = 'pos-center';
          cell.textContent = pos === null && positions.indexOf(pos) === 4 ? '▣' : '';
          grid.appendChild(cell);
        } else {
          const btn = document.createElement('button');
          btn.className = 'pos-btn' + (pos === cur ? ' active' : '');
          btn.textContent = pos;
          btn.addEventListener('click', () => {
            comp.labelPosition = pos;
            render();
            renderProps();
          });
          grid.appendChild(btn);
        }
      }
      // fix center cell text
      grid.children[4].textContent = '▣';

      append(grid);
    }

    // ---- switch: two position labels + orientation ----
    if (comp.type === 'switch') {
      const horiz = (comp.orientation || 'vertical') === 'horizontal';

      // orientation first
      const orLabel = document.createElement('div');
      orLabel.className = 'field-label';
      orLabel.textContent = 'Orientation';
      append(orLabel);

      const orientRow = document.createElement('div');
      orientRow.className = 'orient-row';

      for (const [val, icon, txt] of [['vertical', '⬍', 'Vertical'], ['horizontal', '⬌', 'Horizontal']]) {
        const btn = document.createElement('button');
        btn.className = 'orient-btn' + ((comp.orientation || 'vertical') === val ? ' active' : '');
        btn.innerHTML = `${icon} ${txt}`;
        btn.addEventListener('click', () => {
          comp.orientation = val;
          render();
          renderProps();
        });
        orientRow.appendChild(btn);
      }
      append(orientRow);

      // label fields: position 1 and 2
      const pos1Name = horiz ? 'Label left (pos 1)' : 'Label above (pos 1)';
      const pos2Name = horiz ? 'Label right (pos 2)' : 'Label below (pos 2)';

      append(labelEditor(pos1Name, () => comp.label  || '', v => { comp.label  = v; }, 'e.g. ON',  '10px'));
      append(labelEditor(pos2Name, () => comp.label2 || '', v => { comp.label2 = v; }, 'e.g. OFF'));
    }

    // ---- label: text + size + alignment ----
    if (comp.type === 'label') {
      const tf = field('Text', 'text', comp.text || '', 'Panel text');
      tf.querySelector('input').addEventListener('input', e => { comp.text = e.target.value; render(); });
      append(tf);

      const sf = field('Size', 'number', comp.size || LABEL_SIZE, '', { min: 6, max: 48, step: 1 });
      sf.style.marginTop = '8px';
      sf.querySelector('input').addEventListener('input', e => {
        const v = parseFloat(e.target.value);
        if (!isNaN(v) && v > 0) { comp.size = v; render(); }
      });
      append(sf);

      const alLabel = document.createElement('div');
      alLabel.className = 'field-label';
      alLabel.style.marginTop = '8px';
      alLabel.textContent = 'Alignment';
      append(alLabel);

      const alignRow = document.createElement('div');
      alignRow.className = 'orient-row';
      for (const [val, txt] of [['start', 'Left'], ['middle', 'Center'], ['end', 'Right']]) {
        const btn = document.createElement('button');
        btn.className = 'orient-btn' + ((comp.align || 'middle') === val ? ' active' : '');
        btn.textContent = txt;
        btn.addEventListener('click', () => {
          comp.align = val;
          render();
          renderProps();
        });
        alignRow.appendChild(btn);
      }
      append(alignRow);
    }

    // ---- x / y (all types) ----
    const xyWrap = document.createElement('div');
    xyWrap.style.marginTop = '10px';
    const xyRow = document.createElement('div');
    xyRow.className = 'field-row';

    for (const axis of ['x', 'y']) {
      const f = field(axis.toUpperCase(), 'number', comp[axis], '', { step: state.snapSize, min: 0 });
      const inp = f.querySelector('input');
      inp.dataset.axis = axis;
      inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        if (!isNaN(v)) { comp[axis] = v; render(); }
      });
      xyRow.appendChild(f);
    }

    xyWrap.appendChild(xyRow);
    append(xyWrap);

    // type badge
    const badge = document.createElement('div');
    badge.className = 'prop-type-badge';
    badge.textContent = comp.type;
    append(badge);

    // id (read-only) — makes clear that editing the label/text isn't the same as this identity,
    // and that removing the component below discards it
    const idField = field('ID', 'text', comp.id, '', { readOnly: true });
    idField.style.marginTop = '6px';
    const idInput = idField.querySelector('input');
    idInput.style.opacity = '0.6';
    idInput.style.cursor = 'default';
    append(idField);

    // delete
    const del = document.createElement('button');
    del.className = 'delete-btn';
    del.textContent = 'Delete component';
    del.addEventListener('click', () => deleteComponent(comp.id));
    append(del);
  }

  function field(labelText, type, value, placeholder, extra = {}) {
    const d = document.createElement('div');
    d.className = 'field';
    const l = document.createElement('label');
    l.className = 'field-label';
    l.textContent = labelText;
    const inp = document.createElement('input');
    inp.type = type;
    inp.value = value;
    if (placeholder) inp.placeholder = placeholder;
    for (const [k, v] of Object.entries(extra)) inp[k] = v;
    d.appendChild(l);
    d.appendChild(inp);
    return d;
  }

  // A label input that can be either free text or a waveform symbol.
  // getVal/setVal read & write the underlying string (comp.label / comp.label2).
  // Switching kind or picking a glyph mutates state then re-renders the panel.
  function labelEditor(titleText, getVal, setVal, placeholder, marginTop) {
    const wrap = document.createElement('div');
    wrap.className = 'field-row-wrap';
    if (marginTop) wrap.style.marginTop = marginTop;

    const heading = document.createElement('label');
    heading.className = 'field-label';
    heading.textContent = titleText;
    wrap.appendChild(heading);

    const cur = getVal() || '';
    const waveParts = parseWave(cur);        // array | null
    const isWave = !!waveParts;

    // kind toggle: Abc / ∿
    const toggle = document.createElement('div');
    toggle.className = 'orient-row';
    for (const [kind, txt] of [['text', 'Abc'], ['wave', '∿']]) {
      const b = document.createElement('button');
      b.className = 'orient-btn' + ((kind === 'wave') === isWave ? ' active' : '');
      b.textContent = txt;
      b.title = kind === 'wave' ? 'Waveform symbol' : 'Text';
      b.addEventListener('click', () => {
        if (kind === 'wave' && !isWave) setVal('wave:sine');
        else if (kind === 'text' && isWave) setVal('');
        else return;
        render();
        renderProps();
      });
      toggle.appendChild(b);
    }
    wrap.appendChild(toggle);

    if (isWave) {
      const row = document.createElement('div');
      row.className = 'wave-pick-row';
      for (const name of WAVE_ORDER) {
        const b = document.createElement('button');
        b.className = 'wave-pick-btn' + (waveParts.includes(name) ? ' active' : '');
        b.title = WAVE_WORDS[name];
        b.innerHTML =
          `<svg viewBox="-1 -1 16 16" width="20" height="20" aria-hidden="true">` +
          `<path d="${WAVE_GLYPHS[name]}" fill="none" stroke="currentColor" stroke-width="1.5" ` +
          `stroke-linejoin="round" stroke-linecap="round"/></svg>`;
        b.addEventListener('click', () => {
          let parts = waveParts.slice();
          if (parts.includes(name)) {
            parts = parts.filter(p => p !== name);
            if (!parts.length) parts = [name];      // keep at least one glyph
          } else {
            parts.push(name);
          }
          parts.sort((a, z) => WAVE_ORDER.indexOf(a) - WAVE_ORDER.indexOf(z));
          setVal('wave:' + parts.join('+'));
          render();
          renderProps();
        });
        row.appendChild(b);
      }
      wrap.appendChild(row);

      const hint = document.createElement('div');
      hint.className = 'ru-hint';
      hint.style.marginTop = '4px';
      hint.textContent = 'Tap more than one for a combined symbol.';
      wrap.appendChild(hint);
    } else {
      const f = field('', 'text', cur, placeholder);
      f.style.marginTop = '6px';
      f.querySelector('label').remove();
      f.querySelector('input').addEventListener('input', e => { setVal(e.target.value); render(); });
      wrap.appendChild(f);
    }

    return wrap;
  }

  // ---- SVG events ----
  svgEl.addEventListener('mousemove', e => {
    if (state.mode !== 'select') {
      ghost = svgPt(e);
      render();
    }

    if (drag) {
      e.preventDefault();
      const raw = svgRaw(e);
      const comp = byId(drag.id);
      if (comp) {
        comp.x = snap(drag.ox + (raw.x - drag.sx));
        comp.y = snap(drag.oy + (raw.y - drag.sy));
        render();
        // update x/y inputs in props without full re-render
        const inputs = propsDiv.querySelectorAll('input[data-axis]');
        for (const inp of inputs) inp.value = comp[inp.dataset.axis];
      }
    }
  });

  svgEl.addEventListener('mouseleave', () => {
    if (state.mode !== 'select' && !drag) {
      ghost = null;
      render();
    }
  });

  svgEl.addEventListener('mousedown', e => {
    if (e.button !== 0) return;

    if (state.mode !== 'select') {
      // Place component
      e.preventDefault();
      const pt = svgPt(e);
      const type = state.mode.replace('add-', '');
      const defaults = type === 'switch'
        ? { label: '', label2: '', orientation: 'vertical' }
        : type === 'label'
        ? { text: 'Label text', size: LABEL_SIZE, align: 'middle' }
        : { label: '', labelPosition: 'below' };
      const comp = { id: uid(), type, x: pt.x, y: pt.y, ...defaults };
      state.components.push(comp);
      state.selectedId = comp.id;
      setMode('select');
      render();
      renderProps();
      return;
    }

    // hit-test in select mode
    const hit = e.target.closest('.comp');
    if (hit) {
      e.preventDefault();
      const id = hit.dataset.id;
      state.selectedId = id;
      const comp = byId(id);
      const raw = svgRaw(e);
      drag = { id, sx: raw.x, sy: raw.y, ox: comp.x, oy: comp.y };
      render();
      renderProps();
    } else {
      if (state.selectedId) {
        state.selectedId = null;
        render();
        renderProps();
      }
    }
  });

  svgEl.addEventListener('mouseup', () => { drag = null; render(); });
  document.addEventListener('mouseup', () => { if (drag) { drag = null; render(); } });

  // ---- keyboard ----
  document.addEventListener('keydown', e => {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;

    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedId) {
      deleteComponent(state.selectedId);
    }
    if (e.key === '[') selectRelative(-1);
    if (e.key === ']') selectRelative(1);

    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === 'Escape' || key === 's') setMode('select');
    if (key === 'j') setMode('add-jack');
    if (key === 'k') setMode('add-knob');
    if (key === 'w') setMode('add-switch');
    if (key === 't') setMode('add-label');
  });

  // ---- tool buttons ----
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  function setMode(mode) {
    state.mode = mode;
    ghost = null;
    document.querySelectorAll('.tool-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    render();
  }

  // ---- module settings ----
  let idManual = false;

  inputName.addEventListener('input', () => {
    state.name = inputName.value;
    if (!idManual) {
      state.id = nameToId(state.name);
      inputId.value = state.id;
    }
    render();
  });

  inputId.addEventListener('input', () => {
    idManual = true;
    state.id = inputId.value;
  });

  inputId.addEventListener('blur', () => {
    state.id = nameToId(state.id) || nameToId(state.name) || 'module';
    inputId.value = state.id;
  });

  inputMfr.addEventListener('input',  () => { state.manufacturer  = inputMfr.value;  });
  inputUrl.addEventListener('input',  () => { state.url           = inputUrl.value;  });
  inputDocs.addEventListener('input', () => { state.documentation = inputDocs.value; });
  inputCustomImage.addEventListener('change', () => { state.customImage = inputCustomImage.checked; });

  inputW.addEventListener('input', () => {
    const ru = Math.max(1, Math.min(8, parseInt(inputW.value, 10) || 1));
    state.width = ru * PIXELS_PER_RU;
    render();
  });

  snapEnable.addEventListener('change', () => { state.snapEnabled = snapEnable.checked; });

  snapSizeEl.addEventListener('input', () => {
    const v = parseInt(snapSizeEl.value, 10);
    if (v >= 1) state.snapSize = v;
  });

  // ---- export ----

  // Builds the module-definition shape shared with module.json / js/panel-render.js
  // ({name, width, height, connections, controls, labels}) from the editor's own
  // state.components array. Used by both buildJSON() (below) and the "Download SVG"
  // handler, which hands this straight to PanelRender.buildSVGString().
  function toModuleDef() {
    const connections = state.components
      .filter(c => c.type === 'jack')
      .map(c => ({
        id: c.id,
        name: c.label || c.id,
        position: { x: c.x, y: c.y },
        labelPosition: c.labelPosition || 'below',
      }));
    const controls = state.components
      .filter(c => c.type === 'knob' || c.type === 'switch')
      .map(c => {
        const entry = { id: c.id, type: c.type, label: c.label || '', position: { x: c.x, y: c.y } };
        if (c.type === 'switch') {
          entry.label2 = c.label2 || '';
          entry.orientation = c.orientation || 'vertical';
        } else {
          entry.labelPosition = c.labelPosition || 'below';
        }
        return entry;
      });
    const labels = state.components
      .filter(c => c.type === 'label')
      .map(c => ({
        id: c.id,
        text: c.text || '',
        position: { x: c.x, y: c.y },
        size: c.size || LABEL_SIZE,
        align: c.align || 'middle',
      }));

    return {
      name: state.name || 'Untitled',
      width: state.width,
      height: state.height,
      connections,
      ...(controls.length ? { controls } : {}),
      ...(labels.length   ? { labels }   : {}),
    };
  }

  function buildJSON() {
    const id = state.id || nameToId(state.name) || 'module';
    const def = toModuleDef();

    // `labels` is not used by the patch editor (the SVG already bakes the text in) — it exists
    // purely so a module.json alone can be re-imported here and reconstruct the full panel,
    // without needing the matching module.svg re-uploaded. `customImage` is build-time-only
    // metadata (stripped by build-modules.js) telling it whether to expect a module.svg.
    return JSON.stringify({
      id,
      name: def.name,
      ...(state.manufacturer  ? { manufacturer: state.manufacturer } : {}),
      ...(state.url           ? { url: state.url } : {}),
      ...(state.documentation ? { documentation: state.documentation } : {}),
      ...(state.customImage   ? { customImage: true } : {}),
      width: def.width,
      height: def.height,
      connections: def.connections,
      ...(def.controls ? { controls: def.controls } : {}),
      ...(def.labels   ? { labels: def.labels }     : {}),
    }, null, 2);
  }

  function importModule(mod) {
    if (!mod || typeof mod !== 'object' || !Array.isArray(mod.connections)) {
      showToast('That file does not look like a module.json — missing a "connections" array.', true);
      return;
    }

    // Reassign _nextId past any existing "c<N>" ids so newly-added components can't collide
    // with ones carried over from the import (which keep their original ids verbatim — cables
    // in saved patches reference jacks by this id, so it must not change on re-export).
    const allDefs = [...mod.connections, ...(mod.controls || []), ...(mod.labels || [])];
    let maxNum = 0;
    for (const d of allDefs) {
      const m = /^c(\d+)$/.exec((d && d.id) || '');
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    }
    state._nextId = maxNum + 1;

    const components = [];

    for (const c of mod.connections) {
      if (!c || !c.position) continue;
      // Export bakes a blank label into name = id, since connections[].name is required —
      // undo that here so a genuinely blank label doesn't come back showing the raw id.
      const jackLabel = (c.name && c.name !== c.id) ? c.name : '';
      components.push({
        id: c.id || uid(), type: 'jack', x: c.position.x, y: c.position.y,
        label: jackLabel, labelPosition: c.labelPosition || 'below',
        _imported: !!c.id,
      });
    }

    for (const c of (mod.controls || [])) {
      if (!c || !c.position) continue;
      if (c.type === 'switch') {
        components.push({
          id: c.id || uid(), type: 'switch', x: c.position.x, y: c.position.y,
          label: c.label || '', label2: c.label2 || '', orientation: c.orientation || 'vertical',
          _imported: !!c.id,
        });
      } else {
        components.push({
          id: c.id || uid(), type: 'knob', x: c.position.x, y: c.position.y,
          label: c.label || '', labelPosition: c.labelPosition || 'below',
          _imported: !!c.id,
        });
      }
    }

    for (const c of (mod.labels || [])) {
      if (!c || !c.position) continue;
      components.push({
        id: c.id || uid(), type: 'label', x: c.position.x, y: c.position.y,
        text: c.text || '', size: c.size || LABEL_SIZE, align: c.align || 'middle',
        _imported: !!c.id,
      });
    }

    state.name          = mod.name || 'Module';
    state.id            = mod.id   || nameToId(state.name) || 'module';
    state.manufacturer  = mod.manufacturer  || '';
    state.url           = mod.url           || '';
    state.documentation = mod.documentation || '';
    state.customImage   = mod.customImage === true;
    state.width = (typeof mod.width === 'number' && mod.width > 0)
      ? Math.max(PIXELS_PER_RU, Math.round(mod.width / PIXELS_PER_RU) * PIXELS_PER_RU)
      : PIXELS_PER_RU;
    state.height     = MODULE_HEIGHT;
    state.components = components;
    state.selectedId = null;
    idManual = true; // imported id is explicit; don't let name edits silently overwrite it

    setMode('select');
    syncFormFromState();
    render();
    renderProps();
    showToast(`Imported "${state.name}" — ${components.length} component(s).`);
  }

  document.getElementById('btn-download-svg').addEventListener('click', () => {
    const blob = new Blob([buildSVGString(toModuleDef())], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.id || 'module'}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('btn-copy-json').addEventListener('click', () => {
    navigator.clipboard.writeText(buildJSON()).then(() => {
      copyFb.classList.add('visible');
      setTimeout(() => copyFb.classList.remove('visible'), 1800);
    });
  });

  document.getElementById('btn-download-json').addEventListener('click', () => {
    const blob = new Blob([buildJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.id || 'module'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  const inputImportJson = document.getElementById('input-import-json');

  document.getElementById('btn-import-json').addEventListener('click', () => {
    if (state.components.length && !confirm('Import will replace the current module. Continue?')) return;
    inputImportJson.click();
  });

  inputImportJson.addEventListener('change', () => {
    const file = inputImportJson.files[0];
    inputImportJson.value = ''; // allow re-selecting the same file next time
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      let mod;
      try { mod = JSON.parse(reader.result); }
      catch (err) { showToast(`Invalid JSON file: ${err.message}`, true); return; }
      importModule(mod);
    };
    reader.onerror = () => showToast('Could not read the selected file.', true);
    reader.readAsText(file);
  });

  // ---- localStorage persistence ----
  const STORAGE_KEY     = 'patchbay-module-editor';
  const STORAGE_VERSION = 1;
  // Increment STORAGE_VERSION whenever a saved-data schema change would prevent
  // older saves from loading correctly. The load path will detect the mismatch,
  // discard the stale data, and show the user an apology toast.

  let _toastTimer = null;
  function showToast(msg, isError = false) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = isError ? 'error' : '';
    el.hidden = false;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 6000 : 3000);
  }

  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: STORAGE_VERSION,
        name: state.name,
        id: state.id,
        manufacturer: state.manufacturer,
        url: state.url,
        documentation: state.documentation,
        customImage: state.customImage,
        width: state.width,
        height: state.height,
        components: state.components,
        snapEnabled: state.snapEnabled,
        snapSize: state.snapSize,
        _nextId: state._nextId,
      }));
    } catch (_) {}
  }

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (!s || typeof s !== 'object') return false;

      if (s.version !== STORAGE_VERSION) {
        localStorage.removeItem(STORAGE_KEY);
        showToast(
          'Your saved module could not be loaded — the editor has been updated since your last visit and the format changed. Sorry for the inconvenience.',
          true
        );
        return false;
      }

      if (s.name          !== undefined) state.name          = s.name;
      if (s.id            !== undefined) state.id            = s.id;
      if (s.manufacturer  !== undefined) state.manufacturer  = s.manufacturer;
      if (s.url           !== undefined) state.url           = s.url;
      if (s.documentation !== undefined) state.documentation = s.documentation;
      if (s.customImage   !== undefined) state.customImage   = s.customImage === true;
      if (s.width         !== undefined) state.width         = Math.max(PIXELS_PER_RU, Math.round(s.width / PIXELS_PER_RU) * PIXELS_PER_RU);
      state.height = MODULE_HEIGHT;
      if (Array.isArray(s.components)) state.components  = s.components;
      if (s.snapEnabled !== undefined) state.snapEnabled  = s.snapEnabled;
      if (s.snapSize    !== undefined) state.snapSize     = Math.max(1,   s.snapSize);
      if (s._nextId     !== undefined) state._nextId      = s._nextId;
      return true;
    } catch (_) { return false; }
  }

  document.getElementById('btn-clear-module').addEventListener('click', () => {
    if (!confirm('Clear the module? All components will be removed and the template restored.')) return;
    applyInitState();
    localStorage.removeItem(STORAGE_KEY);
    syncFormFromState();
    render();
    renderProps();
  });

  // ---- init ----
  applyInitState();
  loadFromStorage();   // overwrites state if saved data exists
  syncFormFromState();
  render();
  renderProps();

}());
