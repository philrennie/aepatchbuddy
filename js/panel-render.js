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

  // Renders a module definition — the same shape as module.json:
  // { name, width, height, connections, controls, labels } — as a static
  // SVG panel string.
  function buildSVGString(mod) {
    const W = mod.width, H = mod.height;
    const lines = [];
    lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`);
    lines.push(`  <rect x="0" y="0" width="${W}" height="${H}" fill="#2b271f"/>`);
    lines.push(`  <rect x="4" y="4" width="${W - 8}" height="${H - 8}" fill="none" stroke="#4a4335" stroke-width="2"/>`);
    lines.push(`  <circle cx="14" cy="14" r="4" fill="#141210"/>`);
    lines.push(`  <circle cx="${W - 14}" cy="14" r="4" fill="#141210"/>`);
    lines.push(`  <circle cx="14" cy="${H - 14}" r="4" fill="#141210"/>`);
    lines.push(`  <circle cx="${W - 14}" cy="${H - 14}" r="4" fill="#141210"/>`);
    lines.push(`  <text x="${W / 2}" y="40" text-anchor="middle" fill="#e8a33d" font-family="IBM Plex Mono, monospace" font-size="14" letter-spacing="1">${escXml((mod.name || 'UNTITLED').toUpperCase())}</text>`);

    function svgText(label, lp) {
      return `  <text x="${lp.x}" y="${lp.y}" text-anchor="${lp.anchor}" fill="#9a9282" font-family="IBM Plex Mono, monospace" font-size="${LABEL_SIZE}">${escXml(label)}</text>`;
    }

    function svgWave(names, lp) {
      const { originX, box, s, gap } = waveRun(names, lp);
      return names.map((n, i) =>
        `  <g transform="translate(${originX + i * (box * s + gap)},${lp.y - LABEL_SIZE}) scale(${s})">` +
        `<path d="${WAVE_GLYPHS[n]}" fill="none" stroke="#9a9282" stroke-width="${1.5 / s}" ` +
        `stroke-linejoin="round" stroke-linecap="round"/></g>`
      ).join('\n');
    }

    // A wave token renders as a glyph run; anything else as <text>.
    function svgLabel(label, lp) {
      const w = parseWave(label);
      return w ? svgWave(w, lp) : svgText(label, lp);
    }

    for (const c of (mod.connections || [])) {
      lines.push(`  <circle cx="${c.position.x}" cy="${c.position.y}" r="${JACK_R}" fill="#141210" stroke="#8a8270" stroke-width="1.5"/>`);
      if (c.name) lines.push(svgLabel(c.name, labelPos(c.position.x, c.position.y, c.labelPosition || 'below', JACK_R)));
    }

    for (const c of (mod.controls || [])) {
      const cx = c.position.x, cy = c.position.y;
      if (c.type === 'switch') {
        const horiz = (c.orientation || 'vertical') === 'horizontal';
        if (horiz) {
          const bw = SW_H_HW * 2, bh = SW_H_HH * 2;
          const tw = Math.round(bw * 0.39), th = bh - 2;
          lines.push(`  <rect x="${cx - SW_H_HW}" y="${cy - SW_H_HH}" width="${bw}" height="${bh}" rx="3" fill="#1e1c18" stroke="#8a8270" stroke-width="1.5"/>`);
          lines.push(`  <rect x="${cx - SW_H_HW + 2}" y="${cy - SW_H_HH + 1}" width="${tw}" height="${th}" rx="2" fill="#8a8270"/>`);
          const ly = cy + Math.round(LABEL_SIZE * 0.35);
          if (c.label)  lines.push(svgLabel(c.label,  { x: cx - SW_H_HW - LABEL_GAP, y: ly, anchor: 'end'   }));
          if (c.label2) lines.push(svgLabel(c.label2, { x: cx + SW_H_HW + LABEL_GAP, y: ly, anchor: 'start' }));
        } else {
          const bw = SW_V_HW * 2, bh = SW_V_HH * 2;
          const tw = bw - 2, th = Math.round(bh * 0.39);
          lines.push(`  <rect x="${cx - SW_V_HW}" y="${cy - SW_V_HH}" width="${bw}" height="${bh}" rx="3" fill="#1e1c18" stroke="#8a8270" stroke-width="1.5"/>`);
          lines.push(`  <rect x="${cx - SW_V_HW + 1}" y="${cy - SW_V_HH + 2}" width="${tw}" height="${th}" rx="2" fill="#8a8270"/>`);
          if (c.label)  lines.push(svgLabel(c.label,  { x: cx, y: cy - SW_V_HH - LABEL_GAP,                    anchor: 'middle' }));
          if (c.label2) lines.push(svgLabel(c.label2, { x: cx, y: cy + SW_V_HH + LABEL_GAP + LABEL_BELOW_EXTRA, anchor: 'middle' }));
        }
      } else {
        // knob (default)
        lines.push(`  <circle cx="${cx}" cy="${cy}" r="${KNOB_R}" fill="#1e1c18" stroke="#8a8270" stroke-width="1.5"/>`);
        lines.push(`  <line x1="${cx}" y1="${cy - KNOB_TICK_IN}" x2="${cx}" y2="${cy - KNOB_TICK_OUT}" stroke="#c8bfaa" stroke-width="1.5" stroke-linecap="round"/>`);
        if (c.label) lines.push(svgLabel(c.label, labelPos(cx, cy, c.labelPosition || 'below', KNOB_R)));
      }
    }

    for (const c of (mod.labels || [])) {
      if (!c.text) continue;
      const size = c.size || LABEL_SIZE;
      const anchor = c.align || 'middle';
      lines.push(`  <text x="${c.position.x}" y="${c.position.y}" text-anchor="${anchor}" fill="#c8bfaa" font-family="IBM Plex Mono, monospace" font-size="${size}">${escXml(c.text)}</text>`);
    }

    lines.push(`</svg>`);
    return lines.join('\n');
  }

  window.PanelRender = {
    LABEL_SIZE, LABEL_GAP, LABEL_BELOW_EXTRA,
    JACK_R, JACK_DOT_R,
    KNOB_R, KNOB_TICK_IN, KNOB_TICK_OUT,
    SW_V_HW, SW_V_HH, SW_H_HW, SW_H_HH,
    WAVE_GLYPHS, parseWave, escXml, labelPos, waveRun,
    buildSVGString,
  };
}());
