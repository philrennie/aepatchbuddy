#!/usr/bin/env node
// Combines modules/*/module.json into data/modules.json.
// Each module folder must contain both module.json and module.svg.
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
  const svgPath  = path.join(modulesDir, dir, 'module.svg');

  if (!fs.existsSync(jsonPath)) continue;

  if (!fs.existsSync(svgPath)) {
    console.error(`ERROR: ${dir}/module.svg is missing`);
    failed = true;
    continue;
  }

  let mod;
  try {
    mod = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    console.error(`ERROR: ${dir}/module.json is not valid JSON — ${e.message}`);
    failed = true;
    continue;
  }

  mod.image = `modules/${dir}/module.svg`;
  modules.push(mod);
}

if (failed) process.exit(1);

modules.sort((a, b) => a.name.localeCompare(b.name));

fs.writeFileSync(outputFile, JSON.stringify(modules, null, 2) + '\n');
console.log(`Built ${modules.length} modules → data/modules.json`);
