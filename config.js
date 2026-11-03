/* ==========================================================================
   config.js — SATU-SATUNYA berkas yang perlu Anda isi manual.
   Ambil nilainya dari Supabase Dashboard > Project Settings > API.
   Gunakan HANYA anon/publishable key (aman untuk browser karena semua
   akses data dibatasi lewat fungsi RPC + PIN).
   ========================================================================== */
window.APP_CONFIG = {
  SUPABASE_URL: 'https://huendbdgtkmgatnulltp.supabase.co',            // contoh: 'https://abcdefghijkl.supabase.co'
  SUPABASE_ANON_KEY: 'sb_publishable_yiXkeLmFBeJltdDCGbbXhw_PXtWJL7o',       // contoh: 'sb_publishable_xxx' atau 'eyJhbGciOi...'

  // Opsional
  DEFAULT_EVENT_NAME: 'Perayaan Natal',
  STAFF_BLOCK_SIZE: 40,        // jumlah nomor yang dijatah ke tiap HP petugas
  STAFF_BLOCK_REFILL_AT: 15,   // isi ulang blok bila sisa < angka ini
  SYNC_INTERVAL_MS: 15000      // auto-sync antrean petugas
};
