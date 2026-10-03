#!/usr/bin/env python3
"""Erzeugt das App-Logo (web/icons/icon.svg und icon-maskable.svg).

Umriss von Rheinland-Pfalz aus den Ländergrenzen von github.com/isellsoap/deutschlandGeoJSON (niedrige Auflösung),
darin diagonale Bänder in Schwarz-Rot-Gold, leicht versetzte Füllung mit weißem Umriss, Lupe für den „Blick“ (Karte und Lupe als mittig gesetzte Gruppe).
PNG-Fassungen danach mit scripts/icons.sh rendern.
"""
import json
import math
import urllib.request
from pathlib import Path

QUELLE = 'https://raw.githubusercontent.com/isellsoap/deutschlandGeoJSON/main/2_bundeslaender/4_niedrig.geo.json'
ZIEL = Path(__file__).resolve().parent.parent / 'web' / 'icons'

GRUND = '#7b2736'  # Weinrot der App
SCHWARZ, ROT, GOLD = '#1b1b1b', '#d9324a', '#f2c230'
WEISS = '#ffffff'


def umriss() -> list[tuple[float, float]]:
    with urllib.request.urlopen(QUELLE) as r:
        daten = json.load(r)
    land = next(f for f in daten['features'] if f['properties']['name'] == 'Rheinland-Pfalz')
    g = land['geometry']
    flaechen = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    ring = max((f[0] for f in flaechen), key=len)
    breite = math.radians(49.9)  # einfache Projektion: Längengrade mit cos(Breite) stauchen
    return [(lon * math.cos(breite), -lat) for lon, lat in ring]


def pfad(punkte, x0, y0, groesse, dx=0.0, dy=0.0) -> str:
    xs = [p[0] for p in punkte]
    ys = [p[1] for p in punkte]
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    s = groesse / max(w, h)
    cx, cy = x0 + (groesse - w * s) / 2, y0 + (groesse - h * s) / 2
    return 'M' + ' L'.join(f'{cx + (x - min(xs)) * s + dx:.1f},{cy + (y - min(ys)) * s + dy:.1f}' for x, y in punkte) + ' Z'


# Feinausgleich in Gruppenkoordinaten (gemessen: die Näherung der Umrandung weicht um wenige Pixel ab)
AUSGLEICH = (5.8, -5.8)


def gruppe_bbox(punkte, kx, ky, kg, dx, dy, lupe) -> tuple[float, float, float, float]:
    """Umschließendes Rechteck von Karte (samt versetzter Füllung) und Lupe, im Koordinatensystem vor der Zentrierung."""
    xs = [p[0] for p in punkte]
    ys = [p[1] for p in punkte]
    s = kg / max(max(xs) - min(xs), max(ys) - min(ys))
    w, h = (max(xs) - min(xs)) * s, (max(ys) - min(ys)) * s
    x0, y0 = kx + (kg - w) / 2 + min(dx, 0), ky + (kg - h) / 2 + min(dy, 0)
    x1, y1 = kx + (kg + w) / 2 + max(dx, 0), ky + (kg + h) / 2 + max(dy, 0)
    cx, cy, r, sw, griff = lupe
    aussen = r + sw / 2
    ende = ((r + sw / 2 + griff) * math.sqrt(0.5), (r + sw / 2 + griff) * math.sqrt(0.5))
    # Griff zeigt nach unten links (Drehung 45°)
    gx, gy = cx - ende[0], cy + ende[1]
    return (min(x0, cx - aussen, gx - 11), min(y0, cy - aussen), max(x1, cx + aussen), max(y1, gy + 11))


def logo(punkte, rx: int, inhalt: float = 1.0, gruppe: float = 400.0) -> str:
    """rx: Eckenradius des Hintergrunds; inhalt: Skalierung des Motivs um die Mitte (maskierbare Icons: 0.8).

    Karte und Lupe werden als Gruppe in die Mitte gesetzt (gleiche Ränder), die längere Seite der Gruppe misst `gruppe` Pixel
    (von 512). Lupe überlappt die Karte unten links; die Bänder sind auf die Kartengröße abgestimmt.
    """
    kg, kx, ky = 340, 100, 66            # Kartenbox (Kantenlänge, linke obere Ecke) vor der Zentrierung
    dx, dy = -10 * kg / 360, 8 * kg / 360  # leicht versetzte Füllung
    lupe = (140, 368, 56, 18, 64)         # Mittelpunkt x/y, Radius, Randstärke, Griff
    x0, y0, x1, y1 = gruppe_bbox(punkte, kx, ky, kg, dx, dy, lupe)
    s = gruppe / max(x1 - x0, y1 - y0) * inhalt
    tx, ty = 256 - s * ((x0 + x1) / 2 + AUSGLEICH[0]), 256 - s * ((y0 + y1) / 2 + AUSGLEICH[1])
    p = pfad(punkte, kx, ky, kg)
    versetzt = pfad(punkte, kx, ky, kg, dx, dy)
    luecke = 12
    f = kg / 360                          # Bänder wie im ursprünglichen 360er Entwurf, auf die Kartenbox umgerechnet
    cx, cy, r, sw, griff = lupe
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><clipPath id="land"><path d="{versetzt}"/></clipPath></defs>
  <rect width="512" height="512" rx="{rx}" fill="{GRUND}"/>
  <g transform="translate({tx:.1f},{ty:.1f}) scale({s:.4f})">
    <g clip-path="url(#land)">
      <g transform="translate({kx},{ky}) scale({f:.4f}) translate(-76,-76)">
        <rect width="512" height="512" fill="{ROT}"/>
        <polygon points="0,0 512,0 512,215 0,95" fill="{SCHWARZ}"/>
        <polygon points="0,345 512,300 512,512 0,512" fill="{GOLD}"/>
        <polygon points="0,95 512,215 512,{215 + luecke} 0,{95 + luecke}" fill="{GRUND}"/>
        <polygon points="0,{345 - luecke} 512,{300 - luecke} 512,300 0,345" fill="{GRUND}"/>
      </g>
    </g>
    <path d="{p}" fill="none" stroke="{WEISS}" stroke-width="7" stroke-linejoin="round"/>
    <g transform="translate({cx},{cy}) rotate(45)">
      <circle r="{r}" fill="{GRUND}" stroke="{WEISS}" stroke-width="{sw}"/>
      <circle r="{r - sw / 2 - 3}" fill="{WEISS}" fill-opacity="0.18"/>
      <rect x="-11" y="{r + sw / 2 - 2}" width="22" height="{griff + 2}" rx="11" fill="{WEISS}"/>
    </g>
  </g>
</svg>
'''


if __name__ == '__main__':
    punkte = umriss()
    (ZIEL / 'icon.svg').write_text(logo(punkte, rx=112))
    (ZIEL / 'icon-maskable.svg').write_text(logo(punkte, rx=0, inhalt=0.8))  # Android: Sicherheitszone
    (ZIEL / 'icon-apple.svg').write_text(logo(punkte, rx=0, gruppe=420))     # iOS rundet selbst, Motiv darf groß sein
    print(f'Logo geschrieben: {ZIEL}/icon.svg, icon-maskable.svg, icon-apple.svg')
