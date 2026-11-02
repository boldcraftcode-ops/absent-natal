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
  // skrip modul harus ada (kecuali halaman statis: demo.html & kartu cetak)
  if (name.includes('demo') || name.includes('kartu-undangan')) {
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

// ------------------------------------------------------------- syarat PWA
console.log('== Syarat PWA (petugas)');
{
  const html = readFileSync(join(root, 'petugas.html'), 'utf8');
  const mf = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));

  const perlu = [
    ['manifest ditautkan', /rel="manifest"\s+href="manifest\.webmanifest"/.test(html)],
    ['manifest: start_url', Boolean(mf.start_url)],
    ['manifest: scope', Boolean(mf.scope)],
    ['manifest: display standalone', mf.display === 'standalone'],
    ['manifest: theme_color', /^#[0-9a-f]{6}$/i.test(mf.theme_color || '')],
    ['manifest: background_color', /^#[0-9a-f]{6}$/i.test(mf.background_color || '')],
    ['manifest: ikon 192 & 512', ['192x192', '512x512'].every((sz) => (mf.icons || []).some((i) => i.sizes === sz))],
    ['manifest: ada ikon maskable', (mf.icons || []).some((i) => (i.purpose || '').includes('maskable'))],
    ['meta apple-mobile-web-app-capable', /apple-mobile-web-app-capable/.test(html)],
    ['apple-touch-icon', /rel="apple-touch-icon"/.test(html)],
    ['theme-color di halaman', /<meta name="theme-color"/.test(html)],
    ['daftar service worker', /serviceWorker\.register\('\.\/sw\.js'\)/.test(readFileSync(join(root, 'js/petugas.js'), 'utf8'))],
    ['banner pasang aplikasi', /id="install-banner"/.test(html)],
    ['tangkap beforeinstallprompt', /beforeinstallprompt/.test(html) && /beforeinstallprompt/.test(readFileSync(join(root, 'js/petugas.js'), 'utf8'))],
    ['diagnosa izin kamera', /id="cam-check-list"/.test(html) && /getUserMedia/.test(readFileSync(join(root, 'js/petugas.js'), 'utf8'))],
    ['tombol uji kamera', /id="btn-cam-test"/.test(html)],
    // diagnosa "schema"/database: wajib ada di layar login
    ['daftar periksa database', /id="db-check-list"/.test(html)],
    ['tombol tes database', /id="btn-db-test"/.test(html)],
    ['diagnosa memanggil runDbChecks', /runDbChecks/.test(readFileSync(join(root, 'js/petugas.js'), 'utf8'))],
    ['pesan schema cache dipisah dari schema.sql',
      /schema cache/i.test(readFileSync(join(root, 'api.js'), 'utf8'))],
    // kelengkapan database: schema_check() di skema + dipanggil aplikasi
    ['fungsi schema_check() ada di skema', /create or replace function public\.schema_check\(\)/.test(readFileSync(join(root, 'supabase/schema.sql'), 'utf8'))],
    ['schema_check() boleh dipanggil anon', /grant execute on function public\.schema_check\(\)\s+to anon/.test(readFileSync(join(root, 'supabase/schema.sql'), 'utf8'))],
    ['pelengkap kolom (add column if not exists) ada', /add column if not exists wants_souvenir/.test(readFileSync(join(root, 'supabase/schema.sql'), 'utf8'))],
    ['aplikasi memanggil schemaCheck', /schemaCheck/.test(readFileSync(join(root, 'js/petugas.js'), 'utf8')) && /schema_check/.test(readFileSync(join(root, 'api.js'), 'utf8'))]
  ];
  for (const [nama, ok2] of perlu) {
    if (ok2) ok(`PWA: ${nama}`);
    else bad(`PWA: ${nama} — tidak ditemukan`);
  }

  // setiap ikon manifest harus benar-benar ada
  for (const ic of mf.icons || []) {
    if (!existsSync(join(root, ic.src))) bad(`PWA: berkas ikon hilang ${ic.src}`);
  }
  ok('semua ikon manifest ada di folder icons/');

  // service worker harus mem-precache halaman petugas & styles
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  for (const f of ['./petugas.html', './styles.css', './manifest.webmanifest']) {
    if (!sw.includes(`'${f}'`)) bad(`PWA: ${f} tidak di-precache service worker`);
  }
  ok('service worker mem-precache halaman & aset kunci');
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
