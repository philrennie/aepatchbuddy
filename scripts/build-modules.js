#!/usr/bin/env node
// Combines modules/*/module.json into data/modules.json.
// module.svg is only required when a module declares customImage: true.
// Run: node scripts/build-modules.js
'use strict';
const fs   = require('fs');
const path = require('path');

const root       = path.join(__dirname, '..');
const modulesDir = path.join(root, 'modules');
const outputFile = path.join(root, 'data', 'modules.json');

if (!fs.existsSync(modulesDir)) {
  console.error(`modules/ directory not found`);
  process.exit(1);
}

const dirs = fs.readdirSync(modulesDir)
  .filter(d => fs.statSync(path.join(modulesDir, d)).isDirectory());

const modules = [];
let failed = false;

for (const dir of dirs) {
  const jsonPath = path.join(modulesDir, dir, 'module.json');

  if (!fs.existsSync(jsonPath)) continue;

  let mod;
  try {
    mod = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    console.error(`ERROR: ${dir}/module.json is not valid JSON — ${e.message}`);
    failed = true;
    continue;
  }

  // module.svg is only expected when the module declares customImage: true — otherwise
  // the patch app generates the panel inline (js/panel-render.js). lint-modules.js is
  // what actually validates the flag against the filesystem before this ever runs in CI.
  if (mod.customImage) {
    mod.image = `modules/${dir}/module.svg`;
  }
  delete mod.customImage;
  modules.push(mod);
}

if (failed) process.exit(1);

modules.sort((a, b) => a.name.localeCompare(b.name));

fs.writeFileSync(outputFile, JSON.stringify(modules, null, 2) + '\n');
console.log(`Built ${modules.length} modules → data/modules.json`);
