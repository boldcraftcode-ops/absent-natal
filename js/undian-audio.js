/* ==========================================================================
   js/undian-audio.js — efek suara undian bernuansa Natal.

   Semua bunyi DIBUAT di perangkat dengan Web Audio API:
     * tidak ada berkas .mp3/.wav → tidak menambah berat halaman & tetap offline
     * lonceng Natal (FM), pad paduan suara, "Deck the Halls" (glockenspiel),
       drum gulir (snare roll + riser) untuk ketegangan, dan fanfare kemenangan

   API:
     const audio = buatAudioUndian();
     audio.bukaKunci();        // panggil pada gestur pengguna (klik/Spasi)
     audio.mulai();            // mulai undian: roll + musik menegangkan
     audio.berhentiDigit(i);   // digit ke-i terkunci (0..2) → bunyi "tok"
     audio.menang();           // pemenang muncul → fanfare + lonceng
     audio.setVolume(0..1);    // 0 = bisu
   ========================================================================== */

const NOTE = {
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00, B5: 987.77,
  C6: 1046.50, D6: 1174.66, E6: 1318.51, G6: 1567.98, C3: 130.81, G3: 196.00, F3: 174.61
};

/** Melodi "Deck the Halls" (tema Natal, domain publik) — nada & panjang (ketuk). */
const DECK = [
  ['G4', 1], ['F4', 1], ['E4', 1], ['D4', 1],
  ['C4', 1], ['D4', 1], ['E4', 1], ['C4', 1],
  ['D4', 1], ['E4', 0.5], ['F4', 1], ['D4', 1], ['E4', 1], ['F4', 0.5],
  ['G4', 1], ['A4', 1], ['B4', 1], ['C5', 1.5]
];

export function buatAudioUndian() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  let master = null;
  let musik = null;          // gain node musik latar
  let jadwal = [];           // id timeout untuk berhenti
  let aktif = false;
  let volume = 0.85;

  function siap() {
    if (!Ctx) return null;
    if (!ctx) {
      ctx = new Ctx();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  /* ---------------------------------------------------------- alat bantu */
  function nada({ freq, dur = 0.3, tipe = 'sine', vol = 0.2, mulai = 0, tujuan = null, geser = null }) {
    const c = siap();
    if (!c) return null;
    const t0 = c.currentTime + mulai;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = tipe;
    osc.frequency.setValueAtTime(freq, t0);
    if (geser) osc.frequency.exponentialRampToValueAtTime(geser, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, vol), t0 + Math.min(0.03, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(tujuan || master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    return osc;
  }

  /** Lonceng Natal: pembawa + modulasi FM (menyerupai glockenspiel/bell). */
  function lonceng({ freq, dur = 1.1, vol = 0.22, mulai = 0, tujuan = null }) {
    const c = siap();
    if (!c) return;
    const t0 = c.currentTime + mulai;
    const carrier = c.createOscillator();
    const mod = c.createOscillator();
    const modGain = c.createGain();
    const g = c.createGain();
    carrier.type = 'sine';
    mod.type = 'sine';
    carrier.frequency.setValueAtTime(freq, t0);
    mod.frequency.setValueAtTime(freq * 3.01, t0);      // rasio non-harmonik → logam
    modGain.gain.setValueAtTime(freq * 1.4, t0);
    modGain.gain.exponentialRampToValueAtTime(0.001, t0 + dur * 0.6);
    mod.connect(modGain).connect(carrier.frequency);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    carrier.connect(g).connect(tujuan || master);
    carrier.start(t0); mod.start(t0);
    carrier.stop(t0 + dur + 0.05); mod.stop(t0 + dur + 0.05);
  }

  /** Drum gulir (snare roll) yang makin cepat & makin keras → mendebarkan. */
  function drumRoll({ mulai = 0, dur = 6, tujuan = null, vol = 0.12 }) {
    const c = siap();
    if (!c) return;
    let t = 0;
    let jarak = 0.14;
    while (t < dur) {
      const naik = t / dur;
      const waktu = c.currentTime + mulai + t;
      // bunyi pendek: noise burst lewat bandpass
      const panjang = 0.055;
      const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * panjang), c.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2.2);
      }
      const src = c.createBufferSource();
      src.buffer = buffer;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1100 + naik * 1600, waktu);
      bp.Q.value = 0.9;
      const g = c.createGain();
      g.gain.setValueAtTime(vol * (0.35 + naik * 0.9), waktu);
      src.connect(bp).connect(g).connect(tujuan || master);
      src.start(waktu);
      t += jarak;
      jarak = Math.max(0.045, jarak * (1 - 0.012 - naik * 0.02));
    }
  }

  /** Riser: nada naik perlahan menambah ketegangan. */
  function riser({ mulai = 0, dur = 6, tujuan = null }) {
    nada({ freq: 140, geser: 720, dur, tipe: 'triangle', vol: 0.05, mulai, tujuan });
    nada({ freq: 70, geser: 360, dur, tipe: 'sawtooth', vol: 0.035, mulai, tujuan });
  }

  /* ------------------------------------------------------- potongan bunyi */
  function klik() {
    nada({ freq: 660, dur: 0.08, tipe: 'square', vol: 0.08 });
  }

  function tok(nadaDasar = 900) {
    nada({ freq: nadaDasar, dur: 0.16, tipe: 'triangle', vol: 0.14 });
    lonceng({ freq: nadaDasar * 1.5, dur: 0.35, vol: 0.08 });
  }

  /** Mulai undian: drum gulir + riser + "Deck the Halls" pelan di latar. */
  function mulai() {
    const c = siap();
    if (!c) return;
    hentikanMusik();
    aktif = true;

    musik = ctx.createGain();
    musik.gain.setValueAtTime(0.0001, ctx.currentTime);
    musik.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 0.6);
    musik.connect(master);

    // snare roll sepanjang undian (±7 detik) + riser
    drumRoll({ dur: 7, tujuan: musik, vol: 0.1 });
    riser({ dur: 6.6, tujuan: musik });

    // melodi Natal (glockenspiel) berulang selama undian
    const ketuk = 0.26;
    let t = 0;
    for (let ulang = 0; ulang < 3 && t < 6.8; ulang += 1) {
      DECK.forEach(([n, d]) => {
        if (t >= 6.8) return;
        lonceng({ freq: NOTE[n], dur: 0.42, vol: 0.1, mulai: t, tujuan: musik });
        // bas sederhana tiap ketukan panjang
        if (d >= 1) nada({ freq: NOTE.C3, dur: 0.35, tipe: 'sine', vol: 0.06, mulai: t, tujuan: musik });
        t += ketuk * d;
      });
    }
  }

  function hentikanMusik() {
    jadwal.forEach((id) => clearTimeout(id));
    jadwal = [];
    if (musik && ctx) {
      try {
        musik.gain.cancelScheduledValues(ctx.currentTime);
        musik.gain.setValueAtTime(Math.max(0.0001, musik.gain.value), ctx.currentTime);
        musik.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      } catch { /* diabaikan */ }
    }
    musik = null;
    aktif = false;
  }

  /** Digit ke-i berhenti (0 = paling kiri): bunyi "tok" makin tinggi. */
  function berhentiDigit(i = 0) {
    tok([900, 1150, 1450][i] || 1200);
  }

  /** Pemenang: semua musik ditenangkan lalu fanfare + lonceng Natal. */
  function menang() {
    hentikanMusik();
    const c = siap();
    if (!c) return;
    // lonceng pembuka (C5-G5-C6) lalu akor mayor besar
    [523.25, 783.99, 1046.5].forEach((f, i) => {
      lonceng({ freq: f, dur: 1.6, vol: 0.24, mulai: i * 0.14 });
    });
    // akor C mayor + G mayor bergantian (nuansa paduan suara)
    [{ t: 0.0, f: [523.25, 659.25, 783.99] }, { t: 0.55, f: [587.33, 739.99, 880.0] }]
      .forEach(({ t, f }) => f.forEach((fr) => {
        nada({ freq: fr, dur: 1.1, tipe: 'triangle', vol: 0.07, mulai: t });
      }));
    [1046.5, 1318.51, 1567.98].forEach((f, i) => {
      lonceng({ freq: f, dur: 1.2, vol: 0.18, mulai: 1.1 + i * 0.12 });
    });
    // "kring" konfeti
    for (let i = 0; i < 8; i += 1) {
      lonceng({ freq: 1800 + Math.random() * 1200, dur: 0.3, vol: 0.05, mulai: 1.3 + i * 0.07 });
    }
  }

  /** Undi ulang (pemenang tidak hadir): dua nada turun. */
  function gagal() {
    hentikanMusik();
    nada({ freq: 392, geser: 196, dur: 0.5, tipe: 'triangle', vol: 0.12 });
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, Number(v)));
    if (master) master.gain.value = volume;
    return volume;
  }

  function bukaKunci() { siap(); }

  function hentikanSemua() {
    hentikanMusik();
    if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
  }

  return { bukaKunci, mulai, berhentiDigit, menang, gagal, klik, setVolume, hentikanMusik, hentikanSemua,
    get aktif() { return aktif; } };
}

export { DECK, NOTE };
