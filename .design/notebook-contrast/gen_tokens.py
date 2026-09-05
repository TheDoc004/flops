import os, json
OUT = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(OUT,'gen.py')).read().split('SHELL = """')[0])  # reuse helpers + token sets

def toward(hex_a, hex_b, tstep):
    a = [int(hex_a.lstrip('#')[i:i+2],16) for i in (0,2,4)]
    b = [int(hex_b.lstrip('#')[i:i+2],16) for i in (0,2,4)]
    c = [round(a[i] + (b[i]-a[i])*tstep) for i in range(3)]
    return '#%02x%02x%02x' % tuple(c)

def fix(fg, bg, target=4.6):
    """Walk the foreground toward black or white until it clears AA."""
    dest = '#000000' if lum(bg) > 0.35 else '#ffffff'
    for i in range(1, 101):
        cand = toward(fg, dest, i/100)
        if cr(cand, bg) >= target:
            return cand
    return dest

CASES = [
  dict(token='--color-success', theme='Today (:root)', surface=TODAY['surface'],
       cur=TODAY['success'], sample='Protein on target', size=12, weight=600,
       used='.macro-status.is-ok &middot; .weight-status.is-saved &middot; paste-meal confirmation'),
  dict(token='--color-text-faint', theme='Past / Future', surface=PAST['surface'],
       cur=PAST['faint'], sample='1 serving &middot; 08:15', size=12, weight=400,
       used='64 call sites &mdash; .empty-state, log-row meta, timestamps'),
  dict(token='--color-primary', theme='Past / Future', surface=PAST['surface'],
       cur=PAST['ghostFg'], sample='Paste last meal', size=13, weight=500,
       used='.btn-ghost label (no notebook override exists)'),
]
for c in CASES:
    c['fixed'] = fix(c['cur'], c['surface'])
    c['crCur'] = fmt(c['cur'], c['surface'])
    c['crFix'] = fmt(c['fixed'], c['surface'])

def row(c):
    dark = lum(c['surface']) < 0.35
    label_fg = '#f4f4f5' if dark else '#1a1a1a'
    meta_fg  = '#c4c4c8' if dark else '#6b7280'
    return f"""
    <div style="display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:0;border-top:1px solid #e6e1d7;">
      <div style="padding:16px 18px;">
        <p style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;font-weight:600;color:#111827;">{c['token']}</p>
        <p style="margin:4px 0 0;font-size:12px;color:#6b7280;">{c['theme']}</p>
        <p style="margin:8px 0 0;font-size:12px;color:#6b7280;line-height:1.5;">{c['used']}</p>
      </div>
      <div style="padding:16px 18px;border-left:1px solid #f0ede8;background:#fdfcfa;">
        <p style="margin:0 0 8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;letter-spacing:0.06em;text-transform:uppercase;font-weight:700;color:#9a3412;">Now &mdash; {c['crCur']}</p>
        <div style="padding:12px 14px;border-radius:8px;background:{c['surface']};outline:1.5px dashed #fb923c;outline-offset:2px;">
          <span style="font-size:{c['size']}px;font-weight:{c['weight']};color:{c['cur']};">{c['sample']}</span>
        </div>
        <p style="margin:10px 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#6b7280;">{c['cur']}</p>
      </div>
      <div style="padding:16px 18px;border-left:1px solid #f0ede8;background:#fdfcfa;">
        <p style="margin:0 0 8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;letter-spacing:0.06em;text-transform:uppercase;font-weight:700;color:#065f46;">Proposed &mdash; {c['crFix']}</p>
        <div style="padding:12px 14px;border-radius:8px;background:{c['surface']};">
          <span style="font-size:{c['size']}px;font-weight:{c['weight']};color:{c['fixed']};">{c['sample']}</span>
        </div>
        <p style="margin:10px 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#6b7280;">{c['fixed']}</p>
      </div>
    </div>"""

body = f"""<div class="sheet">
  <div style="padding:22px 18px 16px;">
    <h1 style="margin:0;font-family:'DM Serif Display',Georgia,serif;font-size:28px;font-weight:400;color:#1e3a8a;letter-spacing:-0.02em;">Three tokens under AA</h1>
    <p style="margin:8px 0 0;font-size:14px;color:#374151;max-width:70ch;line-height:1.6;">
      Every other pair in the palette clears 4.5:1. These three sit between 3.58 and 4.44 &mdash; readable,
      but under the threshold at the sizes they are actually used. The proposed values are the smallest
      step along the same hue that clears AA with a little headroom.
    </p>
  </div>
  <div style="display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));padding:0 18px;">
    <p style="margin:0 0 8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;letter-spacing:0.06em;text-transform:uppercase;font-weight:700;color:#6b7280;">Token</p>
    <p style="margin:0 0 8px 18px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;letter-spacing:0.06em;text-transform:uppercase;font-weight:700;color:#6b7280;">Current</p>
    <p style="margin:0 0 8px 18px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;letter-spacing:0.06em;text-transform:uppercase;font-weight:700;color:#6b7280;">Proposed</p>
  </div>
  <div style="padding:0 18px 18px;">{''.join(row(c) for c in CASES)}
  </div>
</div>"""

sheet = """<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&display=swap">
  <style>
    body { margin: 0; }
    .sheet {
      width: 1200px; height: 640px; box-sizing: border-box;
      background: #faf9f7; color: #1a1a1a;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      overflow: hidden;
    }
    a { color: #2563eb; } a:hover { color: #1d4ed8; }
  </style>
</helmet>
""" + body + """
</x-dc>
</body>
</html>
"""
with open(os.path.join(OUT,'Tokens.dc.html'),'w') as f: f.write(sheet)

# ---- canvas.json ----
COLS = {'Today': 0, 'Past': 640, 'Future': 1280}
artboards = []
for label, x in COLS.items():
    dash = 'Main.dc.html' if label == 'Today' else f'{label}Dashboard.dc.html'
    artboards.append({'file': dash, 'x': x, 'y': 0, 'w': 560, 'h': 760})
    artboards.append({'file': f'{label}LogMeal.dc.html', 'x': x, 'y': 880, 'w': 560, 'h': 700})
    artboards.append({'file': f'{label}AiEstimate.dc.html', 'x': x, 'y': 1700, 'w': 560, 'h': 700})
artboards.append({'file': 'Tokens.dc.html', 'x': 0, 'y': 2520, 'w': 1200, 'h': 640})

canvas = {
  'artboards': artboards,
  'annotations': [
    {'id': 'how-to-read', 'x': -360, 'y': 0, 'w': 300,
     'text': 'Columns are the three themes; rows are Dashboard, Log a Meal, AI Estimate.\n\nDashed orange ring = a pair under 4.5:1. The chip beside it is the measured ratio.'},
    {'id': 'success-note', 'x': -360, 'y': 220, 'w': 300,
     'text': f"--color-success on cream is {fmt(TODAY['success'], TODAY['surface'])} at 12px in .macro-status.is-ok.\n\nThe worst pair in the palette, and it is in the LIGHT theme. The notebook equivalent passes at {fmt(PAST['success'], PAST['surface'])}."},
    {'id': 'faint-note', 'x': -360, 'y': 460, 'w': 300,
     'text': f"--color-text-faint is {fmt(PAST['faint'], PAST['surface'])} off-today.\n\nThe light theme already fixed this once (#9ca3af -> #6b7280, per the comment in index.css). The notebook override reintroduced a light faint and never got the same treatment."},
    {'id': 'ghost-note', 'x': -360, 'y': 760, 'w': 300,
     'text': f"--color-primary as .btn-ghost text is {fmt(PAST['ghostFg'], PAST['surface'])} off-today.\n\nbtn-primary, btn-ai and btn-secondary all have notebook overrides. btn-ghost has none."},
    {'id': 'passes-note', 'x': -360, 'y': 1060, 'w': 300,
     'text': 'What already holds up: modal chrome, inputs, the highlight panel, btn-primary, btn-ai and status colours all clear AA in all three themes. The dialog overrides are doing their job.'},
  ],
  'launch': {'view': 'canvas'},
}
with open(os.path.join(OUT,'canvas.json'),'w') as f: json.dump(canvas, f, indent=2)

print('Tokens.dc.html + canvas.json written')
for c in CASES:
    print(f"  {c['token']:22s} {c['cur']} {c['crCur']:>8s}  ->  {c['fixed']} {c['crFix']:>8s}")
