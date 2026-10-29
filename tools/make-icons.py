"""Membuat ikon aplikasi sesuai palet referensi (kraft–espresso–bata–olive).
Jalankan: python3 tools/make-icons.py"""
from PIL import Image, ImageDraw
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'icons')
os.makedirs(OUT, exist_ok=True)

ESPRESSO  = (53, 32, 22, 255)     # #352016
KRAFT     = (235, 222, 203, 255)  # #EBDECB
KRAFT_DIM = (203, 189, 166, 255)  # #CBBDA6
BROWN     = (85, 61, 41, 255)     # #553D29
CRANBERRY = (131, 50, 45, 255)    # #83322D
OLIVE     = (69, 80, 38, 255)     # #455026
HONEY     = (217, 169, 107, 255)  # #D9A96B

def draw(size, maskable=False):
    S = size * 4
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(S * (0.22 if not maskable else 0.5))
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=ESPRESSO)

    pad = int(S * (0.085 if maskable else 0.055))
    d.rounded_rectangle([pad, pad, S - 1 - pad, S - 1 - pad],
                        radius=int(r * 0.8), outline=KRAFT_DIM, width=max(2, int(S * 0.008)))

    # tiga blok warna bertumpuk (motif referensi) + satu bar kertas
    inner = 0.16 if maskable else 0.20
    w = int(S * (0.44 if maskable else 0.50))
    x0 = (S - w) // 2
    top = int(S * inner)
    gap = int(S * 0.028)
    h1 = int(S * 0.155); h2 = int(S * 0.155); h3 = int(S * 0.135); h4 = int(S * 0.075)
    rad = max(2, int(S * 0.018))
    y = top
    for h, col in ((h1, BROWN), (h2, CRANBERRY), (h3, OLIVE), (h4, KRAFT)):
        d.rounded_rectangle([x0, y, x0 + w, y + h], radius=rad, fill=col,
                            outline=(235, 222, 203, 120), width=max(1, int(S * 0.005)))
        y += h + gap

    # aksen: bintang kecil karamel di kanan atas blok
    cx, cy, sr = S * 0.80, S * 0.155, S * 0.038
    pts = []
    for k in range(10):
        ang = -3.14159 / 2 + k * 3.14159 / 5
        rr = sr if k % 2 == 0 else sr * 0.45
        pts.append((cx + rr * __import__('math').cos(ang), cy + rr * __import__('math').sin(ang)))
    d.polygon(pts, fill=HONEY)

    # butiran salju
    for (px, py, pr) in [(0.13, 0.14, 0.019), (0.88, 0.60, 0.016),
                         (0.10, 0.82, 0.013), (0.90, 0.88, 0.019), (0.72, 0.80, 0.012)]:
        d.ellipse([S * (px - pr), S * (py - pr), S * (px + pr), S * (py + pr)], fill=(255, 253, 247, 225))

    return img.resize((size, size), Image.LANCZOS)

draw(192).save(os.path.join(OUT, 'icon-192.png'))
draw(512).save(os.path.join(OUT, 'icon-512.png'))
draw(512, maskable=True).save(os.path.join(OUT, 'maskable-512.png'))
draw(180).save(os.path.join(OUT, 'apple-touch-icon.png'))
draw(32).save(os.path.join(OUT, 'favicon-32.png'))
print('ikon dibuat:', ', '.join(sorted(os.listdir(OUT))))
