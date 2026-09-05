import os, json
OUT = os.path.dirname(os.path.abspath(__file__))

# ---- contrast helpers (same math as the audit) ----
def lin(c):
    c = c/255
    return c/12.92 if c <= 0.03928 else ((c+0.055)/1.055)**2.4
def lum(h):
    h = h.lstrip('#'); r,g,b = (int(h[i:i+2],16) for i in (0,2,4))
    return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b)
def cr(a,b):
    la,lb = lum(a),lum(b); hi,lo = max(la,lb),min(la,lb)
    return (hi+0.05)/(lo+0.05)
def fmt(a,b): return f"{cr(a,b):.2f}:1"

# ---- resolved token sets, lifted from client/src/styles/index.css ----
TODAY = dict(
  bg='#f3ede3', surface='#faf9f7', surfaceBorder='#e8e4dc', inputBorder='#d1d5db',
  border='#e5e7eb', dividerWarm='#f0ede8', dividerStrong='#e6e1d7',
  text='#1a1a1a', strong='#111827', body='#374151', muted='#6b7280', faint='#6b7280',
  primary='#1d4ed8', primaryInk='#1e3a8a', primarySubtle='#eff6ff', link='#2563eb',
  success='#059669', secondaryBg='#f3f4f6', secondaryBorder='#e5e7eb', ringTrack='#e6e1d7',
  hitBg='#d1fae5', hitBorder='#6ee7b7', hitText='#065f46',
  btnPrimaryBg='#1d4ed8', btnPrimaryFg='#ffffff',
  btnAiBg='#eff6ff', btnAiFg='#1d4ed8', btnAiBorder='#e5e7eb',
  btnSecondaryFg='#1d4ed8', ghostFg='#1d4ed8',
  shadowCard='0 1px 3px rgba(0,0,0,0.07)', shadowModal='0 8px 32px rgba(0,0,0,0.10)',
  scrim='rgba(26,26,26,0.34)',
)
PAST = dict(TODAY,
  bg='#2a2c2e', surface='#3a3d40', surfaceBorder='#4a4e52', inputBorder='#5b6168',
  border='#52525b', dividerWarm='#3f4246', dividerStrong='#52525b',
  text='#f4f4f5', strong='#fafafa', body='#e4e4e7', muted='#c4c4c8', faint='#a1a1aa',
  primary='#60a5fa', primaryInk='#dbeafe', primarySubtle='#1e3a5f', link='#93c5fd',
  success='#8fbfa8', secondaryBg='#3f4246', secondaryBorder='#52525b', ringTrack='#4a4e52',
  hitBg='#2f3d38', hitBorder='#4a6b5c', hitText='#8fbfa8',
  btnPrimaryBg='#1d4ed8', btnPrimaryFg='#f8fafc',
  btnAiBg='#1e3a5f', btnAiFg='#dbeafe', btnAiBorder='#60a5fa',
  btnSecondaryFg='#fafafa', ghostFg='#60a5fa',
  shadowCard='0 1px 3px rgba(0,0,0,0.28)', shadowModal='0 10px 28px rgba(0,0,0,0.35)',
  scrim='rgba(10,11,12,0.55)',
)
FUTURE = dict(PAST,
  bg='#2c2a28', surface='#3d3a37', surfaceBorder='#524e4a',
  dividerWarm='#42403c', dividerStrong='#52525b',
)
THEMES = [('Today', TODAY, 'today'), ('Past', PAST, 'past'), ('Future', FUTURE, 'future')]

def tokens_css(t):
    return "\n".join(f"      --{k}: {v};" for k, v in [
      ('bg',t['bg']),('surface',t['surface']),('surface-border',t['surfaceBorder']),
      ('input-border',t['inputBorder']),('border',t['border']),('divider-warm',t['dividerWarm']),
      ('divider-strong',t['dividerStrong']),('text',t['text']),('strong',t['strong']),
      ('body',t['body']),('muted',t['muted']),('faint',t['faint']),('primary',t['primary']),
      ('primary-ink',t['primaryInk']),('primary-subtle',t['primarySubtle']),('link',t['link']),
      ('success',t['success']),('secondary-bg',t['secondaryBg']),('secondary-border',t['secondaryBorder']),
      ('ring-track',t['ringTrack']),('hit-bg',t['hitBg']),('hit-border',t['hitBorder']),
      ('hit-text',t['hitText']),('shadow-card',t['shadowCard']),('shadow-modal',t['shadowModal']),
    ])

def flag(ratio_txt, ok):
    """Diagnostic chip — deliberately not app chrome."""
    color = '#065f46' if ok else '#9a3412'
    bg    = '#d1fae5' if ok else '#ffedd5'
    bd    = '#6ee7b7' if ok else '#fdba74'
    return (f'<span style="display:inline-flex;align-items:center;gap:4px;margin-left:8px;'
            f'padding:1px 6px;border-radius:999px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;'
            f'font-size:10px;font-weight:600;letter-spacing:0.01em;white-space:nowrap;'
            f'color:{color};background:{bg};border:1px solid {bd};">{ratio_txt}</span>')

def marked(inner, ok):
    """Dashed ring around a failing sample so the eye finds it on a busy artboard."""
    if ok: return inner
    return (f'<span style="display:inline-flex;align-items:center;border-radius:6px;'
            f'outline:1.5px dashed #fb923c;outline-offset:3px;">{inner}</span>')

SHELL = """<!doctype html>
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
    body {{ margin: 0; }}
    .ab {{
{tokens}
      --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      --font-serif: 'DM Serif Display', Georgia, serif;
      width: 560px; height: {h}px; box-sizing: border-box;
      background: var(--bg); color: var(--text);
      font-family: var(--font-sans); font-size: 15px;
      display: flex; flex-direction: column; overflow: hidden; position: relative;
    }}
    .card {{
      background: var(--surface); border: 1px solid var(--surface-border);
      border-radius: 12px; box-shadow: var(--shadow-card); padding: 16px;
    }}
    .btn {{
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      min-height: 44px; padding: 0 16px; border-radius: 8px; font-size: 15px;
      font-weight: 500; font-family: inherit; border: 1px solid transparent; cursor: pointer;
    }}
    .btn-primary {{ background: var(--btnPrimaryBg); color: var(--btnPrimaryFg); }}
    .btn-secondary {{ background: var(--secondary-bg); color: var(--btnSecondaryFg); border-color: var(--secondary-border); }}
    .btn-ai {{ background: var(--btnAiBg); color: var(--btnAiFg); border-color: var(--btnAiBorder); font-weight: 600; }}
    .btn-ghost {{ background: transparent; color: var(--ghostFg); border-color: transparent; font-weight: 500; }}
    .section-title {{ margin: 0; font-size: 16px; font-weight: 600; color: var(--strong); }}
    .page-title {{
      margin: 0; font-family: var(--font-serif); font-size: 28px; font-weight: 400;
      color: var(--primary-ink); letter-spacing: -0.02em;
    }}
    .field {{
      width: 100%; box-sizing: border-box; min-height: 44px; padding: 0 12px;
      border-radius: 8px; border: 1px solid var(--input-border);
      background: var(--surface); color: var(--text); font-size: 15px;
      font-family: inherit; display: flex; align-items: center;
    }}
    .badge {{
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px;
      letter-spacing: 0.06em; text-transform: uppercase; font-weight: 700;
    }}
    a {{ color: var(--link); }}
    a:hover {{ color: var(--primary); }}
  </style>
</helmet>
{bodyhtml}
</x-dc>
</body>
</html>
"""

def header_strip(label, tone):
    """Identifies which theme this artboard is, in a band that is clearly not app UI."""
    tones = {'today': ('#1a1a1a', '#f3ede3', '#e6e1d7'),
             'past':  ('#f4f4f5', '#2a2c2e', '#4a4e52'),
             'future':('#f4f4f5', '#2c2a28', '#524e4a')}
    fg, bg, bd = tones[tone]
    return (f'<div style="display:flex;align-items:center;justify-content:space-between;'
            f'padding:6px 14px;background:{bg};color:{fg};border-bottom:1px solid {bd};flex-shrink:0;">'
            f'<span class="badge">{label}</span>'
            f'<span class="badge" style="opacity:.55;">{ "html[data-notebook-day]" if tone!="today" else ":root" }</span>'
            f'</div>')

# ---------- artboard bodies ----------
def dashboard_body(t, tone, label):
    ok_success = cr(t['success'], t['surface']) >= 4.5
    ok_faint   = cr(t['faint'],   t['surface']) >= 4.5
    ok_ghost   = cr(t['ghostFg'], t['surface']) >= 4.5
    return f"""<div class="ab">
{header_strip(label, tone)}
  <div style="padding:16px;display:flex;flex-direction:column;gap:14px;overflow:hidden;">

    <div style="display:flex;align-items:center;gap:10px;">
      <div style="width:36px;height:36px;border-radius:8px;border:1px solid var(--surface-border);background:var(--surface);display:flex;align-items:center;justify-content:center;color:var(--muted);">&#8249;</div>
      <div style="flex-grow:1;min-width:0;">
        <p style="margin:0;font-size:13px;"><strong style="color:var(--primary-ink);font-weight:600;">Thursday, 4 September</strong></p>
        <p style="margin:2px 0 0;font-size:13px;color:var(--muted);">2,340 kcal goal</p>
      </div>
      <div style="width:36px;height:36px;border-radius:8px;border:1px solid var(--surface-border);background:var(--surface);display:flex;align-items:center;justify-content:center;color:var(--muted);">&#8250;</div>
    </div>

    <div style="display:flex;gap:8px;">
      <div class="btn btn-ai" style="flex-grow:1;">AI Estimate</div>
      <div class="btn btn-primary" style="flex-grow:1;">Log Meal</div>
    </div>

    <h1 class="page-title">Good evening, Diego</h1>

    <div class="card">
      <h2 class="section-title" style="margin-bottom:12px;">Today&#39;s totals</h2>
      <div style="display:grid;grid-template-columns:repeat(4, minmax(0, 1fr));gap:12px;">
        <div><p style="margin:0;font-size:20px;font-weight:600;color:var(--strong);">1,842</p><p style="margin:2px 0 0;font-size:12px;color:var(--muted);">kcal</p></div>
        <div><p style="margin:0;font-size:20px;font-weight:600;color:var(--strong);">148g</p><p style="margin:2px 0 0;font-size:12px;color:var(--muted);">protein</p></div>
        <div><p style="margin:0;font-size:20px;font-weight:600;color:var(--strong);">176g</p><p style="margin:2px 0 0;font-size:12px;color:var(--muted);">carbs</p></div>
        <div><p style="margin:0;font-size:20px;font-weight:600;color:var(--strong);">61g</p><p style="margin:2px 0 0;font-size:12px;color:var(--muted);">fat</p></div>
      </div>
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--divider-warm);display:flex;align-items:center;flex-wrap:wrap;">
        {marked(f'<span style="font-size:12px;font-weight:600;color:var(--success);">Protein on target</span>', ok_success)}
        {flag(fmt(t['success'], t['surface']), ok_success)}
      </div>
      <p style="margin:6px 0 0;font-size:12px;color:var(--muted);">.macro-status.is-ok &middot; 12px</p>
    </div>

    <div class="card" style="padding:0;">
      <div style="padding:14px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--divider-warm);">
        <h2 class="section-title">Meals</h2>
        <div class="btn btn-ghost" style="min-height:32px;padding:0 8px;font-size:13px;">
          {marked('<span>Paste last meal</span>', ok_ghost)}
        </div>
        {flag(fmt(t['ghostFg'], t['surface']), ok_ghost)}
      </div>
      <div style="padding:12px 16px;border-bottom:1px solid var(--divider-warm);display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="min-width:0;">
          <p style="margin:0;font-size:15px;color:var(--text);">Overnight oats</p>
          <p style="margin:2px 0 0;font-size:12px;">
            {marked('<span style="color:var(--faint);">1 serving &middot; 08:15</span>', ok_faint)}
            {flag(fmt(t['faint'], t['surface']), ok_faint)}
          </p>
        </div>
        <p style="margin:0;font-size:13px;color:var(--muted);white-space:nowrap;">486 kcal</p>
      </div>
      <div style="padding:12px 16px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="min-width:0;">
          <p style="margin:0;font-size:15px;color:var(--text);">Chicken rice prep</p>
          <p style="margin:2px 0 0;font-size:12px;color:var(--faint);">1 serving &middot; 13:40</p>
        </div>
        <p style="margin:0;font-size:13px;color:var(--muted);white-space:nowrap;">712 kcal</p>
      </div>
    </div>

  </div>
</div>"""

def logmeal_body(t, tone, label):
    ok_success = cr(t['success'], t['surface']) >= 4.5
    return f"""<div class="ab">
{header_strip(label + ' &middot; Log a Meal', tone)}
  <div style="flex-grow:1;position:relative;overflow:hidden;">
    <div style="position:absolute;inset:0;padding:16px;opacity:.5;">
      <h1 class="page-title">Good evening, Diego</h1>
      <div class="card" style="margin-top:14px;height:120px;"></div>
      <div class="card" style="margin-top:14px;height:140px;"></div>
    </div>
    <div style="position:absolute;inset:0;background:var(--scrim);"></div>

    <div style="position:absolute;left:20px;right:20px;top:22px;background:var(--surface);color:var(--text);border:1px solid var(--surface-border);border-radius:16px;box-shadow:var(--shadow-modal);padding:18px;display:flex;flex-direction:column;gap:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <h2 class="section-title">Log a Meal</h2>
        <span style="color:var(--muted);font-size:18px;line-height:1;">&times;</span>
      </div>

      <div class="field" style="color:var(--muted);">Search a saved recipe&hellip;</div>

      <div style="padding:10px;border-radius:10px;border:1px solid var(--border);background:var(--secondary-bg);">
        <p style="margin:0;font-size:13px;color:var(--body);">Overnight oats</p>
        <p style="margin:3px 0 0;font-size:12px;color:var(--muted);">486 kcal &middot; 32P / 54C / 14F per serving</p>
      </div>

      <div style="padding:10px 12px;border-radius:10px;border:1px solid var(--secondary-border);background:var(--primary-subtle);color:var(--primary-ink);">
        <p style="margin:0;font-size:13px;font-weight:600;">Micros carried from the label</p>
        <p style="margin:3px 0 0;font-size:12px;">All 4 ingredients measured &mdash; no estimate needed.</p>
      </div>

      <div>
        <p style="margin:0 0 5px;font-size:13px;color:var(--body);">Notes</p>
        <div class="field" style="color:var(--muted);">e.g. post-workout</div>
      </div>

      <div style="display:flex;align-items:center;flex-wrap:wrap;">
        {marked(f'<span style="font-size:12px;font-weight:600;color:var(--success);">Saved as meal prep</span>', ok_success)}
        {flag(fmt(t['success'], t['surface']), ok_success)}
      </div>

      <div style="display:flex;gap:8px;">
        <div class="btn btn-primary" style="flex-grow:1;">Log Meal</div>
        <div class="btn btn-secondary" style="flex-grow:1;">Cancel</div>
      </div>
    </div>
  </div>
</div>"""

def ai_body(t, tone, label):
    ok_faint = cr(t['faint'], t['surface']) >= 4.5
    return f"""<div class="ab">
{header_strip(label + ' &middot; AI Estimate', tone)}
  <div style="flex-grow:1;position:relative;overflow:hidden;">
    <div style="position:absolute;inset:0;padding:16px;opacity:.5;">
      <h1 class="page-title">Good evening, Diego</h1>
      <div class="card" style="margin-top:14px;height:120px;"></div>
      <div class="card" style="margin-top:14px;height:140px;"></div>
    </div>
    <div style="position:absolute;inset:0;background:var(--scrim);"></div>

    <div style="position:absolute;left:20px;right:20px;top:22px;background:var(--surface);color:var(--text);border:1px solid var(--surface-border);border-radius:16px;box-shadow:var(--shadow-modal);padding:18px;display:flex;flex-direction:column;gap:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <h2 class="section-title">AI Estimate</h2>
        <span style="color:var(--muted);font-size:18px;line-height:1;">&times;</span>
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;">
        <div style="align-self:flex-end;max-width:78%;padding:9px 12px;border-radius:12px;background:var(--secondary-bg);color:var(--body);font-size:14px;">
          Two eggs, sourdough toast and half an avocado
        </div>
        <div style="align-self:flex-start;max-width:88%;padding:10px 12px;border-radius:12px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:14px;">
          <p style="margin:0 0 6px;">That comes to roughly:</p>
          <p style="margin:0;font-weight:600;color:var(--strong);">438 kcal &middot; 21P / 30C / 26F</p>
          <p style="margin:6px 0 0;font-size:12px;">
            {marked('<span style="color:var(--faint);">Medium confidence &mdash; avocado size assumed</span>', ok_faint)}
            {flag(fmt(t['faint'], t['surface']), ok_faint)}
          </p>
        </div>
      </div>

      <div style="min-height:70px;padding:10px 12px;border-radius:8px;border:1px solid var(--input-border);background:var(--bg);color:var(--muted);font-size:14px;">
        Add a correction&hellip;
      </div>

      <div style="display:flex;gap:8px;">
        <div class="btn btn-ai" style="flex-grow:1;">Submit</div>
        <div class="btn btn-secondary" style="flex-grow:1;">Cancel</div>
      </div>
      <p style="margin:0;font-size:12px;color:var(--muted);text-align:center;">.btn-ai {fmt(t['btnAiFg'], t['btnAiBg'])} &mdash; passes in all three themes</p>
    </div>
  </div>
</div>"""

# ---------- write artboards ----------
FILES = {}
HEIGHTS = {'dash': 760, 'log': 700, 'ai': 700}
for label, t, tone in THEMES:
    name = 'Main' if tone == 'today' else f'{label}Dashboard'
    FILES[f'{name}.dc.html'] = SHELL.format(tokens=tokens_css(t), h=HEIGHTS['dash'], bodyhtml=dashboard_body(t, tone, label))
    FILES[f'{label}LogMeal.dc.html'] = SHELL.format(tokens=tokens_css(t), h=HEIGHTS['log'], bodyhtml=logmeal_body(t, tone, label))
    FILES[f'{label}AiEstimate.dc.html'] = SHELL.format(tokens=tokens_css(t), h=HEIGHTS['ai'], bodyhtml=ai_body(t, tone, label))

for fn, src in FILES.items():
    with open(os.path.join(OUT, fn), 'w') as f: f.write(src)

print("wrote:", ", ".join(sorted(FILES)))
for label, t, _ in THEMES:
    print(f"  {label:7s} success {fmt(t['success'],t['surface'])}  faint {fmt(t['faint'],t['surface'])}  ghost {fmt(t['ghostFg'],t['surface'])}  btn-ai {fmt(t['btnAiFg'],t['btnAiBg'])}")
