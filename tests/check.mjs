#!/usr/bin/env node
/**
 * check.mjs — pemeriksaan sintaks semua berkas JS + validasi HTML/JSON ringan.
 * Jalankan: node tests/check.mjs
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'check-'));
let errors = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { errors++; console.log(`  FAIL ${m}`); };

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'vendor', '.git'].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(root);

// ---------------------------------------------------------------- JS syntax
console.log('== Sintaks JavaScript');
const jsFiles = files.filter((f) => extname(f) === '.js' && !f.includes('/vendor/'));
for (const f of jsFiles) {
  const isModule = /(^|\/)js\//.test(f) || /\b(import|export)\b/.test(readFileSync(f, 'utf8'));
  const target = join(tmp, `${f.replace(/[\\/]/g, '_')}.${isModule ? 'mjs' : 'cjs'}`);
  writeFileSync(target, readFileSync(f));
  try {
    execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' });
    ok(`${f.replace(root + '/', '')} (${isModule ? 'ESM' : 'CJS'})`);
  } catch (e) {
    bad(`${f.replace(root + '/', '')}\n${e.stderr?.toString().split('\n').slice(0, 4).join('\n')}`);
  }
}

// -------------------------------------------------------------- HTML checks
console.log('== HTML');
const pages = files.filter((f) => extname(f) === '.html' && !f.includes('/vendor/'));
const IDS = new Set();
for (const f of pages) {
  const html = readFileSync(f, 'utf8');
  const name = f.replace(root + '/', '');

  // tag berpasangan kasar
  const voids = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
    'meta', 'param', 'source', 'track', 'wbr', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'use', 'stop']);
  const stack = [];
  let fail = null;
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>/g;
  const noParse = /<(script|style)[^>]*>[\s\S]*?<\/\1>/gi;
  const cleaned = html.replace(noParse, '<$1></$1>').replace(/<!--[\s\S]*?-->/g, '');
  let m;
  while ((m = re.exec(cleaned))) {
    const [, close, tag, attrs, selfClose] = m;
    const t = tag.toLowerCase();
    if (voids.has(t) || selfClose === '/') continue;
    if (!close) stack.push(t);
    else {
      const last = stack.pop();
      if (last !== t) { fail = `penutup </${t}> tidak cocok (terakhir <${last}>)`; break; }
    }
  }
  if (!fail && stack.length) fail = `tag belum ditutup: ${stack.join(', ')}`;
  if (fail) bad(`${name}: ${fail}`); else ok(`${name}: struktur tag`);

  // lang + viewport + charset
  if (!/lang="id"/.test(html)) bad(`${name}: atribut lang="id" tidak ada`); else ok(`${name}: lang=id`);
  if (!/name="viewport"/.test(html)) bad(`${name}: viewport tidak ada`); else ok(`${name}: viewport`);

  // referensi berkas lokal harus ada
  const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((x) => x[1])
    .filter((r) => !r.startsWith('http') && !r.startsWith('data:') && !r.startsWith('mailto'));
  for (const r of refs) {
    const p = join(dirname(f), r.split('?')[0]);
    if (!existsSync(p)) bad(`${name}: berkas rujukan tidak ada -> ${r}`);
  }
  ok(`${name}: ${refs.length} rujukan lokal diperiksa`);

  // id unik
  for (const idm of html.matchAll(/\bid="([^"]+)"/g)) {
    if (IDS.has(`${name}:${idm[1]}`)) bad(`${name}: id duplikat ${idm[1]}`);
    IDS.add(`${name}:${idm[1]}`);
  }
  // skrip modul harus ada (kecuali halaman statis seperti demo.html)
  if (name.includes('demo')) {
    if (!/<style>/.test(html)) bad(`${name}: CSS tidak di-inline`);
    else ok(`${name}: halaman statis dengan CSS inline`);
  } else if (!/type="module"/.test(html)) bad(`${name}: tidak memuat modul JS`);
  else ok(`${name}: modul JS`);
}

// ---------------------------------------------------------------- JSON files
console.log('== JSON / manifest');
for (const f of files.filter((x) => extname(x) === '.json' || x.endsWith('.webmanifest'))) {
  try { JSON.parse(readFileSync(f, 'utf8')); ok(f.replace(root + '/', '')); }
  catch (e) { bad(`${f.replace(root + '/', '')}: ${e.message}`); }
}

// ----------------------------------------------- variabel CSS yang dipakai
console.log('== Variabel CSS (tema)');
{
  const cssText = readFileSync(join(root, 'styles.css'), 'utf8');
  const defined = new Set([...cssText.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set();
  for (const f of [...jsFiles, ...pages, join(root, 'demo.html')]) {
    let txt = '';
    try { txt = readFileSync(f, 'utf8'); } catch { continue; }
    for (const m of txt.matchAll(/var\((--[a-z0-9-]+)/g)) used.add(m[1]);
  }
  // --dx/--rot diisi dari JS per elemen konfeti (bukan variabel tema)
  const RUNTIME = new Set(['--dx', '--rot']);
  const missing = [...used].filter((v) => !defined.has(v) && !RUNTIME.has(v));
  if (missing.length) bad(`variabel CSS tidak terdefinisi: ${missing.join(', ')}`);
  else ok(`${used.size} variabel CSS dipakai, semuanya terdefinisi`);

  // palet referensi harus ada
  for (const hex of ['#CBBDA6', '#E0DACD', '#553D29', '#83322D', '#455026']) {
    if (!cssText.toUpperCase().includes(hex)) bad(`warna palet ${hex} tidak ditemukan di styles.css`);
  }
  ok('5 warna palet referensi tersedia di styles.css');
}

// ------------------------------------------------------- referensi antar modul
console.log('== Import antar modul');
for (const f of jsFiles) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const target = join(dirname(f), m[1]);
    if (!existsSync(target)) bad(`${f.replace(root + '/', '')}: import tidak ditemukan -> ${m[1]}`);
  }
}
ok('semua import relatif diperiksa');

console.log(`\n${errors === 0 ? 'SEMUA PEMERIKSAAN LULUS' : errors + ' MASALAH DITEMUKAN'}`);
process.exit(errors === 0 ? 0 : 1);
