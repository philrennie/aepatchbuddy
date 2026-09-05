# Patch Bay

A static, no-build webapp for documenting AE Modular synth patches: pick modules
from a library, drag cables between their jacks, and export/import the patch
as JSON. Built to run entirely from static files, so it drops straight onto
GitHub Pages.

## Running it locally

Because the app `fetch()`s `data/modules.json`, opening `index.html` directly
via `file://` will fail in most browsers. Serve the folder instead:

```bash
cd ae-patch-bay
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static server works (`npx serve`, VS Code's Live Server, etc.).

## Deploying to GitHub Pages

1. Push this folder's contents to a repo (they can live at the repo root, or
   under `/docs`).
2. In the repo's **Settings → Pages**, set the source to the branch/folder
   you used.
3. GitHub will publish it at `https://<user>.github.io/<repo>/` — no build
   step required.

## Adding real module images

The five modules in `data/modules.json` are placeholder SVG panels (drawn
programmatically) so this project doesn't redistribute anyone else's
copyrighted artwork. To use real module graphics:

1. Save each module image into `images/` (or reference a URL directly).
2. Add an entry to `data/modules.json` following the schema below, with jack
   `position` coordinates measured in the **native pixel dimensions of the
   image** (top-left origin).
3. Refresh the page — no code changes needed.

### Module schema

```json
{
  "id": "2tone",
  "name": "2 Tone",
  "image": "images/2tone.png",
  "width": 160,
  "height": 640,
  "connections": [
    { "name": "A IN", "position": { "x": 40, "y": 120 } },
    { "name": "A OUT", "position": { "x": 120, "y": 120 } }
  ]
}
```

- `image` can be a relative path or an absolute URL.
- `width` / `height` should match the image's natural pixel size — the app
  scales everything (image + jack positions) together, so as long as your
  source images share a consistent scale (e.g. all exported from the same
  panel-design file), modules will line up correctly next to each other.
- `connections[].position` is measured in that same native pixel space; the
  app places a clickable jack there and scales it along with the image.
- Jack `name` should be unique within a module — it's what gets referenced
  in exported patch cables.

To find pixel coordinates for jacks quickly: open the image in any image
editor (or the browser's dev tools with an `<img>` element) and read off the
pixel position of each jack's center.

## Using the app

- **Name your patch** — the field in the top bar. It's included in the
  exported JSON (`name`) and used to generate the download filename (e.g.
  "Kick Drum Voice" → `kick-drum-voice.json`). Leave it blank and exports
  fall back to a timestamped filename.
- **Add a module** — click a row in the left library, or drag it onto the
  rack.
- **Move a module** — drag it by its body (not the jacks).
- **Patch a cable** — click-drag from one jack to another. Each new cable
  gets the next color in a fixed rotation. Jacks always show a visible ring
  so they're findable before you hover them, and a jack with a cable
  patched into it stays lit in that cable's color — and each cable also
  gets a solid dot of its own color at both ends, drawn on top of the jack —
  so you can always tell exactly which connector a cable lands on, even
  with several cables converging near the same module.
- **Delete a cable** — click it to select (a small × appears at its
  midpoint), then click the × or press Delete/Backspace.
- **Remove a module** — hover it and click the × at its top-right corner
  (this also removes any cables attached to it).
- **Zoom** — the +/− controls in the top bar.
- **Export** — downloads the current rack (modules + cables) as a `.json`
  file, named after your patch name.
- **Import** — loads a previously exported `.json` file back onto the rack,
  including its name. If a patch references a module `id` that isn't in
  your current `modules.json`, that module (and its cables) is skipped with
  a warning, so patches remain shareable even if your library changes over
  time.

## Patch export format

```json
{
  "format": "ae-patch-bay",
  "version": 1,
  "name": "Kick Drum Voice",
  "createdAt": "2026-09-02T12:00:00.000Z",
  "instances": [
    { "id": "inst_abc123", "moduleId": "vco", "x": 120, "y": 80 }
  ],
  "cables": [
    {
      "id": "cbl_def456",
      "from": { "instanceId": "inst_abc123", "connector": "SIN" },
      "to": { "instanceId": "inst_xyz789", "connector": "IN 1" },
      "color": "#e8a33d"
    }
  ]
}
```

## Project structure

```
ae-patch-bay/
├── index.html
├── css/style.css
├── js/app.js
├── data/modules.json      ← the module library (edit this to add real modules)
└── images/                ← module panel images referenced by modules.json
```

## Browser support

Plain ES2017+ JS, CSS custom properties, SVG — works in any current browser.
No build tooling, no dependencies, no bundler.
