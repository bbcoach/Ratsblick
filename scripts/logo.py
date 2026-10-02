#!/usr/bin/env python3
"""Erzeugt das App-Logo (web/icons/icon.svg und icon-maskable.svg).

Umriss von Rheinland-Pfalz aus den Ländergrenzen von github.com/isellsoap/deutschlandGeoJSON (niedrige Auflösung),
darin diagonale Bänder in Schwarz-Rot-Gold, leicht versetzte Füllung mit weißem Umriss, Lupe für den „Blick“.
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


def logo(punkte, rx: int, inhalt: float = 1.0) -> str:
    """rx: Eckenradius des Hintergrunds; inhalt: Skalierung des Motivs um die Mitte (maskierbare Icons: 0.8)."""
    p = pfad(punkte, 76, 76, 360)
    versetzt = pfad(punkte, 76, 76, 360, -10, 8)
    luecke = 12
    t = (256 * (1 - inhalt))
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><clipPath id="land"><path d="{versetzt}"/></clipPath></defs>
  <rect width="512" height="512" rx="{rx}" fill="{GRUND}"/>
  <g transform="translate({t:.1f},{t:.1f}) scale({inhalt})">
    <g clip-path="url(#land)">
      <rect width="512" height="512" fill="{ROT}"/>
      <polygon points="0,0 512,0 512,215 0,95" fill="{SCHWARZ}"/>
      <polygon points="0,345 512,300 512,512 0,512" fill="{GOLD}"/>
      <polygon points="0,95 512,215 512,{215 + luecke} 0,{95 + luecke}" fill="{GRUND}"/>
      <polygon points="0,{345 - luecke} 512,{300 - luecke} 512,300 0,345" fill="{GRUND}"/>
    </g>
    <path d="{p}" fill="none" stroke="{WEISS}" stroke-width="7" stroke-linejoin="round"/>
    <g transform="translate(150,380) rotate(45)">
      <circle r="54" fill="{GRUND}" stroke="{WEISS}" stroke-width="16"/>
      <circle r="38" fill="{WEISS}" fill-opacity="0.18"/>
      <rect x="-11" y="60" width="22" height="64" rx="11" fill="{WEISS}"/>
    </g>
  </g>
</svg>
'''


if __name__ == '__main__':
    punkte = umriss()
    (ZIEL / 'icon.svg').write_text(logo(punkte, rx=112))
    (ZIEL / 'icon-maskable.svg').write_text(logo(punkte, rx=0, inhalt=0.8))
    print(f'Logo geschrieben: {ZIEL}/icon.svg, icon-maskable.svg')
