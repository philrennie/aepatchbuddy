#!/usr/bin/env node
// Validates all src/modules/*/module.json definitions.
// Exits non-zero on any error; warnings are informational only.
// Run: node scripts/lint-modules.js
'use strict';
const fs   = require('fs');
const path = require('path');

const root       = path.join(__dirname, '..');
const modulesDir = path.join(root, 'modules');

let errors = 0;

function err(msg)  { console.error(`  ERROR: ${msg}`); errors++; }
function warn(msg) { console.warn (`  WARN:  ${msg}`); }

function validatePosition(pos, ctx) {
  if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') {
    err(`${ctx}: position must be {x: number, y: number}`);
  }
}

// A label may be the token `wave:<name>` (or `wave:a+b` for a composite),
// rendered as a waveform glyph. Not required, but flag malformed tokens.
const WAVE_PRIMS = ['sine', 'square', 'triangle', 'saw'];
function checkWaveToken(str, ctx) {
  if (typeof str !== 'string' || !/^wave:/.test(str.trim())) return;
  const m = /^wave:([a-z]+(?:\+[a-z]+)*)$/.exec(str.trim());
  if (!m || !m[1].split('+').every(p => WAVE_PRIMS.includes(p))) {
    warn(`${ctx}: "${str}" looks like a waveform token but isn't wave:<${WAVE_PRIMS.join('|')}>[+…]`);
  }
}

function validateConnection(conn, mod, i) {
  const ctx = `${mod}/connections[${i}]`;
  if (!conn.name || typeof conn.name !== 'string') err(`${ctx}: missing name`);
  else checkWaveToken(conn.name, `${ctx}.name`);
  validatePosition(conn.position, ctx);
}

function validateControl(ctrl, mod, i) {
  const ctx = `${mod}/controls[${i}]`;
  if (!ctrl.id   || typeof ctrl.id   !== 'string') err(`${ctx}: missing id`);
  if (!ctrl.type || !['knob', 'switch'].includes(ctrl.type)) err(`${ctx}: type must be 'knob' or 'switch'`);
  if (typeof ctrl.label !== 'string') err(`${ctx}: missing label`);
  else checkWaveToken(ctrl.label, `${ctx}.label`);
  validatePosition(ctrl.position, ctx);
  if (ctrl.type === 'switch') {
    const ori = ctrl.orientation || 'vertical';
    if (!['vertical', 'horizontal'].includes(ori)) err(`${ctx}: orientation must be 'vertical' or 'horizontal'`);
    if (typeof ctrl.label2 === 'string') checkWaveToken(ctrl.label2, `${ctx}.label2`);
  }
}

const dirs = fs.readdirSync(modulesDir)
  .filter(d => fs.statSync(path.join(modulesDir, d)).isDirectory());

const seenIds = new Map();

for (const dir of dirs) {
  console.log(`Checking ${dir}/`);
  const jsonPath = path.join(modulesDir, dir, 'module.json');
  const svgPath  = path.join(modulesDir, dir, 'module.svg');

  if (!fs.existsSync(jsonPath)) { err(`${dir}: missing module.json`); continue; }

  // SVG check
  if (!fs.existsSync(svgPath)) {
    err(`${dir}: missing module.svg`);
  } else {
    const svg = fs.readFileSync(svgPath, 'utf8');
    if (!svg.trimStart().startsWith('<svg') && !svg.includes('<svg ')) {
      err(`${dir}/module.svg: does not appear to be a valid SVG`);
    }
  }

  // Parse JSON
  let mod;
  try { mod = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); }
  catch (e) { err(`${dir}/module.json: invalid JSON — ${e.message}`); continue; }

  // Required fields
  if (!mod.id   || typeof mod.id   !== 'string') err(`${dir}: missing id`);
  else if (mod.id !== dir)                        err(`${dir}: id "${mod.id}" must match folder name`);
  if (!mod.name || typeof mod.name !== 'string')  err(`${dir}: missing name`);
  if (typeof mod.width  !== 'number' || mod.width  <= 0) err(`${dir}: width must be a positive number`);
  if (typeof mod.height !== 'number' || mod.height <= 0) err(`${dir}: height must be a positive number`);

  if (!Array.isArray(mod.connections) || mod.connections.length === 0)
    err(`${dir}: connections must be a non-empty array`);
  else mod.connections.forEach((c, i) => validateConnection(c, dir, i));

  if (mod.controls !== undefined) {
    if (!Array.isArray(mod.controls)) err(`${dir}: controls must be an array`);
    else mod.controls.forEach((c, i) => validateControl(c, dir, i));
  }

  if (mod.manufacturer !== undefined && typeof mod.manufacturer !== 'string')
    err(`${dir}: manufacturer must be a string`);
  if (mod.url !== undefined) {
    if (typeof mod.url !== 'string') err(`${dir}: url must be a string`);
    else if (!/^https?:\/\//i.test(mod.url)) warn(`${dir}: url doesn't look like an http(s) URL`);
  }
  if (mod.documentation !== undefined) {
    if (typeof mod.documentation !== 'string') err(`${dir}: documentation must be a string`);
    else if (!/^https?:\/\//i.test(mod.documentation)) warn(`${dir}: documentation doesn't look like an http(s) URL`);
  }

  // Duplicate ID
  if (mod.id) {
    if (seenIds.has(mod.id)) err(`${dir}: duplicate id "${mod.id}" (also used by ${seenIds.get(mod.id)})`);
    else seenIds.set(mod.id, dir);
  }
}

if (errors > 0) {
  console.error(`\n${errors} error(s). Fix the above before merging.`);
  process.exit(1);
} else {
  console.log(`\nAll ${dirs.length} module(s) valid.`);
}
