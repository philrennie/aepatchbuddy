/* ==========================================================================
   Patch Bay — shared module panel SVG renderer.
   Used by both the module editor (live preview + "Download SVG" export) and
   the main patch app (generating a panel inline for modules that don't
   supply their own module.svg). Plain script, no bundler — exposes
   window.PanelRender. Load before js/app.js and js/module-editor.js.
   ========================================================================== */

(function () {
  'use strict';

  // ---- component geometry constants ----
  // Shared so the module editor's live preview and any generated panel stay
  // pixel-identical — a value only needs to be changed once.
  const LABEL_SIZE        = 11;   // font-size for all component labels
  const LABEL_GAP         = 8;   // px gap between component edge and label baseline
  const LABEL_BELOW_EXTRA = 10;   // extra clearance added only on the below side

  const JACK_R      = 9;         // jack outer radius
  const JACK_DOT_R  = 3;         // jack centre dot radius

  const KNOB_R        = 12;      // knob outer radius
  const KNOB_TICK_IN  = 6;       // tick line inner distance from centre
  const KNOB_TICK_OUT = 10;      // tick line outer distance from centre

  const SW_V_HW = 5;             // vertical switch half-width  (body x ± SW_V_HW)
  const SW_V_HH = 14;            // vertical switch half-height (body y ± SW_V_HH)
  const SW_H_HW = 14;            // horizontal switch half-width
  const SW_H_HH = 5;             // horizontal switch half-height

  const SLIDER_TRACK_W     = 4;   // slider track thickness (across the travel axis)
  const SLIDER_HANDLE_LEN  = 14;  // slider handle size along the travel axis
  const SLIDER_HANDLE_CROSS = 18; // slider handle size across the travel axis
  const SLIDER_DEFAULT_LEN = 80;  // slider travel length when `length` is omitted
  const SLIDER_MIN_LEN     = 20;  // shortest slider `length` the editor allows

  // Track + handle rects for a slider centred at (cx, cy). `length` is the travel
  // distance along the orientation axis; `value` (0–1, default 0.5) places the handle
  // (1 = top for vertical, 1 = right for horizontal). Shared so the live preview,
  // the exported SVG, and the patch app's DOM overlay all agree on geometry.
  function sliderRects(cx, cy, length, orientation, value) {
    const horiz = orientation === 'horizontal';
    const half = length / 2;
    const v = (value == null ? 0.5 : Math.max(0, Math.min(1, value)));
    if (horiz) {
      const hx = cx - half + v * length;
      return {
        track:  { x: cx - half, y: cy - SLIDER_TRACK_W / 2, width: length, height: SLIDER_TRACK_W },
        handle: { x: hx - SLIDER_HANDLE_LEN / 2, y: cy - SLIDER_HANDLE_CROSS / 2, width: SLIDER_HANDLE_LEN, height: SLIDER_HANDLE_CROSS },
      };
    }
    const hy = cy + half - v * length;
    return {
      track:  { x: cx - SLIDER_TRACK_W / 2, y: cy - half, width: SLIDER_TRACK_W, height: length },
      handle: { x: cx - SLIDER_HANDLE_CROSS / 2, y: hy - SLIDER_HANDLE_LEN / 2, width: SLIDER_HANDLE_CROSS, height: SLIDER_HANDLE_LEN },
    };
  }

  // Radius to hand labelPos() for a slider caption placed in direction `pos`:
  // clears the track end when the label is along the travel axis, the handle
  // otherwise.
  function sliderLabelR(length, orientation, pos) {
    const horiz = orientation === 'horizontal';
    const alongAxis = horiz ? (pos === 'left' || pos === 'right')
                            : (pos === 'above' || pos === 'below');
    return alongAxis ? length / 2 + 4 : SLIDER_HANDLE_CROSS / 2 + 2;
  }

  // ---- waveform symbol labels ----
  // A label (connection name / knob or switch label) may be the literal
  // token `wave:<name>` — or `wave:a+b` for a composite — instead of text.
  // It renders as a vector glyph here and in the exported SVG, and shows as
  // a word ("Sawtooth") in the patch editor's hover tooltips.
  // Each path is drawn in a 14 × 14 local box (centre line ~y=7) and scaled
  // to LABEL_SIZE at render time.
  const WAVE_GLYPHS = {
    sine:     'M0,7 q3.5,-6 7,0 t7,0',
    square:   'M0,12 V4 H7 V12 H14 V4',
    triangle: 'M0,12 L7,4 L14,12',
    saw:      'M0,12 L14,4 V12',
  };

  // "wave:triangle+saw" -> ['triangle','saw'];  non-token / unknown name -> null
  function parseWave(s) {
    const m = /^wave:([a-z]+(?:\+[a-z]+)*)$/.exec(String(s || '').trim());
    if (!m) return null;
    const parts = m[1].split('+');
    return parts.every(p => WAVE_GLYPHS[p]) ? parts : null;
  }

  function escXml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Returns {x, y, anchor} for a label placed in `pos` direction, `r` px from center (cx, cy).
  function labelPos(cx, cy, pos, r) {
    switch (pos) {
      case 'above': return { x: cx,               y: cy - r - LABEL_GAP,                    anchor: 'middle' };
      case 'left':  return { x: cx - r - LABEL_GAP, y: cy + Math.round(LABEL_SIZE * 0.35), anchor: 'end'    };
      case 'right': return { x: cx + r + LABEL_GAP, y: cy + Math.round(LABEL_SIZE * 0.35), anchor: 'start'  };
      default:      return { x: cx,               y: cy + r + LABEL_GAP + LABEL_BELOW_EXTRA, anchor: 'middle' }; // below
    }
  }

  // Geometry shared by the live-preview and exported wave glyph runs.
  // Returns { originX, box, s, gap } for `names` placed at label pos `lp`.
  function waveRun(names, lp) {
    const box = 14, s = LABEL_SIZE / box, gap = 3 * s;
    const runW = names.length * box * s + (names.length - 1) * gap;
    const originX = lp.anchor === 'end'    ? lp.x - runW
                  : lp.anchor === 'middle' ? lp.x - runW / 2
                  :                          lp.x;
    return { originX, box, s, gap };
  }

  // Panel artwork reuses the app's own theme tokens (css/themes.css) rather than a
  // separate artwork-only palette, so the module panel always matches the active
  // theme. Cached since module-editor's render() can run on every drag-move frame;
  // invalidated (not eagerly recomputed) on "patchbay-themechange" so the next call
  // — whenever it happens — picks up the new theme.
  let _colorsCache = null;
  function colors() {
    if (!_colorsCache) {
      const s = getComputedStyle(document.documentElement);
      const get = (name) => s.getPropertyValue(name).trim();
      _colorsCache = {
        bg: get('--bg'), panel: get('--panel'), panel2: get('--panel-2'),
        border: get('--border'), borderSoft: get('--border-soft'),
        text: get('--text'), textDim: get('--text-dim'), textFaint: get('--text-faint'),
        accent: get('--accent'), accentDim: get('--accent-dim'), danger: get('--danger'),
      };
    }
    return _colorsCache;
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('patchbay-themechange', () => { _colorsCache = null; });
  }

  // Renders a module definition — the same shape as module.json:
  // { name, width, height, connections, controls, labels } — as a static
  // SVG panel string.
  function buildSVGString(mod) {
    const c = colors();
    const W = mod.width, H = mod.height;
    const lines = [];
    lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`);
    lines.push(`  <rect x="0" y="0" width="${W}" height="${H}" fill="${c.panel2}"/>`);
    lines.push(`  <rect x="4" y="4" width="${W - 8}" height="${H - 8}" fill="none" stroke="${c.border}" stroke-width="2"/>`);
    lines.push(`  <circle cx="14" cy="14" r="4" fill="${c.bg}"/>`);
    lines.push(`  <circle cx="${W - 14}" cy="14" r="4" fill="${c.bg}"/>`);
    lines.push(`  <circle cx="14" cy="${H - 14}" r="4" fill="${c.bg}"/>`);
    lines.push(`  <circle cx="${W - 14}" cy="${H - 14}" r="4" fill="${c.bg}"/>`);
    lines.push(`  <text x="${W / 2}" y="40" text-anchor="middle" fill="${c.accent}" font-family="IBM Plex Mono, monospace" font-size="14" letter-spacing="1">${escXml((mod.name || 'UNTITLED').toUpperCase())}</text>`);

    function svgText(label, lp) {
      return `  <text x="${lp.x}" y="${lp.y}" text-anchor="${lp.anchor}" fill="${c.textDim}" font-family="IBM Plex Mono, monospace" font-size="${LABEL_SIZE}">${escXml(label)}</text>`;
    }

    function svgWave(names, lp) {
      const { originX, box, s, gap } = waveRun(names, lp);
      return names.map((n, i) =>
        `  <g transform="translate(${originX + i * (box * s + gap)},${lp.y - LABEL_SIZE}) scale(${s})">` +
        `<path d="${WAVE_GLYPHS[n]}" fill="none" stroke="${c.textDim}" stroke-width="${1.5 / s}" ` +
        `stroke-linejoin="round" stroke-linecap="round"/></g>`
      ).join('\n');
    }

    // A wave token renders as a glyph run; anything else as <text>.
    function svgLabel(label, lp) {
      const w = parseWave(label);
      return w ? svgWave(w, lp) : svgText(label, lp);
    }

    for (const conn of (mod.connections || [])) {
      lines.push(`  <circle cx="${conn.position.x}" cy="${conn.position.y}" r="${JACK_R}" fill="${c.bg}" stroke="${c.textFaint}" stroke-width="1.5"/>`);
      if (conn.name) lines.push(svgLabel(conn.name, labelPos(conn.position.x, conn.position.y, conn.labelPosition || 'below', JACK_R)));
    }

    for (const ctrl of (mod.controls || [])) {
      const cx = ctrl.position.x, cy = ctrl.position.y;
      if (ctrl.type === 'slider') {
        const len = ctrl.length || SLIDER_DEFAULT_LEN;
        const ori = (ctrl.orientation || 'vertical') === 'horizontal' ? 'horizontal' : 'vertical';
        const { track, handle } = sliderRects(cx, cy, len, ori, 0.5);
        lines.push(`  <rect x="${track.x}" y="${track.y}" width="${track.width}" height="${track.height}" rx="2" fill="${c.bg}" stroke="${c.textFaint}" stroke-width="1.5"/>`);
        lines.push(`  <rect x="${handle.x}" y="${handle.y}" width="${handle.width}" height="${handle.height}" rx="2" fill="${c.textFaint}"/>`);
        if (ctrl.label) {
          const pos = ctrl.labelPosition || 'below';
          lines.push(svgLabel(ctrl.label, labelPos(cx, cy, pos, sliderLabelR(len, ori, pos))));
        }
      } else if (ctrl.type === 'switch') {
        const horiz = (ctrl.orientation || 'vertical') === 'horizontal';
        if (horiz) {
          const bw = SW_H_HW * 2, bh = SW_H_HH * 2;
          const tw = Math.round(bw * 0.39), th = bh - 2;
          lines.push(`  <rect x="${cx - SW_H_HW}" y="${cy - SW_H_HH}" width="${bw}" height="${bh}" rx="3" fill="${c.bg}" stroke="${c.textFaint}" stroke-width="1.5"/>`);
          lines.push(`  <rect x="${cx - SW_H_HW + 2}" y="${cy - SW_H_HH + 1}" width="${tw}" height="${th}" rx="2" fill="${c.textFaint}"/>`);
          const ly = cy + Math.round(LABEL_SIZE * 0.35);
          if (ctrl.label)  lines.push(svgLabel(ctrl.label,  { x: cx - SW_H_HW - LABEL_GAP, y: ly, anchor: 'end'   }));
          if (ctrl.label2) lines.push(svgLabel(ctrl.label2, { x: cx + SW_H_HW + LABEL_GAP, y: ly, anchor: 'start' }));
        } else {
          const bw = SW_V_HW * 2, bh = SW_V_HH * 2;
          const tw = bw - 2, th = Math.round(bh * 0.39);
          lines.push(`  <rect x="${cx - SW_V_HW}" y="${cy - SW_V_HH}" width="${bw}" height="${bh}" rx="3" fill="${c.bg}" stroke="${c.textFaint}" stroke-width="1.5"/>`);
          lines.push(`  <rect x="${cx - SW_V_HW + 1}" y="${cy - SW_V_HH + 2}" width="${tw}" height="${th}" rx="2" fill="${c.textFaint}"/>`);
          if (ctrl.label)  lines.push(svgLabel(ctrl.label,  { x: cx, y: cy - SW_V_HH - LABEL_GAP,                    anchor: 'middle' }));
          if (ctrl.label2) lines.push(svgLabel(ctrl.label2, { x: cx, y: cy + SW_V_HH + LABEL_GAP + LABEL_BELOW_EXTRA, anchor: 'middle' }));
        }
      } else {
        // knob (default)
        lines.push(`  <circle cx="${cx}" cy="${cy}" r="${KNOB_R}" fill="${c.bg}" stroke="${c.textFaint}" stroke-width="1.5"/>`);
        lines.push(`  <line x1="${cx}" y1="${cy - KNOB_TICK_IN}" x2="${cx}" y2="${cy - KNOB_TICK_OUT}" stroke="${c.text}" stroke-width="1.5" stroke-linecap="round"/>`);
        if (ctrl.label) lines.push(svgLabel(ctrl.label, labelPos(cx, cy, ctrl.labelPosition || 'below', KNOB_R)));
      }
    }

    for (const lbl of (mod.labels || [])) {
      if (!lbl.text) continue;
      const size = lbl.size || LABEL_SIZE;
      const anchor = lbl.align || 'middle';
      lines.push(`  <text x="${lbl.position.x}" y="${lbl.position.y}" text-anchor="${anchor}" fill="${c.text}" font-family="IBM Plex Mono, monospace" font-size="${size}">${escXml(lbl.text)}</text>`);
    }

    lines.push(`</svg>`);
    return lines.join('\n');
  }

  window.PanelRender = {
    LABEL_SIZE, LABEL_GAP, LABEL_BELOW_EXTRA,
    JACK_R, JACK_DOT_R,
    KNOB_R, KNOB_TICK_IN, KNOB_TICK_OUT,
    SW_V_HW, SW_V_HH, SW_H_HW, SW_H_HH,
    SLIDER_TRACK_W, SLIDER_HANDLE_LEN, SLIDER_HANDLE_CROSS, SLIDER_DEFAULT_LEN, SLIDER_MIN_LEN,
    WAVE_GLYPHS, parseWave, escXml, labelPos, waveRun, sliderRects, sliderLabelR,
    colors, buildSVGString,
  };
}());
