/* ==========================================================================
   util.js — utilitas kecil yang dipakai semua halaman.
   Dimuat sebagai modul ES:  import { esc, pad3 } from './util.js';
   ========================================================================== */

/** Escape teks untuk disisipkan ke HTML (cegah XSS). */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Nomor undian 3 digit: 7 -> "007", 501 -> "501". */
export function pad3(no) {
  const n = Number(no);
  if (!Number.isFinite(n)) return '---';
  return String(Math.max(0, Math.trunc(n))).padStart(3, '0');
}

/** "2026-12-24T18:30:00+07:00" -> "18:30" (waktu lokal perangkat). */
export function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');
}

/** Tanggal + jam lengkap. */
export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

/** Normalisasi nomor HP seperti di server: +62/62 -> 0, buang non-digit. */
export function normPhone(raw) {
  let v = String(raw ?? '').replace(/[^0-9+]/g, '');
  if (v.startsWith('+62')) v = '0' + v.slice(3);
  else if (v.startsWith('62')) v = '0' + v.slice(2);
  else if (v.startsWith('+')) v = v.replace(/[^0-9]/g, '');
  v = v.replace(/[^0-9]/g, '');
  return v.length < 6 ? '' : v;
}

/** Normalisasi nama untuk pencocokan (sama seperti server). */
export function normName(raw) {
  return String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Cari elemen singkat. */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Buat elemen dengan atribut & anak. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v; // hanya untuk string yang sudah di-esc
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Toast singkat di bawah layar. */
export function toast(message, kind = 'ok', ms = 3200) {
  let box = document.querySelector('.toasts');
  if (!box) {
    box = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(box);
  }
  const t = el('div', { class: `toast toast--${kind}`, text: message });
  box.append(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, ms - 300);
  setTimeout(() => t.remove(), ms);
}

/** Getar singkat (bila didukung). */
export function vibrate(pattern = 60) {
  try { navigator.vibrate?.(pattern); } catch { /* diabaikan */ }
}

/** Bunyi singkat tanpa file audio (WebAudio). */
export function beep(kind = 'ok') {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const seq = kind === 'ok' ? [880, 1320] : kind === 'dup' ? [660, 520] : [300, 220];
    seq.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.11);
      gain.gain.exponentialRampToValueAtTime(0.18, now + i * 0.11 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.11 + 0.1);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.11);
      osc.stop(now + i * 0.11 + 0.12);
    });
    setTimeout(() => ctx.close(), 800);
  } catch { /* diabaikan */ }
}

/** Debounce. */
export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** Simpan/baca JSON di localStorage dengan aman. */
export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  },
  del(key) { try { localStorage.removeItem(key); } catch { /* diabaikan */ } }
};

/** UUID v4 dari crypto (untuk antrean idempoten). */
export function uuid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Bilangan bulat acak KRIPTOGRAFIS dalam [0, max) memakai rejection sampling.
 * Dipakai layar undian (bukan Math.random).
 */
export function cryptoRandomInt(max) {
  if (!Number.isInteger(max) || max <= 0) throw new Error('Batas acak tidak valid');
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  let value;
  do {
    crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return value % max;
}

/** Ambil token dari URL (?t=...) atau dari teks QR mentah. */
export function extractToken(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  try {
    const direct = /^[0-9a-fA-F]{8,64}$/;
    if (direct.test(raw)) return raw.toLowerCase();
    const url = new URL(raw, location.origin);
    const t = url.searchParams.get('t');
    if (t && /^[0-9a-fA-F]{8,64}$/.test(t.trim())) return t.trim().toLowerCase();
    // QR bisa berisi URL lain dengan #/t=
    const m = raw.match(/[?&#]t=([0-9a-fA-F]{8,64})/);
    if (m) return m[1].toLowerCase();
  } catch { /* bukan URL */ }
  const m2 = raw.match(/(?:^|[^0-9a-zA-Z])([0-9a-f]{16})(?:$|[^0-9a-zA-Z])/);
  return m2 ? m2[1].toLowerCase() : '';
}

/** Sumber kehadiran dalam Bahasa Indonesia. */
export const SOURCE_LABEL = {
  scan_sendiri: 'Scan sendiri',
  petugas: 'Petugas',
  form_umum: 'Form umum',
  manual: 'Manual'
};
export const sourceLabel = (s) => SOURCE_LABEL[s] || 'Tanpa undangan';

/** Deteksi online yang ramah (navigator.onLine kadang terlalu optimis). */
export function online() {
  return navigator.onLine !== false;
}
