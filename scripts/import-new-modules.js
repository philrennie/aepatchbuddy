#!/usr/bin/env node
// Imports {name}.json files from new-modules/ into modules/{id}/module.json.
// Run: node scripts/import-new-modules.js
'use strict';
const fs   = require('fs');
const path = require('path');

const root      = path.join(__dirname, '..');
const srcDir    = path.join(root, 'new-modules');
const destDir   = path.join(root, 'modules');

if (!fs.existsSync(srcDir)) {
  console.error('new-modules/ directory not found');
  process.exit(1);
}

const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.json'));

if (files.length === 0) {
  console.log('No .json files found in new-modules/');
  process.exit(0);
}

let imported = 0;
let failed   = 0;

for (const file of files) {
  const srcPath = path.join(srcDir, file);
  let mod;

  try {
    mod = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
  } catch (e) {
    console.error(`ERROR: ${file} is not valid JSON — ${e.message}`);
    failed++;
    continue;
  }

  const id = mod.id || path.basename(file, '.json');

  if (!id) {
    console.error(`ERROR: ${file} has no "id" field and filename can't be used as ID`);
    failed++;
    continue;
  }

  const moduleDir  = path.join(destDir, id);
  const destPath   = path.join(moduleDir, 'module.json');

  if (!fs.existsSync(moduleDir)) {
    fs.mkdirSync(moduleDir, { recursive: true });
  }

  if (fs.existsSync(destPath)) {
    console.log(`SKIP: modules/${id}/module.json already exists — remove it first to overwrite`);
    continue;
  }

  fs.writeFileSync(destPath, JSON.stringify(mod, null, 2) + '\n');
  console.log(`OK:   ${file} → modules/${id}/module.json`);
  imported++;
}

console.log(`\nDone: ${imported} imported, ${failed} failed.`);
if (imported > 0) {
  console.log('Run node scripts/build-modules.js to rebuild data/modules.json.');
}
if (failed > 0) process.exit(1);
