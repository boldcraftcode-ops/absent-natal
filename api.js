/* ==========================================================================
   api.js — pembungkus fetch ke Supabase RPC.
   Semua akses data lewat /rest/v1/rpc/<nama>; tabel TIDAK pernah diakses
   langsung (RLS tanpa policy di server).
   ========================================================================== */

const TIMEOUT_MS = 20000;

function cfg() {
  const c = window.APP_CONFIG || {};
  if (!c.SUPABASE_URL || !c.SUPABASE_ANON_KEY) {
    throw new ApiError(
      'Aplikasi belum dikonfigurasi. Isi SUPABASE_URL dan SUPABASE_ANON_KEY di config.js.',
      { code: 'config' }
    );
  }
  return c;
}

export class ApiError extends Error {
  constructor(message, { code = 'error', status = 0, hint = '' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.hint = hint;
  }
}

export function isConfigured() {
  const c = window.APP_CONFIG || {};
  return Boolean(c.SUPABASE_URL && c.SUPABASE_ANON_KEY);
}

/** Pesan error server -> Bahasa Indonesia yang mudah dipahami. */
function friendly(status, payload) {
  const p = payload || {};
  const raw = [p.message, p.details, p.hint, p.error_description, p.error].filter(Boolean).join(' ');
  if (/pin_invalid|PIN salah/i.test(raw)) return 'PIN salah. Periksa kembali PIN Anda.';
  if (/JWT|apikey|api key|Invalid API key/i.test(raw)) {
    return 'Kunci akses Supabase tidak valid. Periksa kembali config.js.';
  }
  if (/permission denied|not authorized|insufficient privilege/i.test(raw)) {
    return 'Akses ditolak oleh server. Hubungi panitia.';
  }
  if (/does not exist|schema cache|Could not find the function/i.test(raw)) {
    return 'Fungsi database belum terpasang. Jalankan supabase/schema.sql di Supabase.';
  }
  if (/duplicate key/i.test(raw)) return 'Data sudah ada di server (tidak dobel).';
  switch (status) {
    case 0: return 'Tidak ada koneksi ke server. Periksa sinyal internet Anda.';
    case 401:
    case 403: return 'Akses ditolak. PIN salah atau kunci akses tidak valid.';
    case 404: return 'Alamat server tidak ditemukan. Periksa SUPABASE_URL di config.js.';
    case 429: return 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.';
    default:
      if (status >= 500) return 'Server sedang bermasalah. Coba lagi beberapa saat.';
      return raw ? `Gagal memproses permintaan: ${raw.slice(0, 160)}` : 'Permintaan gagal diproses.';
  }
}

/**
 * Panggil fungsi RPC.
 * @param {string} name nama fungsi Postgres (mis. 'get_invite')
 * @param {object} params argumen fungsi (named arguments)
 * @param {{timeoutMs?:number}} opts
 */
export async function rpc(name, params = {}, opts = {}) {
  const c = cfg();
  const url = `${c.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/${name}`;
  const headers = {
    'Content-Type': 'application/json',
    apikey: c.SUPABASE_ANON_KEY
  };
  // Untuk key baru (sb_publishable_...) jangan kirim Authorization: Bearer.
  if (!String(c.SUPABASE_ANON_KEY).startsWith('sb_publishable_')) {
    headers.Authorization = `Bearer ${c.SUPABASE_ANON_KEY}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(params || {}),
      signal: controller.signal,
      cache: 'no-store'
    });
  } catch (err) {
    clearTimeout(timer);
    if (err?.name === 'AbortError') {
      throw new ApiError('Server terlalu lama merespons. Coba lagi.', { code: 'timeout' });
    }
    throw new ApiError('Tidak ada koneksi ke server. Periksa sinyal internet Anda.', { code: 'offline' });
  }
  clearTimeout(timer);

  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { message: text }; }
  }

  if (!res.ok) {
    throw new ApiError(friendly(res.status, data), {
      code: /pin_invalid|PIN salah/i.test(text) ? 'pin_invalid' : 'server',
      status: res.status,
      hint: data?.hint || ''
    });
  }

  // PostgREST mengembalikan nilai skalar fungsi apa adanya (object jsonb -> object).
  return data;
}

/** Uji koneksi + ambil info acara (juga dipakai indikator Online/Offline). */
export function eventInfo() {
  return rpc('event_info', {}, { timeoutMs: 8000 });
}

/* ------------------------------------------------------- fungsi bertanda PIN */
const withPin = (fn) => (...args) => fn(...args);

export const api = {
  // publik
  eventInfo,
  getInvite: (token) => rpc('get_invite', { p_token: token }),
  confirmAttendance: (token) => rpc('confirm_attendance', { p_token: token }),
  walkinRegister: (name, phone, org, family) =>
    rpc('walkin_register', {
      p_name: name, p_phone: phone, p_org: org || null, p_family: Number(family) || 0
    }),

  // petugas
  staffData: (pin) => rpc('staff_data', { p_pin: pin }),
  staffClaimNumbers: (pin, size = 40) => rpc('staff_claim_numbers', { p_pin: pin, p_size: size }),
  staffSync: (pin, items) => rpc('staff_sync', { p_pin: pin, p_items: items }),

  // admin
  adminCheck: (pin) => rpc('admin_check', { p_pin: pin }),
  adminGetAll: (pin) => rpc('admin_get_all', { p_pin: pin }),
  adminImport: (pin, rows) => rpc('admin_import', { p_pin: pin, p_rows: rows }),
  adminSetSetting: (pin, key, value) => rpc('admin_set_setting', { p_pin: pin, p_key: key, p_value: value }),
  adminChangePin: (pin, target, newPin) =>
    rpc('admin_change_pin', { p_pin: pin, p_target: target, p_new_pin: newPin }),
  adminToggle: (pin, id, attended) => rpc('admin_toggle', { p_pin: pin, p_id: id, p_attended: attended }),
  adminUpdate: (pin, id, fields) => rpc('admin_update', { p_pin: pin, p_id: id, p_fields: fields }),
  adminDelete: (pin, id) => rpc('admin_delete', { p_pin: pin, p_id: id }),
  adminAdd: (pin, payload) => rpc('admin_add', {
    p_pin: pin,
    p_name: payload.name,
    p_phone: payload.phone || null,
    p_org: payload.org || null,
    p_family: Number(payload.family_count) || 0,
    p_attended: payload.attended !== false,
    p_invited: Boolean(payload.invited)
  }),
  adminPrizeSave: (pin, prize) => rpc('admin_prize_save', {
    p_pin: pin,
    p_name: prize.name,
    p_qty: Number(prize.qty) || 1,
    p_id: prize.id || null,
    p_order: Number(prize.sort_order) || 0
  }),
  adminPrizeDelete: (pin, id) => rpc('admin_prize_delete', { p_pin: pin, p_id: id }),
  adminWinnerDelete: (pin, id) => rpc('admin_winner_delete', { p_pin: pin, p_id: id }),
  drawRecord: (pin, rec) => rpc('draw_record', {
    p_pin: pin,
    p_id: rec.id,
    p_prize_id: rec.prize_id,
    p_participant: rec.participant_id,
    p_status: rec.status,
    p_drawn_at: rec.drawn_at || new Date().toISOString()
  }),
  adminReset: (pin, scope) => rpc('admin_reset', { p_pin: pin, p_scope: scope })
};

export default api;
