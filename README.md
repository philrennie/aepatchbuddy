# Patch Bay

A browser-based patch documentation tool for the **AE Modular** synthesiser system. Pick modules from a library, drag cables between their jacks, set knob positions and switch states, then export the whole patch as a JSON file you can reload later or share with others.

Runs entirely from static files — no server, no build step, no dependencies.

---

## Using the app

| Action | How |
|---|---|
| **Add a module** | Click a row in the left-hand library, or drag it onto the rack |
| **Move a module** | Drag it by its body (not the jacks) |
| **Remove a module** | Hover it and click the × at its top-right corner |
| **Patch a cable** | Click-drag from one jack to another |
| **Reroute a cable** | Drag from an already-connected jack to redirect it |
| **Delete a cable** | Click the cable to select it, then click the × at its midpoint or press Delete / Backspace |
| **Set a knob** | Drag up/down on the knob overlay |
| **Toggle a switch** | Click the switch overlay |
| **Name your patch** | Edit the field in the top bar — used as the export filename |
| **Export** | Downloads the current rack as a `.json` file |
| **Import** | Loads a previously exported `.json` file |
| **Zoom** | The +/− buttons in the top bar |

Jacks are always visible with a subtle ring; a jack with a cable patched into it stays lit in that cable's colour, and a solid dot is drawn at each cable end — so you can always tell exactly which connector a cable lands on.

---

## Module editor

Open **`module-editor.html`** alongside the main app. It lets you build a module panel visually, then export the `module.json` entry ready to drop into the library — the panel graphic itself is optional (see below).

- Use the tool buttons to place **jacks**, **knobs**, **toggle switches**, and **labels** (free panel text)
- Click a component to select it and edit its label, position, and orientation in the right-hand panel
- The width field sets the module's rack-unit width (1 RU = 25 mm = 160 px); height is always 640 px (100 mm), matching the AE Modular standard
- **Custom SVG artwork** checkbox marks the module as shipping its own hand-drawn `module.svg` (sets `customImage: true` in the exported JSON) — leave it unchecked and the main app renders the panel automatically from `module.json` alone, same as this editor's own preview
- **Import JSON** loads an existing `module.json` back into the editor for further edits — no need to re-upload a matching SVG, since the JSON alone carries enough to reconstruct the panel
- **Copy JSON entry** puts the `module.json` snippet on the clipboard
- **Download SVG** saves the panel graphic, for modules that check "Custom SVG artwork"

---

## Contributing a module

Modules live in individual folders under `src/modules/`. Adding a module is a pull request that touches only that folder — you never need to edit `data/modules.json` (the CI build does that automatically on merge).

### Step-by-step

1. **Fork** the repository and create a branch.

2. **Create a folder** named after your module's `id` (lowercase, no spaces — hyphens are fine):

   ```
   src/modules/your-module/
   ```

3. **Add `module.json`** — see the schema below.

4. **Add `module.svg`** — optional. If you don't supply one, the panel is rendered automatically from `module.json` (the same way the module editor's own live preview works) — nothing else to do. If you want custom artwork instead, set `"customImage": true` in `module.json` (or check "Custom SVG artwork" in the module editor) and add `module.svg` alongside it. The SVG's `viewBox` / `width` / `height` must match the `width` and `height` values in `module.json`.

5. **Open a pull request** against `main`. A GitHub Actions workflow will lint your `module.json` automatically — fix any errors it reports before requesting review.

> **Note:** Do not commit changes to `data/modules.json` — it is auto-generated on merge and your edit will be overwritten.

### Running the lint check locally

From the repo root (`src/`):

```bash
node scripts/lint-modules.js
```

### Module schema (`module.json`)

```json
{
  "id": "2tone",
  "name": "2 Tone",
  "manufacturer": "Tangible Waves",
  "url": "https://www.example.com/shop/2tone",
  "documentation": "https://www.example.com/docs/2tone",
  "customImage": true,
  "width": 160,
  "height": 640,
  "connections": [
    { "id": "a-in",  "name": "A IN",  "position": { "x": 40,  "y": 120 }, "labelPosition": "right" },
    { "id": "a-out", "name": "A OUT", "position": { "x": 120, "y": 120 }, "labelPosition": "left" }
  ],
  "controls": [
    { "id": "tone", "type": "knob", "label": "TONE", "position": { "x": 80, "y": 280 }, "labelPosition": "below" }
  ],
  "labels": [
    { "text": "TONE STAGE", "position": { "x": 80, "y": 200 }, "size": 12, "align": "middle" }
  ]
}
```

**Do not include an `image` field** — the build script sets it, but only when `customImage` is `true`.

#### Field reference

| Field | Required | Description |
|---|---|---|
| `id` | ✓ | Unique identifier. Must match the folder name exactly. Lowercase letters, digits, hyphens. |
| `name` | ✓ | Display name shown in the module library. |
| `manufacturer` | | Name of the company that makes this module. Shown as a subtitle in the library sidebar. |
| `url` | | Product page URL (`https://…`). Shown as a link button on rack instances and in the sidebar. |
| `documentation` | | Documentation/manual URL (`https://…`). Available in the module editor; not currently surfaced in the main app. |
| `customImage` | | `true` if this module ships its own hand-drawn `module.svg`. Omit (or `false`) to have the panel rendered automatically from the rest of this file instead. Build-time only — stripped before publishing to `data/modules.json`. |
| `width` | ✓ | Panel width in native SVG pixels. Must be a multiple of 160 (1 RU = 160 px). |
| `height` | ✓ | Panel height in native SVG pixels. Always 640 (100 mm at AE Modular scale). |
| `connections` | ✓ | Array of jack definitions (see below). |
| `controls` | | Array of knob and switch definitions (see below). Omit if the module has none. |
| `labels` | | Array of free-standing text definitions (see below). Omit if the module has none. |

#### `connections[]`

| Field | Required | Description |
|---|---|---|
| `id` | ✓ | Unique identifier for this jack **within the module**. Used internally by the patch format — different from the display name. Required when any two jacks share the same `name` (e.g. a mult); recommended for all jacks. |
| `name` | ✓ | Display name shown on hover (e.g. `"A IN"`, `"MULT"`). Does not need to be unique. May also be a [waveform token](#waveform-symbol-labels). |
| `position` | ✓ | `{ "x": number, "y": number }` — centre of the jack in native SVG pixel space (top-left origin, before any scaling). |
| `labelPosition` | | Where the module editor draws the caption relative to the jack: `"above"`, `"left"`, `"right"`, or `"below"` (default). Only affects the generated SVG — the main app positions jack labels with CSS regardless of this value. |

#### `controls[]`

| Field | Required | Description |
|---|---|---|
| `id` | ✓ | Unique identifier within the module. |
| `type` | ✓ | `"knob"` or `"switch"`. |
| `label` | ✓ | Text label. For a switch this is the label for position 0. May also be a [waveform token](#waveform-symbol-labels). |
| `label2` | (switch) | Label for position 1 of a switch. May also be a [waveform token](#waveform-symbol-labels). |
| `orientation` | (switch) | `"vertical"` (default) or `"horizontal"`. |
| `position` | ✓ | `{ "x": number, "y": number }` — centre of the control in native SVG pixel space. |
| `labelPosition` | (knob) | Same as `connections[].labelPosition`, above. Not applicable to switches, which position `label`/`label2` from `orientation` instead. |

#### `labels[]`

Arbitrary panel text not attached to a jack or control — section headings, dividers, etc.

| Field | Required | Description |
|---|---|---|
| `text` | ✓ | The text to render. |
| `position` | ✓ | `{ "x": number, "y": number }` — anchor point in native SVG pixel space. |
| `size` | | Font size in px. Defaults to `11`. |
| `align` | | SVG `text-anchor` value: `"start"`, `"middle"` (default), or `"end"`. |

Like `labelPosition`, this field is not read by the main patch app — the text is already baked
into `module.svg` as static graphics. It exists so that `module.json` alone is enough to reopen
a module in the module editor (**Import JSON**) and reconstruct the full panel, without needing
to re-upload the matching SVG.

#### Waveform symbol labels

Any label (`connections[].name`, `controls[].label`, `controls[].label2`) may
be the literal token **`wave:<name>`** instead of text, where `<name>` is one
of `sine`, `square`, `triangle`, `saw`. It renders as a small vector waveform
glyph on the panel instead of a word. Combine primitives with `+` for a
composite symbol, e.g. `wave:triangle+saw`.

```json
{ "id": "shape", "type": "switch", "label": "wave:square", "label2": "wave:triangle+saw",
  "orientation": "vertical", "position": { "x": 120, "y": 420 } }
```

The module editor's label fields have an `Abc` / `∿` toggle for picking a
waveform instead of typing one. In the patch editor the glyph is baked into
`module.svg`, and the hover tooltip shows a word ("Sawtooth").

#### Finding pixel coordinates

Open the SVG in a browser or image editor and read off the pixel position of each jack/control centre. The module editor places components visually and exports the coordinates for you.

---

## Patch export format

```json
{
  "format": "ae-patch-bay",
  "version": 1,
  "name": "Kick Drum Voice",
  "createdAt": "2026-09-02T12:00:00.000Z",
  "instances": [
    {
      "id": "inst_abc123",
      "moduleId": "vco",
      "x": 120,
      "y": 80,
      "controls": { "freq": 0.62, "range": 0 }
    }
  ],
  "cables": [
    {
      "id": "cbl_def456",
      "from": { "instanceId": "inst_abc123", "connector": "sin-out" },
      "to":   { "instanceId": "inst_xyz789", "connector": "in-1" },
      "color": "#e8a33d",
      "slack": 0.95
    }
  ]
}
```

- `instances[].controls` maps each control's `id` to its current value: `0`–`1` for knobs, `0` or `1` for switches.
- `cables[].from/to.connector` holds the connection `id` from `module.json` (or the `name` for older modules that predate the `id` field).
- If a patch references a `moduleId` not in the current library, that module and its cables are skipped with a toast warning — patches remain loadable even if the library changes.

---

## Running locally

The app fetches `data/modules.json` at runtime, so opening `index.html` directly via `file://` will fail in most browsers. Serve the folder instead:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Any static file server works (`npx serve .`, VS Code Live Server, etc.).

After adding or editing a module folder, regenerate `data/modules.json`:

```bash
node scripts/build-modules.js
```

---

## Project structure

```
src/
├── index.html              Main app
├── module-editor.html      Visual module builder
├── css/style.css
├── css/module-editor.css
├── js/app.js
├── js/module-editor.js
├── js/panel-render.js      Shared SVG panel renderer (used by both apps)
├── data/
│   └── modules.json        Auto-generated — do not edit by hand
├── modules/                Individual module source folders
│   └── {module-id}/
│       ├── module.json     Module definition (source of truth)
│       └── module.svg      Panel graphic (optional — only used when customImage: true)
└── scripts/
    ├── build-modules.js    Combines module folders → data/modules.json
    └── lint-modules.js     Validates all module.json files
```

`.github/workflows/` contains two Actions:
- **`lint-modules.yml`** — runs on every PR that touches `src/modules/**`
- **`publish.yml`** — runs on push to `main`; rebuilds `data/modules.json` and deploys to the `publish` branch (GitHub Pages source)

---

## Browser support

ES2017+, CSS custom properties, SVG. Works in any current browser. No build tooling, no npm, no dependencies.

## License

This project is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE).

**In short:**

- ✅ You can use, modify, fork, and remix this project freely — for personal use, hobby projects, research, education, or noncommercial community tools.
- ✅ You can redistribute your own modified version, as long as it keeps this same license attached.
- ❌ You cannot sell this software, host a paid version of it, bundle it into a commercial product, or otherwise use it (or a derivative of it) for commercial advantage.

**Why this license, and not MIT/GPL/etc.?**

This tool exists to serve the AE modular / Eurorack community as a free, open, collaborative resource for planning and sharing patch layouts. The goal is for anyone to be able to poke around the code, fix bugs, add module definitions, or build their own variant — without a company (including one of us, later) turning around and selling a closed, commercialized clone back to the same community. A permissive license (MIT, BSD) wouldn't prevent that; a copyleft license like the GPL/AGPL would force derivatives to stay open-source but wouldn't stop someone from commercializing a hosted version. PolyForm Noncommercial is the more direct match for "free to tinker with, not for sale."

Note this isn't an OSI-approved "open source" license in the strict/technical sense (it restricts commercial use, which the Open Source Definition doesn't allow) — it's usually described as "source-available." Practically, for this project, that distinction doesn't change anything about how freely you can use or contribute to it.

**A note on contributions**

By contributing code, module definitions, or other content to this project, you're agreeing that your contribution is distributed under the same PolyForm Noncommercial License. If that doesn't work for you (e.g. you want to reuse your own contribution commercially elsewhere), please raise it in your PR before contributing — happy to talk through it.

## About the module representations

This project includes functional representations of jacks, knobs, switches, and buttons for real-world Eurorack/AE modular modules, so people can build and share patch diagrams that reflect their actual racks.

To stay on solid legal ground:

- We do **not** use manufacturer logos, panel artwork, product photos, or other copyrighted visual material from any manufacturer.
- We represent only the **functional layout** — the position and type of controls and jacks needed to patch correctly — using our own original graphic style.
- Where a module name is shown, it's used descriptively (to tell users which real module a layout corresponds to), not as a stylized reproduction of the manufacturer's branding or as an implication of affiliation or endorsement.

If you're contributing a new module definition, please follow the same approach: describe the panel's function, not its exact decorative appearance, and don't copy artwork, fonts, or logos from datasheets, manuals, or product photos. If a manufacturer ever contacts us with a concern about a specific module's representation, we'll take it seriously and adjust as needed.

*(This section is a project convention, not legal advice — if you're unsure whether a specific module rendering crosses a line, ask before merging.)*