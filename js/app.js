/* ==========================================================================
   Patch Bay — AE Modular patch documentation tool
   Vanilla JS, no build step. Static-hostable (e.g. GitHub Pages).
   ========================================================================== */

(() => {
  "use strict";

  /* ---------------------------------------------------------------------
     Config
  --------------------------------------------------------------------- */

  const MODULE_LIBRARY_URL = "data/modules.json";
  const MODULE_SCALE = 0.896;          // native image px -> on-screen px
  const ZOOM_MIN = 0.25, ZOOM_MAX = 2.0, ZOOM_STEP = 0.1;
  const CABLE_COLORS = ["#e8a33d", "#5fc9c0", "#d97b9e", "#a8c957", "#9b8ad9", "#e0846b"];

  const STORAGE_KEY     = "patchbay-patch";
  const STORAGE_VERSION = 1;
  // Increment STORAGE_VERSION when the saved schema changes in a way that
  // would break loading older saves; stale data is silently discarded.

  /* ---------------------------------------------------------------------
     State
  --------------------------------------------------------------------- */

  /** @type {Map<string, object>} moduleId -> module definition */
  const libraryById = new Map();
  let library = [];

  const rack = {
    instances: new Map(),   // instanceId -> {id, moduleId, x, y}
    cables: new Map(),      // cableId -> {id, from:{instanceId,connector}, to:{instanceId,connector}, color}
  };

  let zoom = 1;
  let panX = 0, panY = 0;
  let cableColorCursor = 0;
  let selectedCableId = null;
  let patchName = "";

  // transient drag state
  let dragCtx = null;        // instance drag
  let connectCtx = null;     // cable-being-drawn drag
  let knobDragCtx = null;    // knob rotation drag
  let panCtx = null;         // canvas pan drag
  let saveTimer = null;      // debounce handle for localStorage writes

  /* ---------------------------------------------------------------------
     DOM refs
  --------------------------------------------------------------------- */

  const el = {
    moduleList: document.getElementById("module-list"),
    moduleSearch: document.getElementById("module-search"),
    rackViewport: document.getElementById("rack-viewport"),
    rackCanvas: document.getElementById("rack-canvas"),
    instanceLayer: document.getElementById("instance-layer"),
    cableLayer: document.getElementById("cable-layer"),
    jackLayer: document.getElementById("jack-layer"),
    emptyHint: document.getElementById("empty-hint"),
    zoomLabel: document.getElementById("zoom-label"),
    btnZoomIn: document.getElementById("btn-zoom-in"),
    btnZoomOut: document.getElementById("btn-zoom-out"),
    btnClear: document.getElementById("btn-clear"),
    btnExport: document.getElementById("btn-export"),
    btnImport: document.getElementById("btn-import"),
    fileImport: document.getElementById("file-import"),
    toast: document.getElementById("toast"),
    patchName: document.getElementById("patch-name"),
  };

  /* ---------------------------------------------------------------------
     Utilities
  --------------------------------------------------------------------- */

  function uid(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
  }

  // A label may be the token `wave:<name>` (or `wave:a+b` for a composite) —
  // the module SVG draws the actual glyph; here we only need a readable word
  // for the hover tooltips.
  const WAVE_WORDS = { sine: "Sine", square: "Square", triangle: "Triangle", saw: "Sawtooth" };
  function labelText(s) {
    const m = /^wave:([a-z]+(?:\+[a-z]+)*)$/.exec(String(s || ""));
    if (!m) return s;
    return m[1].split("+").map((p) => WAVE_WORDS[p] || p).join(" + ");
  }

  function nextCableColor() {
    const c = CABLE_COLORS[cableColorCursor % CABLE_COLORS.length];
    cableColorCursor++;
    return c;
  }

  let toastTimer = null;
  function toast(msg, isError = false) {
    el.toast.textContent = msg;
    el.toast.classList.toggle("error", isError);
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3200);
  }

  function slugify(str) {
    return str
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function updatePageTitle() {
    document.title = patchName ? `${patchName} — Patch Bay` : "Patch Bay — AE Modular patch documentation";
  }

  el.patchName.addEventListener("input", () => {
    patchName = el.patchName.value;
    updatePageTitle();
    saveToStorage();
  });

  function moduleDisplaySize(mod) {
    return { w: mod.width * MODULE_SCALE, h: mod.height * MODULE_SCALE };
  }

  // Modules with a static module.svg use it directly; modules without one (no `image`
  // field) get their panel generated inline via the shared renderer (js/panel-render.js),
  // memoized on the module object so it's only built once regardless of instance count.
  function moduleImageSrc(mod) {
    if (mod.image) return mod.image;
    if (!mod._generatedImage) {
      const svg = PanelRender.buildSVGString(mod);
      mod._generatedImage = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    }
    return mod._generatedImage;
  }

  function jackCanvasPos(instance, connector) {
    const mod = libraryById.get(instance.moduleId);
    return {
      x: instance.x + connector.position.x * MODULE_SCALE,
      y: instance.y + connector.position.y * MODULE_SCALE,
    };
  }

  function canvasPointFromClient(clientX, clientY) {
    const rect = el.rackViewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - panX) / zoom,
      y: (clientY - rect.top  - panY) / zoom,
    };
  }

  /* ---------------------------------------------------------------------
     Library loading + sidebar
  --------------------------------------------------------------------- */

  async function loadLibrary() {
    try {
      const res = await fetch(MODULE_LIBRARY_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      library = await res.json();
    } catch (err) {
      console.error("Failed to load module library:", err);
      el.moduleList.innerHTML = `<div class="no-results">Couldn't load data/modules.json.<br>If you opened this file directly, serve it over a local server instead (see README).</div>`;
      return;
    }
    libraryById.clear();
    for (const mod of library) libraryById.set(mod.id, mod);
    renderModuleList("");
    loadFromStorage();
  }

  function renderModuleList(filterText) {
    const q = filterText.trim().toLowerCase();
    const filtered = q
      ? library.filter((m) =>
          m.name.toLowerCase().includes(q) ||
          (m.manufacturer && m.manufacturer.toLowerCase().includes(q)))
      : library;

    el.moduleList.innerHTML = "";

    if (filtered.length === 0) {
      el.moduleList.innerHTML = `<div class="no-results">No modules match “${escapeHtml(filterText)}”.</div>`;
      return;
    }

    for (const mod of filtered) {
      const row = document.createElement("div");
      row.className = "module-row";
      row.draggable = true;
      row.dataset.moduleId = mod.id;

      const thumb = document.createElement("img");
      thumb.className = "module-thumb";
      thumb.src = moduleImageSrc(mod);
      thumb.alt = mod.name;
      thumb.loading = "lazy";

      const meta = document.createElement("div");
      const mfr = mod.manufacturer ? `<div class="module-row-manufacturer">${escapeHtml(mod.manufacturer)}</div>` : "";
      const nameHtml = mod.url
        ? `<a class="module-row-name module-row-name-link" href="${escapeHtml(mod.url)}" target="_blank" rel="noopener" title="View product page" onclick="event.stopPropagation()">${escapeHtml(mod.name)}</a>`
        : `<div class="module-row-name">${escapeHtml(mod.name)}</div>`;
      meta.innerHTML = `${nameHtml}${mfr}<div class="module-row-meta">${mod.connections.length} jack${mod.connections.length === 1 ? "" : "s"}</div>`;

      row.appendChild(thumb);
      row.appendChild(meta);
      el.moduleList.appendChild(row);

      row.addEventListener("click", () => {
        const viewCenter = canvasPointFromClient(
          el.rackViewport.getBoundingClientRect().left + el.rackViewport.clientWidth / 2,
          el.rackViewport.getBoundingClientRect().top + el.rackViewport.clientHeight / 2
        );
        const jitter = (Math.random() - 0.5) * 40;
        addInstance(mod.id, viewCenter.x + jitter - moduleDisplaySize(mod).w / 2, viewCenter.y + jitter - moduleDisplaySize(mod).h / 2);
      });

      row.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", mod.id);
        e.dataTransfer.effectAllowed = "copy";
      });
    }
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  el.moduleSearch.addEventListener("input", () => renderModuleList(el.moduleSearch.value));

  /* ---------------------------------------------------------------------
     Drop target (drag modules from sidebar onto rack)
  --------------------------------------------------------------------- */

  el.rackViewport.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });

  el.rackViewport.addEventListener("drop", (e) => {
    e.preventDefault();
    const moduleId = e.dataTransfer.getData("text/plain");
    if (!libraryById.has(moduleId)) return;
    const mod = libraryById.get(moduleId);
    const pt = canvasPointFromClient(e.clientX, e.clientY);
    const size = moduleDisplaySize(mod);
    addInstance(moduleId, pt.x - size.w / 2, pt.y - size.h / 2);
  });

  /* ---------------------------------------------------------------------
     Instances
  --------------------------------------------------------------------- */

  function addInstance(moduleId, x, y) {
    const mod = libraryById.get(moduleId);
    if (!mod) return;
    const inst = { id: uid("inst"), moduleId, x: Math.max(0, x), y: Math.max(0, y), controls: {} };
    rack.instances.set(inst.id, inst);
    renderAll();
  }

  function removeInstance(instanceId) {
    rack.instances.delete(instanceId);
    for (const [cid, cable] of rack.cables) {
      if (cable.from.instanceId === instanceId || cable.to.instanceId === instanceId) {
        rack.cables.delete(cid);
      }
    }
    if (selectedCableId && !rack.cables.has(selectedCableId)) selectedCableId = null;
    renderAll();
  }

  function clearRack() {
    if (rack.instances.size === 0) return;
    if (!confirm("Clear the entire rack? This removes all modules and cables.")) return;
    rack.instances.clear();
    rack.cables.clear();
    selectedCableId = null;
    renderAll();
  }

  /* ---------------------------------------------------------------------
     Rendering
  --------------------------------------------------------------------- */

  function renderAll() {
    renderInstances();
    renderCables();
    el.emptyHint.style.display = rack.instances.size === 0 ? "block" : "none";
    saveToStorage();
  }

  function renderInstances() {
    el.instanceLayer.innerHTML = "";
    el.jackLayer.innerHTML = "";
    for (const inst of rack.instances.values()) {
      el.instanceLayer.appendChild(buildInstanceEl(inst));
      el.jackLayer.appendChild(buildJackEl(inst));
    }
  }

  // Unique key for a connection: uses the explicit id field when present, falls back
  // to name (safe for modules where all names are unique, breaks for duplicates).
  function connectorKey(conn) { return conn.id !== undefined ? conn.id : conn.name; }

  // Find a connection in a module by the key stored in cable.from/to.connector.
  function findConnection(mod, key) {
    return mod.connections.find(c => connectorKey(c) === key);
  }

  function connectedJackColor(instanceId, key) {
    for (const cable of rack.cables.values()) {
      if (cable.from.instanceId === instanceId && cable.from.connector === key) return cable.color;
      if (cable.to.instanceId === instanceId && cable.to.connector === key) return cable.color;
    }
    return null;
  }

  function buildInstanceEl(inst) {
    const mod = libraryById.get(inst.moduleId);
    const size = moduleDisplaySize(mod);

    const wrap = document.createElement("div");
    wrap.className = "instance";
    wrap.dataset.instanceId = inst.id;
    wrap.style.left = `${inst.x}px`;
    wrap.style.top = `${inst.y}px`;
    wrap.style.width = `${size.w}px`;
    wrap.style.height = `${size.h}px`;

    const img = document.createElement("img");
    img.src = moduleImageSrc(mod);
    img.alt = mod.name;
    wrap.appendChild(img);

    const removeBtn = document.createElement("div");
    removeBtn.className = "instance-remove";
    removeBtn.title = "Remove module";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeInstance(inst.id);
    });
    wrap.appendChild(removeBtn);

    if (mod.url) {
      const linkBtn = document.createElement("a");
      linkBtn.className = "instance-link";
      linkBtn.href = mod.url;
      linkBtn.target = "_blank";
      linkBtn.rel = "noopener";
      linkBtn.title = mod.manufacturer ? `View on ${mod.manufacturer}` : "View product page";
      linkBtn.textContent = "↗";
      linkBtn.addEventListener("mousedown", (e) => e.stopPropagation());
      linkBtn.addEventListener("click", (e) => e.stopPropagation());
      wrap.appendChild(linkBtn);
    }

    if (mod.documentation) {
      const docsBtn = document.createElement("a");
      docsBtn.className = "instance-link instance-link-docs";
      docsBtn.href = mod.documentation;
      docsBtn.target = "_blank";
      docsBtn.rel = "noopener";
      docsBtn.title = "View documentation";
      docsBtn.textContent = "?";
      docsBtn.addEventListener("mousedown", (e) => e.stopPropagation());
      docsBtn.addEventListener("click", (e) => e.stopPropagation());
      wrap.appendChild(docsBtn);
    }

    wrap.addEventListener("mousedown", onInstanceMouseDown);
    return wrap;
  }

  function buildJackEl(inst) {
    const mod = libraryById.get(inst.moduleId);
    const size = moduleDisplaySize(mod);

    const anchor = document.createElement("div");
    anchor.className = "jack-anchor";
    anchor.dataset.instanceId = inst.id;
    anchor.style.left = `${inst.x}px`;
    anchor.style.top = `${inst.y}px`;
    anchor.style.width = `${size.w}px`;
    anchor.style.height = `${size.h}px`;

    for (const conn of mod.connections) {
      const jack = document.createElement("div");
      jack.className = "jack";
      jack.dataset.instanceId = inst.id;
      jack.dataset.connector = connectorKey(conn);
      jack.style.left = `${conn.position.x * MODULE_SCALE}px`;
      jack.style.top = `${conn.position.y * MODULE_SCALE}px`;

      const color = connectedJackColor(inst.id, connectorKey(conn));
      if (color) {
        jack.classList.add("jack-connected");
        jack.style.setProperty("--jack-color", color);
      }

      const label = document.createElement("div");
      label.className = "jack-label";
      label.textContent = labelText(conn.name);
      jack.appendChild(label);

      jack.addEventListener("mousedown", onJackMouseDown);
      anchor.appendChild(jack);
    }

    for (const ctrl of (mod.controls || [])) {
      const px = ctrl.position.x * MODULE_SCALE;
      const py = ctrl.position.y * MODULE_SCALE;
      const value = (inst.controls[ctrl.id] !== undefined) ? inst.controls[ctrl.id] : (ctrl.type === 'knob' ? 0.5 : 0);
      const ctrlEl = ctrl.type === 'knob'
        ? buildKnobControl(inst.id, ctrl, value, px, py)
        : buildSwitchControl(inst.id, ctrl, value, px, py);
      anchor.appendChild(ctrlEl);
    }

    return anchor;
  }

  function buildKnobControl(instanceId, ctrl, value, px, py) {
    const div = document.createElement("div");
    div.className = "knob-control";
    div.dataset.instanceId = instanceId;
    div.dataset.controlId = ctrl.id;
    div.style.left = `${px}px`;
    div.style.top = `${py}px`;
    div.title = labelText(ctrl.label) || ctrl.id;

    const body = document.createElement("div");
    body.className = "knob-body";

    const ring = document.createElement("div");
    ring.className = "knob-ring";
    ring.style.transform = `rotate(${(value - 0.5) * 270}deg)`;

    body.appendChild(ring);
    div.appendChild(body);
    div.addEventListener("mousedown", onKnobMouseDown);
    return div;
  }

  function buildSwitchControl(instanceId, ctrl, value, px, py) {
    const horiz = (ctrl.orientation || "vertical") === "horizontal";
    const bw = horiz ? 26 : 12;
    const bh = horiz ? 12 : 26;

    const div = document.createElement("div");
    div.className = "switch-control" + (value ? " switch-on" : "");
    div.dataset.instanceId = instanceId;
    div.dataset.controlId = ctrl.id;
    div.style.left = `${px}px`;
    div.style.top = `${py}px`;
    div.style.width = `${bw}px`;
    div.style.height = `${bh}px`;
    div.style.marginLeft = `${-bw / 2}px`;
    div.style.marginTop = `${-bh / 2}px`;
    div.title = value ? (labelText(ctrl.label2) || "1") : (labelText(ctrl.label) || "0");

    const body = document.createElement("div");
    body.className = "switch-body";

    const handle = document.createElement("div");
    handle.className = "switch-handle";
    if (horiz) {
      const hw = Math.round(bw * 0.4);
      handle.style.width = `${hw}px`;
      handle.style.height = `${bh - 4}px`;
      handle.style.top = "1px";
      handle.style.left = value ? `${bw - hw - 3}px` : "1px";
    } else {
      const hh = Math.round(bh * 0.4);
      handle.style.width = `${bw - 4}px`;
      handle.style.height = `${hh}px`;
      handle.style.left = "1px";
      handle.style.top = value ? `${bh - hh - 3}px` : "1px";
    }

    body.appendChild(handle);
    div.appendChild(body);
    div.addEventListener("click", (e) => {
      e.stopPropagation();
      onSwitchClick(instanceId, ctrl.id);
    });
    return div;
  }

  function renderCables() {
    el.cableLayer.innerHTML = "";
    for (const cable of rack.cables.values()) {
      el.cableLayer.appendChild(buildCablePath(cable));
    }
  }

  // slack (0.75–1.4) scales the cable's droop; higher = longer cable = more sag.
  function cableSag(p1, p2, slack = 1.0) {
    return Math.max(30, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.3) * slack;
  }

  function bezierPath(p1, p2, slack = 1.0) {
    const sag = cableSag(p1, p2, slack);
    return `M ${p1.x} ${p1.y} C ${p1.x} ${p1.y + sag}, ${p2.x} ${p2.y + sag}, ${p2.x} ${p2.y}`;
  }

  function cableMidpoint(p1, p2, slack = 1.0) {
    const sag = cableSag(p1, p2, slack);
    return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 + 0.75 * sag };
  }

  function buildCablePath(cable) {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.dataset.cableId = cable.id;

    const fromInst = rack.instances.get(cable.from.instanceId);
    const toInst = rack.instances.get(cable.to.instanceId);
    if (!fromInst || !toInst) return g;

    const fromMod = libraryById.get(fromInst.moduleId);
    const toMod = libraryById.get(toInst.moduleId);
    const fromConn = findConnection(fromMod, cable.from.connector);
    const toConn   = findConnection(toMod,   cable.to.connector);
    if (!fromConn || !toConn) return g;

    const p1 = jackCanvasPos(fromInst, fromConn);
    const p2 = jackCanvasPos(toInst, toConn);
    const d = bezierPath(p1, p2, cable.slack);

    const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hit.setAttribute("d", d);
    hit.setAttribute("class", "cable-hit");
    g.appendChild(hit);

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("class", "cable-path" + (cable.id === selectedCableId ? " selected" : ""));
    path.setAttribute("stroke", cable.color);
    g.appendChild(path);

    // Solid dot at each end, drawn on top of the jack, so the exact
    // connector a cable lands on is unambiguous even with several cables
    // converging near the same module.
    for (const p of [p1, p2]) {
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", p.x);
      dot.setAttribute("cy", p.y);
      dot.setAttribute("r", 5);
      dot.setAttribute("class", "cable-endpoint");
      dot.setAttribute("fill", cable.color);
      dot.style.pointerEvents = "none";
      g.appendChild(dot);
    }

    [hit, path].forEach((node) => {
      node.style.pointerEvents = "stroke";
      node.addEventListener("click", (e) => {
        e.stopPropagation();
        selectCable(cable.id);
      });
    });

    if (cable.id === selectedCableId) {
      const mid = cableMidpoint(p1, p2, cable.slack);
      const del = document.createElementNS("http://www.w3.org/2000/svg", "g");
      del.setAttribute("class", "cable-delete-btn");
      del.style.pointerEvents = "auto";
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", mid.x);
      circle.setAttribute("cy", mid.y);
      circle.setAttribute("r", 10);
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", mid.x);
      text.setAttribute("y", mid.y + 1);
      text.textContent = "×";
      del.appendChild(circle);
      del.appendChild(text);
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        removeCable(cable.id);
      });
      g.appendChild(del);
    }

    return g;
  }

  function selectCable(cableId) {
    selectedCableId = cableId;
    renderCables();
  }

  function removeCable(cableId) {
    rack.cables.delete(cableId);
    if (selectedCableId === cableId) selectedCableId = null;
    renderAll();
  }

  el.rackViewport.addEventListener("click", () => {
    if (selectedCableId) {
      selectedCableId = null;
      renderCables();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (["Delete", "Backspace"].includes(e.key) && selectedCableId) {
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
      removeCable(selectedCableId);
    }
  });

  /* ---------------------------------------------------------------------
     Instance dragging
  --------------------------------------------------------------------- */

  function onInstanceMouseDown(e) {
    if (e.target.closest(".jack") || e.target.closest(".instance-remove") || e.target.closest(".instance-link")) return;
    e.preventDefault();
    const wrap = e.currentTarget;
    const instanceId = wrap.dataset.instanceId;
    const inst = rack.instances.get(instanceId);
    const pt = canvasPointFromClient(e.clientX, e.clientY);

    dragCtx = {
      instanceId,
      offsetX: pt.x - inst.x,
      offsetY: pt.y - inst.y,
      el: wrap,
      jackAnchorEl: el.jackLayer.querySelector(`.jack-anchor[data-instance-id="${instanceId}"]`),
    };
    wrap.classList.add("dragging");

    document.addEventListener("mousemove", onInstanceMouseMove);
    document.addEventListener("mouseup", onInstanceMouseUp);
  }

  function onInstanceMouseMove(e) {
    if (!dragCtx) return;
    const inst = rack.instances.get(dragCtx.instanceId);
    if (!inst) return;
    const pt = canvasPointFromClient(e.clientX, e.clientY);
    inst.x = Math.max(0, pt.x - dragCtx.offsetX);
    inst.y = Math.max(0, pt.y - dragCtx.offsetY);
    dragCtx.el.style.left = `${inst.x}px`;
    dragCtx.el.style.top = `${inst.y}px`;
    if (dragCtx.jackAnchorEl) {
      dragCtx.jackAnchorEl.style.left = `${inst.x}px`;
      dragCtx.jackAnchorEl.style.top = `${inst.y}px`;
    }
    renderCables();
  }

  function onInstanceMouseUp() {
    if (dragCtx) dragCtx.el.classList.remove("dragging");
    dragCtx = null;
    document.removeEventListener("mousemove", onInstanceMouseMove);
    document.removeEventListener("mouseup", onInstanceMouseUp);
  }

  /* ---------------------------------------------------------------------
     Knob and switch control interaction
  --------------------------------------------------------------------- */

  function onKnobMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();
    const div = e.currentTarget;
    const instanceId = div.dataset.instanceId;
    const controlId = div.dataset.controlId;
    const inst = rack.instances.get(instanceId);
    if (!inst) return;
    const value = inst.controls[controlId] !== undefined ? inst.controls[controlId] : 0.5;
    knobDragCtx = { instanceId, controlId, startY: e.clientY, startValue: value, el: div };
    div.classList.add("knob-active");
    document.addEventListener("mousemove", onKnobMouseMove);
    document.addEventListener("mouseup", onKnobMouseUp);
  }

  function onKnobMouseMove(e) {
    if (!knobDragCtx) return;
    const inst = rack.instances.get(knobDragCtx.instanceId);
    if (!inst) return;
    const delta = (knobDragCtx.startY - e.clientY) / 200;
    const newValue = Math.max(0, Math.min(1, knobDragCtx.startValue + delta));
    inst.controls[knobDragCtx.controlId] = newValue;
    const ring = knobDragCtx.el.querySelector(".knob-ring");
    if (ring) ring.style.transform = `rotate(${(newValue - 0.5) * 270}deg)`;
  }

  function onKnobMouseUp() {
    if (knobDragCtx) knobDragCtx.el.classList.remove("knob-active");
    knobDragCtx = null;
    document.removeEventListener("mousemove", onKnobMouseMove);
    document.removeEventListener("mouseup", onKnobMouseUp);
  }

  function onSwitchClick(instanceId, controlId) {
    const inst = rack.instances.get(instanceId);
    if (!inst) return;
    inst.controls[controlId] = inst.controls[controlId] ? 0 : 1;
    renderAll();
  }

  /* ---------------------------------------------------------------------
     Cable dragging (jack -> jack)
  --------------------------------------------------------------------- */

  function onJackMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();
    const jackEl = e.currentTarget;
    const instanceId = jackEl.dataset.instanceId;
    const connector = jackEl.dataset.connector;

    jackEl.classList.add("jack-active");

    const tempPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    tempPath.setAttribute("class", "cable-temp");

    // Find the most-recently-added cable at this jack, if any
    let existing = null;
    for (const c of rack.cables.values()) {
      if ((c.from.instanceId === instanceId && c.from.connector === connector) ||
          (c.to.instanceId === instanceId && c.to.connector === connector)) {
        existing = c;
      }
    }

    if (existing) {
      // Pick up the cable: anchor stays at the OTHER end, dragged end follows mouse
      const isFrom = existing.from.instanceId === instanceId && existing.from.connector === connector;
      const fixedEnd = isFrom ? existing.to : existing.from;
      const fixedInst = rack.instances.get(fixedEnd.instanceId);
      const fixedConn = findConnection(libraryById.get(fixedInst.moduleId), fixedEnd.connector);

      tempPath.style.stroke = existing.color;
      rack.cables.delete(existing.id);
      renderAll();
      // Append after renderAll — renderCables wipes innerHTML so any earlier append is lost
      el.cableLayer.appendChild(tempPath);

      connectCtx = {
        instanceId: fixedEnd.instanceId,
        connector: fixedEnd.connector,
        start: jackCanvasPos(fixedInst, fixedConn),
        tempPath,
        jackEl,
        rerouteId: existing.id,
        rerouteColor: existing.color,
        rerouteSlack: existing.slack,
        rerouteOrigFrom: existing.from,
        rerouteOrigTo: existing.to,
      };
    } else {
      el.cableLayer.appendChild(tempPath);
      const inst = rack.instances.get(instanceId);
      const conn = findConnection(libraryById.get(inst.moduleId), connector);
      connectCtx = { instanceId, connector, start: jackCanvasPos(inst, conn), tempPath, jackEl };
    }

    document.addEventListener("mousemove", onJackMouseMove);
    document.addEventListener("mouseup", onJackMouseUp);
  }

  function onJackMouseMove(e) {
    if (!connectCtx) return;
    const pt = canvasPointFromClient(e.clientX, e.clientY);
    connectCtx.tempPath.setAttribute("d", bezierPath(connectCtx.start, pt));
  }

  function onJackMouseUp(e) {
    if (!connectCtx) return;
    connectCtx.jackEl.classList.remove("jack-active");
    connectCtx.tempPath.remove();

    const targetJack = document.elementsFromPoint(e.clientX, e.clientY)
      .map(el => el.closest?.(".jack"))
      .find(Boolean);

    if (connectCtx.rerouteId) {
      // Re-routing: place at new jack or restore to original position
      let replacement = null;
      if (targetJack) {
        const toInstanceId = targetJack.dataset.instanceId;
        const toConnector = targetJack.dataset.connector;
        const sameAsFixed = toInstanceId === connectCtx.instanceId && toConnector === connectCtx.connector;
        if (!sameAsFixed) {
          replacement = {
            id: connectCtx.rerouteId,
            from: { instanceId: connectCtx.instanceId, connector: connectCtx.connector },
            to: { instanceId: toInstanceId, connector: toConnector },
            color: connectCtx.rerouteColor,
            slack: connectCtx.rerouteSlack,
          };
        }
      }
      rack.cables.set(connectCtx.rerouteId, replacement ?? {
        id: connectCtx.rerouteId,
        from: connectCtx.rerouteOrigFrom,
        to: connectCtx.rerouteOrigTo,
        color: connectCtx.rerouteColor,
        slack: connectCtx.rerouteSlack,
      });
      renderAll();
    } else {
      if (targetJack) {
        const toInstanceId = targetJack.dataset.instanceId;
        const toConnector = targetJack.dataset.connector;
        const sameJack = toInstanceId === connectCtx.instanceId && toConnector === connectCtx.connector;
        if (!sameJack) {
          createCable(
            { instanceId: connectCtx.instanceId, connector: connectCtx.connector },
            { instanceId: toInstanceId, connector: toConnector }
          );
        }
      }
    }

    connectCtx = null;
    document.removeEventListener("mousemove", onJackMouseMove);
    document.removeEventListener("mouseup", onJackMouseUp);
  }

  function createCable(from, to) {
    // avoid an exact duplicate of an existing cable (either direction)
    for (const c of rack.cables.values()) {
      const a = c.from, b = c.to;
      const matchesForward = a.instanceId === from.instanceId && a.connector === from.connector && b.instanceId === to.instanceId && b.connector === to.connector;
      const matchesReverse = a.instanceId === to.instanceId && a.connector === to.connector && b.instanceId === from.instanceId && b.connector === from.connector;
      if (matchesForward || matchesReverse) {
        toast("That connection already exists.");
        return;
      }
    }
    const cable = { id: uid("cbl"), from, to, color: nextCableColor(), slack: 0.75 + Math.random() * 0.65 };
    rack.cables.set(cable.id, cable);
    renderAll();
  }

  /* ---------------------------------------------------------------------
     Zoom + pan
  --------------------------------------------------------------------- */

  function applyZoom() {
    el.rackCanvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    el.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  function zoomBy(delta, cx, cy) {
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +(zoom + delta).toFixed(2)));
    if (newZoom === zoom) return;
    const ratio = newZoom / zoom;
    panX = cx - (cx - panX) * ratio;
    panY = cy - (cy - panY) * ratio;
    zoom = newZoom;
    applyZoom();
  }

  el.btnZoomIn.addEventListener("click", () => {
    const r = el.rackViewport.getBoundingClientRect();
    zoomBy(ZOOM_STEP, r.width / 2, r.height / 2);
  });
  el.btnZoomOut.addEventListener("click", () => {
    const r = el.rackViewport.getBoundingClientRect();
    zoomBy(-ZOOM_STEP, r.width / 2, r.height / 2);
  });

  el.rackViewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = el.rackViewport.getBoundingClientRect();
    zoomBy(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  el.rackViewport.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".instance") || e.target.closest(".jack") ||
        e.target.closest(".knob-control") || e.target.closest(".switch-control") ||
        e.target.closest("[data-cable-id]")) return;
    e.preventDefault();
    panCtx = { startX: e.clientX - panX, startY: e.clientY - panY };
    el.rackViewport.classList.add("panning");
  });

  document.addEventListener("mousemove", (e) => {
    if (!panCtx) return;
    panX = e.clientX - panCtx.startX;
    panY = e.clientY - panCtx.startY;
    applyZoom();
  });

  document.addEventListener("mouseup", () => {
    if (!panCtx) return;
    panCtx = null;
    el.rackViewport.classList.remove("panning");
  });

  /* ---------------------------------------------------------------------
     localStorage persistence
  --------------------------------------------------------------------- */

  function saveToStorage() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          version: STORAGE_VERSION,
          name: patchName,
          zoom, panX, panY,
          cableColorCursor,
          instances: Array.from(rack.instances.values()).map((i) => ({
            id: i.id, moduleId: i.moduleId, x: Math.round(i.x), y: Math.round(i.y),
            controls: i.controls || {},
          })),
          cables: Array.from(rack.cables.values()).map((c) => ({
            id: c.id, from: c.from, to: c.to, color: c.color, slack: c.slack,
          })),
        }));
      } catch (_) {}
    }, 400);
  }

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (!s || s.version !== STORAGE_VERSION) return;
      if (!Array.isArray(s.instances) || !Array.isArray(s.cables)) return;

      const newInstances = new Map();
      for (const inst of s.instances) {
        if (!libraryById.has(inst.moduleId)) continue;
        newInstances.set(inst.id, {
          id: inst.id, moduleId: inst.moduleId, x: inst.x || 0, y: inst.y || 0,
          controls: (inst.controls && typeof inst.controls === "object") ? inst.controls : {},
        });
      }
      const newCables = new Map();
      for (const cable of s.cables) {
        if (!cable.from || !cable.to) continue;
        if (!newInstances.has(cable.from.instanceId) || !newInstances.has(cable.to.instanceId)) continue;
        newCables.set(cable.id, {
          id: cable.id, from: cable.from, to: cable.to,
          color: cable.color || nextCableColor(),
          slack: typeof cable.slack === "number" ? cable.slack : 0.75 + Math.random() * 0.65,
        });
      }

      rack.instances = newInstances;
      rack.cables    = newCables;
      selectedCableId = null;
      patchName = typeof s.name === "string" ? s.name : "";
      el.patchName.value = patchName;
      updatePageTitle();
      if (typeof s.zoom  === "number") zoom  = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, s.zoom));
      if (typeof s.panX  === "number") panX  = s.panX;
      if (typeof s.panY  === "number") panY  = s.panY;
      if (typeof s.cableColorCursor === "number") cableColorCursor = s.cableColorCursor;
      applyZoom();
      renderAll();
    } catch (_) {}
  }

  /* ---------------------------------------------------------------------
     Export / Import
  --------------------------------------------------------------------- */

  el.btnClear.addEventListener("click", clearRack);

  el.btnExport.addEventListener("click", () => {
    if (rack.instances.size === 0) {
      toast("Add some modules before exporting.", true);
      return;
    }
    const trimmedName = patchName.trim();
    const payload = {
      format: "ae-patch-bay",
      version: 1,
      name: trimmedName || "Untitled Patch",
      createdAt: new Date().toISOString(),
      instances: Array.from(rack.instances.values()).map((i) => ({
        id: i.id, moduleId: i.moduleId, x: Math.round(i.x), y: Math.round(i.y),
        controls: i.controls || {},
      })),
      cables: Array.from(rack.cables.values()).map((c) => ({
        id: c.id, from: c.from, to: c.to, color: c.color, slack: c.slack,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const slug = slugify(trimmedName);
    const filename = slug ? `${slug}.json` : `patch-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("Patch exported.");
  });

  el.btnImport.addEventListener("click", () => el.fileImport.click());

  el.fileImport.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      importPatch(data);
    } catch (err) {
      console.error(err);
      toast("Couldn't read that file — is it a valid patch JSON?", true);
    }
  });

  function importPatch(data) {
    if (!data || !Array.isArray(data.instances) || !Array.isArray(data.cables)) {
      toast("That file doesn't look like a patch export.", true);
      return;
    }

    const missingModules = new Set();
    const newInstances = new Map();
    for (const inst of data.instances) {
      if (!libraryById.has(inst.moduleId)) {
        missingModules.add(inst.moduleId);
        continue;
      }
      newInstances.set(inst.id, {
        id: inst.id, moduleId: inst.moduleId, x: inst.x || 0, y: inst.y || 0,
        controls: (inst.controls && typeof inst.controls === "object") ? inst.controls : {},
      });
    }

    const newCables = new Map();
    for (const cable of data.cables) {
      if (!cable.from || !cable.to) continue;
      if (!newInstances.has(cable.from.instanceId) || !newInstances.has(cable.to.instanceId)) continue;
      newCables.set(cable.id || uid("cbl"), {
        id: cable.id || uid("cbl"),
        from: cable.from,
        to: cable.to,
        color: cable.color || nextCableColor(),
        slack: typeof cable.slack === "number" ? cable.slack : 0.75 + Math.random() * 0.65,
      });
    }

    rack.instances = newInstances;
    rack.cables = newCables;
    selectedCableId = null;
    patchName = typeof data.name === "string" && data.name !== "Untitled Patch" ? data.name : "";
    el.patchName.value = patchName;
    updatePageTitle();
    renderAll();

    if (missingModules.size > 0) {
      toast(`Imported, but ${missingModules.size} module(s) weren't found in the library: ${Array.from(missingModules).join(", ")}`, true);
    } else {
      toast("Patch imported.");
    }
  }

  /* ---------------------------------------------------------------------
     Init
  --------------------------------------------------------------------- */

  applyZoom();
  updatePageTitle();
  renderAll();
  loadLibrary();

})();
