#!/usr/bin/env python3
"""
tools/make-cards-pdf.py
Contoh PDF kartu undangan siap cetak (dasar kartu 10 x 15 cm).

Susunan (opsi baris perintah):
  --4-per-a4    (bawaan) 4 kartu / lembar A4, kartu 95 x 142,5 mm (95%)
  --2-per-a4             2 kartu / lembar A4, kartu tepat 100 x 150 mm
  --4-per-a3             4 kartu / lembar A3, kartu tepat 100 x 150 mm
  --satu-per-halaman     1 kartu / halaman 100 x 150 mm

Catatan: 4 kartu 10 x 15 cm tidak mungkin muat di A4 — 2 x 150 mm = 300 mm,
sedangkan tinggi A4 297 mm. Karena itu mode 4-per-A4 memakai kartu 95%.

Jalankan:  python3 tools/make-cards-pdf.py [keluaran.pdf] [opsi]

QR pada PDF contoh ini adalah pola pengganti (bukan QR asli) — yang diperiksa
adalah tata letaknya; QR asli per tamu dibuat di panel admin.
"""
import sys
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "kartu-undangan-10x15-contoh.pdf"
CARD_W, CARD_H = 100 * mm, 150 * mm          # 10 x 15 cm (ukuran dasar)
MARGIN = 4 * mm                              # tepi kertas

# susunan kartu yang didukung
LAYOUTS = {
    "4a4": dict(cols=2, rows=2, scale=0.95, page="A4"),   # 4 kartu/A4 (kartu 95%)
    "2a4": dict(cols=2, rows=1, scale=1.00, page="A4"),   # 2 kartu/A4 (kartu 100%)
    "4a3": dict(cols=2, rows=2, scale=1.00, page="A3"),   # 4 kartu/A3 (kartu 100%)
    "1x": dict(cols=1, rows=1, scale=1.00, page="10x15"),  # 1 kartu/halaman 10x15
}
PAGE_SIZE = {"A4": A4, "A3": (297 * mm, 420 * mm), "10x15": (CARD_W, CARD_H)}

if "--2-per-a4" in sys.argv:
    MODE = "2a4"
elif "--4-per-a3" in sys.argv:
    MODE = "4a3"
elif "--satu-per-halaman" in sys.argv:
    MODE = "1x"
else:
    MODE = "4a4"
LAYOUT = LAYOUTS[MODE]
SCALE = LAYOUT["scale"]

KRAFT_50, KRAFT_100 = HexColor("#F7F0E4"), HexColor("#EBDECB")
KRAFT_300, KRAFT_500 = HexColor("#CBBDA6"), HexColor("#A98D6E")
COCOA_800, COCOA_700 = HexColor("#352016"), HexColor("#553D29")
CRAN_800, CRAN_700 = HexColor("#6E2622"), HexColor("#83322D")
OLIVE_600, OLIVE_700 = HexColor("#455026"), HexColor("#3F4D2A")
HONEY_500, HONEY_400 = HexColor("#C08A4E"), HexColor("#D9A96B")
INK_SOFT = HexColor("#7A6650")

EVENT = {
    "name": "Perayaan Natal 2026",
    "org": "GBI JALAN KEMULIAAN · MEDAN",
    "when": "Kamis, 24 Desember 2026 · 18.00 WIB",
    "place": "Gedung Elim, Jl. Gatot Subroto No. 12",
}

GUESTS = [
    ("Budi Santoso", "Divisi TI", "a1b2c3d4e5f60718"),
    ("Siti Aminah", "Divisi Keuangan", "1122334455aabbcc"),
    ("Rudi Hartono", "Wilayah Medan Kota", "99aabbccddeeff00"),
    ("Maria Sinaga", "Wilayah Medan Baru", "0f1e2d3c4b5a6978"),
]


def fake_qr_matrix(token: str, size: int = 25):
    """Matriks pseudo-QR deterministik (pola pengganti untuk contoh cetak)."""
    h = 2166136261
    for ch in token:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    grid = [[False] * size for _ in range(size)]

    def finder(ox, oy):
        for y in range(7):
            for x in range(7):
                edge = x in (0, 6) or y in (0, 6)
                core = 2 <= x <= 4 and 2 <= y <= 4
                grid[oy + y][ox + x] = edge or core

    for y in range(size):
        for x in range(size):
            h = ((h ^ (x * 31 + y * 17)) * 16777619) & 0xFFFFFFFF
            grid[y][x] = (h >> 13) % 100 < 47
    finder(0, 0)
    finder(size - 7, 0)
    finder(0, size - 7)
    return grid


def draw_card(c: canvas.Canvas, x: float, y: float, guest, index: int, total: int):
    """Gambar satu kartu 10x15 cm (diskalakan SCALE) sudut kiri-bawah (x, y)."""
    name, org, token = guest
    c.saveState()
    c.translate(x, y)
    c.scale(SCALE, SCALE)
    x = y = 0

    # --- latar & bingkai
    c.saveState()
    c.setFillColor(KRAFT_50)
    c.setStrokeColor(HexColor("#B9A68C"))
    c.setLineWidth(0.3)
    c.roundRect(x, y, CARD_W, CARD_H, 3 * mm, stroke=1, fill=1)
    # gradasi lembut (tiga pita warna tipis)
    for i, col in enumerate((HexColor("#FFFAF1"), KRAFT_50, HexColor("#F0DFC4"))):
        c.setFillColor(col)
        c.rect(x + 0.3, y + 0.3 + i * (CARD_H - 0.6) / 3, CARD_W - 0.6, (CARD_H - 0.6) / 3,
               stroke=0, fill=1)
    c.setFillColor(KRAFT_50)
    c.roundRect(x, y, CARD_W, CARD_H, 3 * mm, stroke=0, fill=1)

    pad = 6 * mm
    ix, iw = x + pad, CARD_W - 2 * pad
    top = y + CARD_H - pad

    # --- pita warna di atas
    c.setFillColor(CRAN_700)
    c.rect(ix, top - 1.2 * mm, iw * 0.4, 1.2 * mm, stroke=0, fill=1)
    c.setFillColor(HONEY_500)
    c.rect(ix + iw * 0.4, top - 1.2 * mm, iw * 0.25, 1.2 * mm, stroke=0, fill=1)
    c.setFillColor(OLIVE_600)
    c.rect(ix + iw * 0.65, top - 1.2 * mm, iw * 0.35, 1.2 * mm, stroke=0, fill=1)

    # --- bintang & judul acara
    c.setFillColor(HONEY_500)
    c.setFont("Helvetica", 10)
    c.drawCentredString(x + CARD_W / 2, top - 7 * mm, "\u2726")
    c.setFillColor(COCOA_800)
    c.setFont("Times-Bold", 17)
    c.drawCentredString(x + CARD_W / 2, top - 14.5 * mm, EVENT["name"])
    c.setFillColor(CRAN_800)
    c.setFont("Helvetica-Bold", 7.4)
    c.drawCentredString(x + CARD_W / 2, top - 19.5 * mm, EVENT["org"])

    # --- QR (40 x 40 mm) + data tamu
    qr_size = 40 * mm
    qr_x, qr_y = ix, top - 30 * mm - qr_size
    c.setFillColor(white)
    c.setStrokeColor(COCOA_800)
    c.setLineWidth(0.9)
    c.roundRect(qr_x, qr_y, qr_size, qr_size, 2 * mm, stroke=1, fill=1)

    grid = fake_qr_matrix(token)
    n = len(grid)
    inner = qr_size - 3.2 * mm
    cell = inner / n
    c.setFillColor(COCOA_800)
    for gy in range(n):
        for gx in range(n):
            if grid[gy][gx]:
                c.rect(qr_x + 1.6 * mm + gx * cell,
                       qr_y + qr_size - 1.6 * mm - (gy + 1) * cell,
                       cell + 0.04, cell + 0.04, stroke=0, fill=1)

    tx = qr_x + qr_size + 5 * mm
    tw = ix + iw - tx
    c.setFillColor(INK_SOFT)
    c.setFont("Helvetica-Bold", 6.6)
    c.drawString(tx, qr_y + qr_size - 3.4 * mm, "KEPADA")
    c.setFillColor(COCOA_800)
    size = 15.6
    while size > 9:
        if c.stringWidth(name, "Times-Bold", size) <= tw:
            break
        size -= 0.6
    c.setFont("Times-Bold", size)
    c.drawString(tx, qr_y + qr_size - 10 * mm, name)
    c.setFillColor(OLIVE_700)
    c.setFont("Helvetica", 8)
    c.drawString(tx, qr_y + qr_size - 15 * mm, org)

    # --- ornamen pengisi (cemara/salju) agar tengah kartu tidak kosong
    orn_y = qr_y - 12 * mm
    c.setFillColor(HONEY_400)
    c.setFont("Helvetica", 9)
    c.drawCentredString(x + CARD_W / 2, orn_y, "\u2744   \u2726   \u2744   \u2726   \u2744")
    c.setStrokeColor(KRAFT_300)
    c.setLineWidth(0.4)
    c.line(ix + iw * 0.22, orn_y - 4 * mm, ix + iw * 0.78, orn_y - 4 * mm)

    # --- waktu & tempat
    meta_top = qr_y - 26 * mm
    c.setStrokeColor(KRAFT_300)
    c.setLineWidth(0.4)
    c.line(ix, meta_top + 3 * mm, ix + iw, meta_top + 3 * mm)
    c.setFont("Helvetica-Bold", 7.4)
    for i, (label, value) in enumerate((("Waktu", EVENT["when"]), ("Tempat", EVENT["place"]))):
        row_y = meta_top - 2.4 * mm - i * 6.4 * mm
        c.setFillColor(CRAN_800)
        c.drawString(ix, row_y, label)
        c.setFillColor(COCOA_800)
        c.setFont("Helvetica", 7.8)
        c.drawString(ix + 17 * mm, row_y, value)
        c.setFont("Helvetica-Bold", 7.4)

    # --- pita warna penyeimbang di atas catatan kaki
    band_y = y + pad + 13 * mm
    c.setFillColor(OLIVE_600)
    c.rect(ix, band_y, iw * 0.34, 0.8 * mm, stroke=0, fill=1)
    c.setFillColor(HONEY_400)
    c.rect(ix + iw * 0.34, band_y, iw * 0.16, 0.8 * mm, stroke=0, fill=1)
    c.setFillColor(CRAN_700)
    c.rect(ix + iw * 0.50, band_y, iw * 0.50, 0.8 * mm, stroke=0, fill=1)

    # --- catatan kaki
    foot_y = y + pad + 2 * mm
    c.setStrokeColor(KRAFT_500)
    c.setLineWidth(0.4)
    c.setDash(1, 1.6)
    c.line(ix, foot_y + 6 * mm, ix + iw, foot_y + 6 * mm)
    c.setDash()
    c.setFillColor(HONEY_500)
    c.setFont("Helvetica", 8)
    c.drawString(ix, foot_y + 1.2 * mm, "\u2702")
    c.setFillColor(INK_SOFT)
    c.setFont("Helvetica", 6.4)
    c.drawString(ix + 5 * mm, foot_y + 3.4 * mm, "Pindai QR untuk konfirmasi kehadiran.")
    c.drawString(ix + 5 * mm, foot_y + 0.2 * mm, "Nomor undian muncul setelah pindai.")
    c.setFillColor(KRAFT_500)
    c.setFont("Helvetica", 6.2)
    c.drawRightString(ix + iw, foot_y + 1.6 * mm, f"{index:02d}/{total}")
    c.restoreState()
    c.restoreState()


def cut_marks(c: canvas.Canvas, x: float, y: float):
    """Garis potong (dashed) di dalam tepi kartu agar tidak terpotong mesin cetak."""
    c.saveState()
    c.translate(x, y)
    c.scale(SCALE, SCALE)
    x = y = 0
    c.setStrokeColor(HexColor("#C2AE93"))
    c.setLineWidth(0.3)
    c.setDash(2, 2)
    inset = 1.5 * mm
    c.rect(x + inset, y + inset, CARD_W - 2 * inset, CARD_H - 2 * inset, stroke=1, fill=0)
    # tanda sudut kecil (masih dalam skala yang sama)
    c.setStrokeColor(HexColor("#8A7A63"))
    c.setLineWidth(0.5)
    for (cx, cy, dx, dy) in ((x, y, 1, 1), (x + CARD_W, y, -1, 1),
                             (x, y + CARD_H, 1, -1), (x + CARD_W, y + CARD_H, -1, -1)):
        c.line(cx, cy, cx + dx * 5 * mm, cy)
        c.line(cx, cy, cx, cy + dy * 5 * mm)
    c.restoreState()


def build():
    page_w, page_h = PAGE_SIZE[LAYOUT["page"]]
    c = canvas.Canvas(str(OUT), pagesize=(page_w, page_h))
    c.setTitle("Kartu Undangan 10 x 15 cm")
    c.setAuthor("Aplikasi Absensi & Undian Natal")
    total = len(GUESTS)

    if LAYOUT["page"] == "10x15":
        for i, guest in enumerate(GUESTS, start=1):
            draw_card(c, 0, 0, guest, i, total)
            c.showPage()
    else:
        cols, rows = LAYOUT["cols"], LAYOUT["rows"]
        cw, ch = CARD_W * SCALE, CARD_H * SCALE
        gap = 8 * mm
        block_w = cols * cw + (cols - 1) * gap
        block_h = rows * ch + (rows - 1) * gap
        x0 = (page_w - block_w) / 2
        y0 = (page_h - block_h) / 2
        per_page = cols * rows
        for i, guest in enumerate(GUESTS, start=1):
            slot = (i - 1) % per_page
            if slot == 0 and i > 1:
                c.showPage()
            col, row = slot % cols, slot // cols
            x = x0 + col * (cw + gap)
            y = y0 + (rows - 1 - row) * (ch + gap)
            cut_marks(c, x, y)
            draw_card(c, x, y, guest, i, total)
        c.showPage()

    c.save()
    kartu_cm = f"{CARD_W * SCALE / mm / 10:.2f} x {CARD_H * SCALE / mm / 10:.2f} cm"
    print(f"{OUT.name} dibuat ({OUT.stat().st_size / 1024:.0f} KB, {total} kartu "
          f"{kartu_cm}, {per_page_label()})")


def per_page_label() -> str:
    if LAYOUT["page"] == "10x15":
        return "1 kartu/halaman 10x15 cm"
    return f"{LAYOUT['cols'] * LAYOUT['rows']} kartu/lembar {LAYOUT['page']}"


if __name__ == "__main__":
    build()
