import os, json
OUT = os.path.dirname(os.path.abspath(__file__))

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
    body { margin: 0; }
    .ab {
      --bg:#f3ede3; --surface:#faf9f7; --surface-border:#e8e4dc; --input-border:#d1d5db;
      --border:#e5e7eb; --divider:#f3f4f6; --divider-warm:#f0ede8; --divider-strong:#e6e1d7;
      --text:#1a1a1a; --strong:#111827; --body:#374151; --muted:#6b7280; --faint:#6b7280;
      --primary:#1d4ed8; --primary-ink:#1e3a8a; --primary-subtle:#eff6ff; --link:#2563eb;
      --success:#059669; --secondary-bg:#f3f4f6; --secondary-border:#e5e7eb;
      --font-sans:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
      --font-serif:'DM Serif Display',Georgia,serif;
      width:__W__px; height:__H__px; box-sizing:border-box;
      background:var(--bg); color:var(--text); font-family:var(--font-sans); font-size:15px;
      display:flex; flex-direction:column; overflow:hidden;
    }
    .card { background:var(--surface); border:1px solid var(--surface-border); border-radius:12px;
            box-shadow:0 1px 3px rgba(0,0,0,0.07); padding:16px; }
    .btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:44px;
           padding:0 16px; border-radius:8px; font-size:15px; font-weight:500;
           border:1px solid transparent; box-sizing:border-box; }
    .btn-primary { background:var(--primary); color:#fff; }
    .btn-secondary { background:var(--secondary-bg); color:var(--primary); border-color:var(--secondary-border); }
    .btn-ai { background:var(--primary-subtle); color:var(--primary); border-color:var(--border); font-weight:600; }
    .btn-sm { min-height:34px; padding:0 10px; font-size:13px; }
    .page-title { margin:0; font-family:var(--font-serif); font-size:28px; font-weight:400;
                  color:var(--primary-ink); letter-spacing:-0.02em; }
    .page-subtitle { margin:0 0 20px; font-size:15px; color:var(--muted); }
    .section-title { margin:0; font-size:16px; font-weight:600; color:var(--primary-ink); }
    .section-label { font-size:11px; font-weight:600; color:var(--faint); text-transform:uppercase;
                     letter-spacing:0.07em; margin:0; }
    .empty-state { text-align:center; color:var(--faint); padding:32px 0; font-size:15px; margin:0; }
    .field { width:100%; box-sizing:border-box; min-height:44px; padding:0 12px; border-radius:8px;
             border:1px solid var(--input-border); background:var(--surface); color:var(--muted);
             font-size:15px; display:flex; align-items:center; }
    .lede { margin:0; color:var(--muted); font-size:14px; }
    .prev { margin:0; font-size:12px; color:var(--faint); }
    .nav { display:flex; align-items:center; gap:20px; padding:0 20px; height:56px; background:var(--surface);
           border-bottom:1px solid var(--surface-border); flex-shrink:0; }
    .nav a { font-size:14px; color:var(--body); text-decoration:none; }
    .nav a.on { color:var(--primary); font-weight:600; }
    .brand { font-family:var(--font-serif); font-size:20px; color:var(--primary-ink); margin-right:6px; }
    .body { padding:20px; overflow:hidden; display:flex; flex-direction:column; gap:16px; }
    .note { display:inline-flex; align-items:center; gap:5px; padding:2px 7px; border-radius:999px;
            font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:10px; font-weight:600;
            white-space:nowrap; color:#9a3412; background:#ffedd5; border:1px solid #fdba74; }
    .note-ok { color:#065f46; background:#d1fae5; border-color:#6ee7b7; }
    .ring { outline:1.5px dashed #fb923c; outline-offset:3px; border-radius:6px; }
    /* real sub-nav vocabulary */
    .plan-tabs { display:flex; gap:8px; flex-wrap:wrap; }
    .plan-tab { padding:8px 12px; border-radius:999px; border:1px solid var(--border);
                background:var(--surface); color:var(--body); font-size:13px; font-weight:700; }
    .plan-tab.is-active { background:var(--strong); color:var(--surface); border-color:var(--strong); }
    .lib-bar { display:inline-flex; padding:3px; background:var(--divider); border-radius:999px; position:relative; }
    .lib-tab { padding:8px 18px; border-radius:999px; font-size:14px; color:var(--muted); font-weight:500; }
    .lib-tab.on { background:var(--surface); color:var(--primary); box-shadow:0 1px 2px rgba(0,0,0,0.06); }
    .lib-build { display:inline-flex; align-items:center; height:44px; padding:0 20px; border-radius:8px;
                 background:var(--primary); color:#fff; font-size:15.5px; font-weight:600; }
    a { color:var(--link); } a:hover { color:var(--primary); }
  </style>
</helmet>
__BODY__
</x-dc>
</body>
</html>
"""

def page(name, w, h, body):
    open(os.path.join(OUT,name),'w').write(SHELL.replace('__W__',str(w)).replace('__H__',str(h)).replace('__BODY__',body))

# Real nav labels, lifted from Navbar.jsx / BottomNav.jsx
NUTRI = ['Today','Library','Review','Coach','Goals']
GYM   = ['Today','Schedule','Workouts','Progress']

def nav(active, gym=False):
    items = GYM if gym else NUTRI
    links = ''.join(f'<a href="#" class="{"on" if l==active else ""}">{l}</a>' for l in items)
    return f'<div class="nav"><span class="brand">Flops</span>{links}</div>'

def libsub(active):
    return f'''<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <div class="lib-bar">
        <span class="lib-tab {'on' if active=='Recipes' else ''}">Recipes</span>
        <span class="lib-tab {'on' if active=='Ingredients' else ''}">Ingredients</span>
      </div>
      <span class="lib-build">+ Build a meal</span>
    </div>'''

def plansub(active):
    tabs = ''.join(f'<span class="plan-tab {"is-active" if t==active else ""}">{t}</span>' for t in ['Goals','Report','Profile'])
    return f'''<p class="section-label" style="margin-bottom:8px;">Plan</p>
    <div class="card" style="padding:12px;"><div class="plan-tabs">{tabs}</div></div>'''

def rows(items, pad='12px 16px'):
    out=[]
    for i,(n,m,r) in enumerate(items):
        bb = 'border-bottom:1px solid var(--divider-warm);' if i < len(items)-1 else ''
        out.append(f'''<div style="padding:{pad};display:flex;justify-content:space-between;align-items:center;gap:12px;{bb}">
          <div style="min-width:0;"><p style="margin:0;font-size:15px;">{n}</p><p class="prev" style="margin-top:3px;">{m}</p></div>
          <p style="margin:0;font-size:13px;color:var(--muted);white-space:nowrap;">{r}</p></div>''')
    return ''.join(out)

S = {}

S['Main'] = f"""<div class="ab">{nav('Today')}<div class="body">
  <div style="display:flex;align-items:center;gap:10px;">
    <div style="width:36px;height:36px;border-radius:8px;border:1px solid var(--surface-border);background:var(--surface);display:flex;align-items:center;justify-content:center;color:var(--muted);">&#8249;</div>
    <div style="flex-grow:1;"><p style="margin:0;font-size:13px;"><strong style="color:var(--primary-ink);font-weight:600;">Thursday, 4 September</strong></p>
    <p style="margin:2px 0 0;font-size:13px;color:var(--muted);">2,340 kcal goal</p></div>
    <div style="width:36px;height:36px;border-radius:8px;border:1px solid var(--surface-border);background:var(--surface);display:flex;align-items:center;justify-content:center;color:var(--muted);">&#8250;</div>
    <div style="display:flex;gap:8px;margin-left:8px;"><div class="btn btn-ai">AI Estimate</div><div class="btn btn-primary">Log Meal</div></div>
  </div>
  <h1 class="page-title">Good evening, Diego</h1>
  <div class="card"><h2 class="section-title" style="margin-bottom:12px;">Today&#39;s totals</h2>
    <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;">
    {''.join(f'<div><p style="margin:0;font-size:22px;font-weight:600;color:var(--strong);">{v}</p><p style="margin:2px 0 0;font-size:12px;color:var(--muted);">{k}</p></div>' for v,k in [('1,842','kcal'),('148g','protein'),('176g','carbs'),('61g','fat')])}</div>
    <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--divider-warm);display:flex;align-items:center;">
      <span class="ring" style="font-size:12px;font-weight:600;color:var(--success);">Protein on target</span><span class="note" style="margin-left:10px;">3.58:1 &middot; 12px</span></div>
  </div>
  <div class="card" style="padding:0;">
    <div style="padding:14px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--divider-warm);">
      <h2 class="section-title">Meals</h2><div class="btn btn-secondary btn-sm">Paste last meal</div></div>
    {rows([('Overnight oats','1 serving &middot; 08:15','486 kcal'),('Chicken rice prep','1 serving &middot; 13:40','712 kcal'),('Protein smoothie','1 serving &middot; 17:20','312 kcal')])}
  </div>
</div></div>"""

S['Recipes'] = f"""<div class="ab">{nav('Library')}<div class="body">
  {libsub('Recipes')}
  <h1 class="page-title">Recipe Library</h1>
  <div class="card"><div class="field">Type to filter recipes&hellip;</div>
    <div style="margin-top:8px;">{rows([('Overnight oats','486 kcal &middot; 32P / 54C / 14F','1 serving'),('Chicken rice prep','712 kcal &middot; 58P / 74C / 16F','4 servings'),('Protein smoothie','312 kcal &middot; 30P / 34C / 6F','3 uses left')],'12px 0')}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding-top:12px;border-top:1px solid var(--divider-warm);">
      <div class="btn btn-secondary btn-sm">Previous</div><p class="prev">Page 1 of 3</p><div class="btn btn-secondary btn-sm">Next</div></div>
  </div>
</div></div>"""

S['Ingredients'] = f"""<div class="ab">{nav('Library')}<div class="body">
  {libsub('Ingredients')}
  <h1 class="page-title">Ingredient Library</h1>
  <div style="display:flex;gap:8px;"><div class="btn btn-primary">Scan a label</div><div class="btn btn-secondary">Scan barcode</div><div class="btn btn-secondary">Add by hand</div></div>
  <div class="card"><h3 class="section-title" style="margin-bottom:12px;">Your ingredients</h3>
    <div class="field">Search by name, brand, or base label&hellip;</div>
    <div style="margin-top:8px;">{rows([('Chobani 0% Greek yogurt','170 g &middot; 100 kcal &middot; used 24&times;','barcode'),('Rolled oats','40 g &middot; 150 kcal &middot; used 31&times;','scanned label'),('Chicken breast','100 g &middot; 165 kcal &middot; used 18&times;','manual')],'11px 0')}</div>
  </div>
</div></div>"""

S['MealBuilder'] = f"""<div class="ab">{nav('Library')}<div class="body">
  {libsub('')}
  <h1 class="page-title" style="margin-bottom:8px;">Meal Builder</h1>
  <p class="page-subtitle" style="margin-bottom:0;">Build a recipe from your ingredient library, then save it for logging.</p>
  <div style="display:flex;gap:8px;align-items:center;">
    {''.join(f'''<div style="display:flex;align-items:center;gap:7px;"><span style="width:24px;height:24px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;
      background:{'var(--primary)' if i==1 else 'var(--secondary-bg)'};color:{'#fff' if i==1 else 'var(--muted)'};">{i}</span>
      <span style="font-size:13px;color:{'var(--strong)' if i==1 else 'var(--muted)'};font-weight:{600 if i==1 else 400};">{s}</span>
      {'<span style="color:var(--divider-strong);margin:0 4px;">&rarr;</span>' if i<3 else ''}</div>''' for i,s in [(1,'Ingredients'),(2,'Build'),(3,'Review')])}
  </div>
  <div class="card"><h3 class="section-title" style="margin-bottom:12px;">Ingredients</h3>
    <div class="field">Type to add from your library&hellip;</div>
    <div style="margin-top:8px;">{rows([('Rolled oats','80 g','300 kcal'),('Chobani 0% Greek yogurt','170 g','100 kcal'),('Blueberries','60 g','34 kcal')],'11px 0')}</div>
    <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--divider-warm);display:flex;justify-content:space-between;">
      <p style="margin:0;font-size:14px;color:var(--body);">Total</p><p style="margin:0;font-size:14px;font-weight:600;color:var(--strong);">434 kcal &middot; 28P / 62C / 8F</p></div>
  </div>
  <div style="display:flex;gap:8px;"><div class="btn btn-primary">Next: Build</div><div class="btn btn-secondary">Cancel</div></div>
</div></div>"""

S['AiLogger'] = f"""<div class="ab">{nav('Today')}<div class="body">
  <h1 class="page-title">AI Estimate</h1>
  <p class="page-subtitle" style="margin-bottom:0;">Describe a meal in your own words. Corrections refine the estimate.</p>
  <div class="card" style="padding:0;">
    <div style="padding:16px;display:flex;flex-direction:column;gap:10px;">
      <div style="align-self:flex-end;max-width:74%;padding:10px 13px;border-radius:12px;background:var(--secondary-bg);color:var(--body);font-size:14px;">Two eggs, sourdough toast and half an avocado</div>
      <div style="align-self:flex-start;max-width:86%;padding:11px 13px;border-radius:12px;border:1px solid var(--border);background:var(--bg);font-size:14px;">
        <p style="margin:0 0 6px;">That comes to roughly:</p>
        <p style="margin:0;font-weight:600;color:var(--strong);">438 kcal &middot; 21P / 30C / 26F</p>
        <p class="prev" style="margin-top:6px;"><span class="ring">Medium confidence &mdash; avocado size assumed</span></p>
      </div>
      <div style="align-self:flex-end;max-width:74%;padding:10px 13px;border-radius:12px;background:var(--secondary-bg);color:var(--body);font-size:14px;">It was a large avocado</div>
    </div>
    <div style="padding:14px 16px;border-top:1px solid var(--divider-warm);">
      <div style="min-height:64px;padding:10px 12px;border-radius:8px;border:1px solid var(--input-border);background:var(--surface);color:var(--muted);font-size:14px;">Add a correction&hellip;</div>
      <div style="display:flex;gap:8px;margin-top:10px;"><div class="btn btn-ai" style="flex-grow:1;">Submit</div><div class="btn btn-primary" style="flex-grow:1;">Log it</div></div>
    </div>
  </div>
</div></div>"""

S['Review'] = f"""<div class="ab">{nav('Review')}<div class="body">
  <h1 class="page-title" style="margin-bottom:4px;">Review</h1>
  <div class="card">
    <p class="section-label"><span class="ring">Calendar and adherence</span> <span class="note">11px &middot; 4.26:1 off-today</span></p>
    <div style="display:flex;gap:6px;margin:12px 0 14px;">
      <div class="btn btn-secondary btn-sm" style="background:var(--primary-subtle);border-color:var(--primary);color:var(--primary-ink);">7d</div>
      <div class="btn btn-secondary btn-sm">30d</div><div class="btn btn-secondary btn-sm">90d</div></div>
    <div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px;">
    {''.join(f'<div style="height:30px;border-radius:5px;background:{c};border:1px solid {b};"></div>' for c,b in [('#d1fae5','#6ee7b7')]*4+[('#fef3c7','#fcd34d'),('#d1fae5','#6ee7b7'),('#fee2e2','#fca5a5')])}</div>
    <p class="prev" style="margin-top:10px;">5 hit &middot; 1 partial &middot; 1 miss</p>
  </div>
  <div class="card"><h3 class="section-title" style="margin-bottom:12px;">Weight trend</h3>
    <svg viewBox="0 0 640 120" style="width:100%;height:120px;display:block;">
      <polyline fill="none" stroke="#1d4ed8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="10,92 100,84 190,88 280,70 370,62 460,66 550,48 630,42"/>
      <polyline fill="none" stroke="#e6e1d7" stroke-width="1" points="10,112 630,112"/></svg>
    <p class="prev" style="margin-top:6px;">82.4 kg &rarr; 80.9 kg over 30 days</p></div>
</div></div>"""

# ── Training ──
def gym(tab, inner):
    return f"""<div class="ab">{nav(tab, gym=True)}<div class="body">
  <div style="display:flex;justify-content:space-between;align-items:center;">
    <h1 class="page-title">Training</h1><div class="btn btn-secondary">Nutrition</div></div>
  {inner}
</div></div>"""

S['GymToday'] = gym('Today', """
  <div style="display:flex;justify-content:space-between;align-items:flex-start;">
    <div><h2 class="section-title">Today</h2><p class="lede" style="margin-top:5px;">Push day &middot; started 18:04 &middot; 24:18 elapsed</p></div>
    <div class="btn btn-primary">Finish</div></div>
  <div class="card" style="padding:0;">
    <div style="padding:14px 16px;border-bottom:1px solid var(--divider-warm);">
      <p style="margin:0;font-size:15px;font-weight:600;color:var(--strong);">Bench press</p>
      <p class="prev" style="margin-top:3px;">Last: 80 kg &times; 6, 6, 5</p></div>
    <div style="padding:10px 16px;">
      <div style="display:flex;align-items:center;gap:10px;font-size:14px;padding:6px 0;"><span style="color:var(--muted);width:16px;">1</span><span style="flex-grow:1;">82.5 kg &times; 6</span><span style="font-size:12px;color:var(--success);font-weight:600;">PR</span></div>
      <div style="display:flex;align-items:center;gap:10px;font-size:14px;padding:6px 0;"><span style="color:var(--muted);width:16px;">2</span><span style="flex-grow:1;">82.5 kg &times; 5</span></div>
      <div style="display:flex;align-items:center;gap:10px;font-size:14px;padding:6px 0;color:var(--muted);"><span style="width:16px;">3</span><span style="flex-grow:1;">&mdash;</span></div></div>
    <div style="padding:12px 16px;border-top:1px solid var(--divider-warm);display:flex;gap:8px;">
      <div class="btn btn-secondary btn-sm">Repeat last</div><div class="btn btn-primary btn-sm">Add set</div></div></div>
  <div class="card"><p style="margin:0;font-size:15px;font-weight:600;color:var(--strong);">Incline dumbbell press</p>
    <p class="prev" style="margin-top:3px;">Last: 30 kg &times; 10, 9, 9</p></div>""")

S['GymSchedule'] = gym('Schedule', """
  <div style="display:flex;justify-content:space-between;align-items:center;">
    <h2 class="section-title">Schedule</h2><div class="btn btn-primary">Save</div></div>
  <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
  """ + ''.join(f"""<div class="card" style="margin:0;padding:14px;">
      <p class="section-label" style="margin-bottom:7px;">{d}</p>
      <div class="field" style="min-height:38px;font-size:14px;color:{'var(--text)' if w!='Rest' else 'var(--muted)'};">{w}</div></div>"""
    for d,w in [('Monday','Push'),('Tuesday','Pull'),('Wednesday','Rest'),('Thursday','Legs'),('Friday','Push'),('Saturday','Rest')]) + """
  </div>""")

S['GymWorkouts'] = gym('Workouts', """
  <div><h2 class="section-title">Workouts</h2><p class="lede" style="margin-top:5px;">Templates with set, rep, and weight targets. Organize by muscle.</p></div>
  <div style="display:grid;grid-template-columns:220px minmax(0,1fr);gap:16px;">
    <div class="card" style="margin:0;"><h3 class="section-title" style="margin-bottom:12px;">My workouts</h3>
      <div style="display:flex;flex-direction:column;gap:6px;">
        <div style="border:1px solid var(--primary);background:var(--primary-subtle);color:var(--primary-ink);border-radius:8px;padding:10px 12px;font-size:14px;">Push</div>
        <div style="border:1px solid var(--surface-border);background:var(--surface);color:var(--body);border-radius:8px;padding:10px 12px;font-size:14px;">Pull</div>
        <div style="border:1px solid var(--surface-border);background:var(--surface);color:var(--body);border-radius:8px;padding:10px 12px;font-size:14px;">Legs</div></div>
      <div style="display:flex;gap:6px;margin-top:12px;"><div class="field" style="min-height:34px;font-size:13px;">New workout</div><div class="btn btn-secondary btn-sm">Add</div></div></div>
    <div class="card" style="margin:0;"><h3 class="section-title" style="margin-bottom:10px;">Exercises</h3>
      <p class="section-label" style="margin-bottom:6px;">Chest</p>
      <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid var(--divider-warm);font-size:14px;"><span>Bench press</span><span class="prev">3 &times; 6 @ 82.5 kg</span></div>
      <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid var(--divider-warm);font-size:14px;"><span>Incline dumbbell press</span><span class="prev">3 &times; 10 @ 30 kg</span></div>
      <p class="section-label" style="margin:14px 0 6px;">Shoulders</p>
      <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid var(--divider-warm);font-size:14px;"><span>Overhead press</span><span class="prev">3 &times; 8 @ 45 kg</span></div></div>
  </div>""")

S['GymProgress'] = gym('Progress', """
  <div><h2 class="section-title">Progress</h2><p class="lede" style="margin-top:5px;">Weight, reps, and volume over time. Filter by window or rep range.</p></div>
  <div class="card"><div class="field">Choose an exercise</div>
    <div style="display:flex;gap:6px;margin-top:12px;">
      <div class="btn btn-secondary btn-sm" style="background:var(--primary-subtle);border-color:var(--primary);color:var(--primary-ink);">8 weeks</div>
      <div class="btn btn-secondary btn-sm">6 months</div><div class="btn btn-secondary btn-sm">All</div></div></div>
  <div class="card"><svg viewBox="0 0 640 130" style="width:100%;height:130px;display:block;">
    <polyline fill="none" stroke="#1d4ed8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="12,104 90,96 168,98 246,82 324,74 402,66 480,60 558,46 626,40"/>
    <polyline fill="none" stroke="#e6e1d7" stroke-width="1" points="12,122 626,122"/></svg>
    <p class="prev" style="margin-top:8px;">Bench press &middot; 72.5 kg &rarr; 82.5 kg over 8 weeks</p></div>
  <div class="card"><h3 class="section-title" style="margin-bottom:10px;">1RM</h3>
    <p style="margin:0;font-size:28px;font-weight:600;color:var(--primary-ink);">96.4 kg</p>
    <p class="prev" style="margin-top:4px;">Epley, from 82.5 kg &times; 6</p></div>""")

# ── Plan & Coach ──
S['Goals'] = f"""<div class="ab">{nav('Goals')}<div class="body">
  {plansub('Goals')}
  <h1 class="page-title" style="margin-bottom:6px;">Weekly nutrition goals</h1>
  <p class="page-subtitle" style="margin-bottom:0;">Set a min and max per day. Blank means no target.</p>
  <div class="card" style="padding:0;overflow:hidden;">
    <div style="display:grid;grid-template-columns:92px repeat(4,minmax(0,1fr));background:var(--secondary-bg);padding:10px 14px;gap:8px;">
    {''.join(f'<p class="section-label" style="margin:0;">{h}</p>' for h in ['Day','Calories','Protein','Carbs','Fat'])}</div>
    {''.join(f'''<div style="display:grid;grid-template-columns:92px repeat(4,minmax(0,1fr));gap:8px;padding:9px 14px;border-top:1px solid var(--divider-warm);align-items:center;">
      <p style="margin:0;font-size:14px;color:var(--body);">{d}</p>
      {''.join(f'<div style="display:flex;gap:4px;"><div class="field" style="min-height:32px;font-size:13px;padding:0 8px;">{a}</div><div class="field" style="min-height:32px;font-size:13px;padding:0 8px;">{b}</div></div>' for a,b in v)}</div>'''
      for d,v in [('Monday',[('2200','2400'),('150','180'),('180','220'),('55','75')]),
                  ('Tuesday',[('2200','2400'),('150','180'),('180','220'),('55','75')]),
                  ('Wednesday',[('2400','2600'),('160','190'),('200','240'),('60','80')]),
                  ('Thursday',[('2200','2400'),('150','180'),('180','220'),('55','75')])])}
  </div>
  <div><div class="btn btn-primary">Save goals</div></div>
</div></div>"""

S['Report'] = f"""<div class="ab">{nav('Goals')}<div class="body">
  {plansub('Report')}
  <h1 class="page-title" style="margin-bottom:6px;">Export report</h1>
  <p class="page-subtitle" style="margin-bottom:0;">A PDF of your intake over a date range.</p>
  <div class="card" style="max-width:540px;"><h3 class="section-title" style="margin-bottom:14px;">Date range</h3>
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
      <div><p class="section-label" style="margin-bottom:5px;">From</p><div class="field" style="color:var(--text);">2026-08-01</div></div>
      <div><p class="section-label" style="margin-bottom:5px;">To</p><div class="field" style="color:var(--text);">2026-08-31</div></div></div>
    <div style="display:flex;gap:6px;margin-top:12px;">
      <div class="btn btn-secondary btn-sm">Last 7 days</div><div class="btn btn-secondary btn-sm">Last 30 days</div><div class="btn btn-secondary btn-sm">This month</div></div>
    <div style="margin-top:16px;"><div class="btn btn-primary">Download PDF</div></div></div>
</div></div>"""

S['Profile'] = f"""<div class="ab">{nav('Goals')}<div class="body">
  {plansub('Profile')}
  <h1 class="page-title">Profile</h1>
  <div class="card"><h3 class="section-title" style="margin-bottom:12px;">Physical stats</h3>
    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;">
    {''.join(f'<div><p class="section-label" style="margin-bottom:5px;">{k}</p><div class="field" style="color:var(--text);">{v}</div></div>' for k,v in [('Height','178 cm'),('Weight','80.9 kg'),('Age','28')])}</div></div>
  <div class="card"><h3 class="section-title" style="margin-bottom:12px;">Units</h3>
    {''.join(f'''<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;{'border-bottom:1px solid var(--divider-warm);' if i==0 else ''}">
      <p style="margin:0;font-size:14px;">{l}</p>
      <div style="display:flex;gap:6px;"><div class="btn btn-secondary btn-sm" style="background:var(--primary-subtle);border-color:var(--primary);color:var(--primary-ink);">Metric</div><div class="btn btn-secondary btn-sm">US</div></div></div>''' for i,l in enumerate(['Macros','Body weight']))}</div>
  <div class="card"><h3 class="section-title" style="margin-bottom:6px;">Dashboard</h3>
    <p class="empty-state" style="padding:14px 0;"><span class="ring">Weight chart is hidden</span> <span class="note">4.26:1 off-today</span></p></div>
</div></div>"""

S['Coach'] = f"""<div class="ab">{nav('Coach')}<div class="body">
  <h1 class="page-title">Coach</h1>
  <div class="card"><h3 class="section-title" style="margin-bottom:10px;">Add client</h3>
    <div style="display:flex;gap:8px;align-items:center;"><div class="field" style="color:var(--text);font-family:ui-monospace,Menlo,monospace;">ABCD1234</div><div class="btn btn-primary">Copy code</div></div>
    <p class="prev" style="margin-top:8px;">Share this invite code. It expires after one use.</p></div>
  <div class="card" style="padding:0;">
    <div style="padding:14px 16px;border-bottom:1px solid var(--divider-warm);"><h3 class="section-title">Clients</h3></div>
    {rows([('Sam Ortega','Last logged 2 hours ago &middot; 5 day streak','Open'),('Priya Raman','Last logged yesterday &middot; 12 day streak','Open'),('Tom Beckett','No logs in 4 days','Open')])}</div>
</div></div>"""

for k,v in S.items(): page(f'{k}.dc.html', 800, 900, v)
print('screens:', len(S))
