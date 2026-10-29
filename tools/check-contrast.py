"""Audit kontras WCAG untuk pasangan warna penting (tema kraft)."""
def lin(c):
    c = c/255
    return c/12.92 if c <= 0.03928 else ((c+0.055)/1.055)**2.4

def L(hexs):
    h = hexs.lstrip('#')
    r,g,b = (int(h[i:i+2],16) for i in (0,2,4))
    return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b)

def ratio(a,b):
    la,lb = L(a),L(b)
    hi,lo = max(la,lb), min(la,lb)
    return (hi+0.05)/(lo+0.05)

pairs = [
 ('teks utama / kertas',        '#352016', '#F5EBD9', 4.5),
 ('teks sekunder / kertas',     '#7A6650', '#F5EBD9', 4.5),
 ('tombol outline / kertas',    '#553D29', '#F5EBD9', 4.5),
 ('label statistik / kertas',   '#7A6650', '#FBEFD8', 4.5),
 ('nilai statistik / kertas',   '#352016', '#FBEFD8', 4.5),
 ('nomor di papan (krem)',      '#EBDECB', '#553D29', 4.5),
 ('nomor karamel / espresso',   '#D9A96B', '#2A1A12', 4.5),
 ('digit d0 / cokelat',         '#EBDECB', '#553D29', 4.5),
 ('digit d1 / bata',            '#EBDECB', '#83322D', 4.5),
 ('digit d2 / olive',           '#EBDECB', '#455026', 4.5),
 ('topbar judul / espresso',    '#F7F0E4', '#352016', 4.5),
 ('topbar sub / espresso',      '#CBBDA6', '#352016', 4.5),
 ('badge online (krem/hijau)',  '#E9EFD2', '#3F4D2A', 4.5),
 ('badge offline (krem/bata)',  '#FBE3DF', '#7A2C27', 4.5),
 ('badge queue (krem/karamel)', '#FCEBD3', '#8A5620', 4.5),
 ('badge plain di kertas',      '#F0E6D5', '#4A3125', 4.5),
 ('pill hadir',                 '#3F4D2A', '#DDE3C8', 4.5),
 ('pill belum',                 '#8A5620', '#F7E6CE', 4.5),
 ('pill walkin',                '#83322D', '#F4DEDA', 4.5),
 ('notice info',                '#6B5530', '#F3EEDF', 4.5),
 ('notice warn',                '#8A5620', '#FBEDD8', 4.5),
 ('notice danger',              '#6E2622', '#FAE6E2', 4.5),
 ('notice success',             '#2E3516', '#EDF0DF', 4.5),
 ('toast ok',                   '#F7F0E4', '#3F4D2A', 4.5),
 ('teks di layar gelap',        '#FFF9EE', '#241A12', 4.5),
 ('sub di layar gelap',         '#CBBDA6', '#241A12', 4.5),
 ('teks sekunder di kraft',     '#5A4632', '#CBBDA6', 4.5),
]
print(f"{'pasangan':30s} {'rasio':>6s}  minimum  status")
bad = 0
for name, fg, bg, minimum in pairs:
    r = ratio(fg, bg)
    ok = r >= minimum
    if not ok: bad += 1
    print(f"{name:30s} {r:6.2f}  {minimum:5.1f}    {'ok' if ok else 'GAGAL'}")
print()
print('semua lulus' if not bad else f'{bad} pasangan perlu diperbaiki')
