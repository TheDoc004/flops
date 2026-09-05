import os, json
OUT = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(OUT,'gen.py')).read()
SHELL = src.split('SHELL = """')[1].split('"""\n\ndef page')[0]
def page(name,w,h,body):
    open(os.path.join(OUT,name),'w').write(SHELL.replace('__W__',str(w)).replace('__H__',str(h)).replace('__BODY__',body))

def sect(t, sub=''):
    return f'''<div style="margin-bottom:10px;"><p style="margin:0;font-size:15px;font-weight:600;color:var(--strong);">{t}</p>
    {f'<p class="prev" style="margin-top:3px;">{sub}</p>' if sub else ''}</div>'''

ICONS = ['M3 10.5 12 3l9 7.5V21H3z','M4 5h16v16H4zM8 3v4M16 3v4M4 10h16','M4 6h16M4 12h10M4 18h13','M4 19V9M10 19V5M16 19v-7M22 19h-20']
def bnav(labels, active):
    tabs=''
    for i,l in enumerate(labels):
        on = l==active
        tabs += f'''<div style="flex-grow:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-height:56px;
          color:{'var(--primary)' if on else 'var(--muted)'};font-size:11px;font-weight:{600 if on else 500};">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="{ICONS[i%4]}"/></svg>
          <span>{l}</span></div>'''
    return f'<div style="display:flex;background:var(--surface);border-top:1px solid var(--surface-border);border-radius:0 0 10px 10px;">{tabs}</div>'

def dnav(labels, active):
    links=''.join(f'<span style="font-size:14px;color:{"var(--primary)" if l==active else "var(--body)"};font-weight:{600 if l==active else 400};">{l}</span>' for l in labels)
    return f'''<div style="display:flex;align-items:center;gap:20px;padding:0 20px;height:56px;background:var(--surface);
      border:1px solid var(--surface-border);border-radius:10px;"><span class="brand">Flops</span>{links}</div>'''

chrome = f"""<div class="ab" style="height:auto;min-height:1000px;">
  <div class="body" style="padding:26px 30px;gap:26px;">
    <div><h1 class="page-title">Navigation chrome</h1>
      <p class="page-subtitle" style="margin:8px 0 0;max-width:74ch;">Every persistent surface, at real size. Labels are lifted from
      <code>Navbar.jsx</code> and <code>BottomNav.jsx</code> &mdash; both use the same five, so desktop and mobile agree.</p></div>

    <div>{sect('Desktop Navbar &mdash; nutrition', 'shared/ui/Navbar.jsx')}{dnav(['Today','Library','Review','Coach','Goals'],'Today')}</div>
    <div>{sect('Desktop Navbar &mdash; gym', 'Swaps to the gym set on /training/*')}{dnav(['Today','Schedule','Workouts','Progress'],'Today')}</div>
    <div>{sect('Bottom nav &mdash; nutrition', 'shared/ui/BottomNav.jsx &middot; mobile only')}<div style="max-width:400px;">{bnav(['Today','Library','Review','Goals'],'Today')}</div></div>
    <div>{sect('Bottom nav &mdash; gym')}<div style="max-width:400px;">{bnav(['Today','Schedule','Workouts','Progress'],'Today')}</div></div>

    <div style="border-top:1px solid var(--divider-strong);padding-top:22px;">
      {sect('The two sub-navs', 'Same job, two different metaphors for the active state. This is finding 01.')}
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin-top:14px;">
        <div>
          <p class="section-label" style="margin-bottom:8px;">LibrarySubNav &mdash; /recipes, /ingredients</p>
          <div class="ring" style="display:inline-block;padding:4px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
              <div class="lib-bar"><span class="lib-tab on">Recipes</span><span class="lib-tab">Ingredients</span></div>
              <span class="lib-build">+ Build a meal</span></div></div>
          <p class="prev" style="margin-top:10px;line-height:1.6;">A white thumb slides on a grey track. Active type is <code>--color-primary</code>. Segmented-control metaphor.</p>
        </div>
        <div>
          <p class="section-label" style="margin-bottom:8px;">plan-tabs &mdash; /plan/*</p>
          <div class="ring" style="display:inline-block;padding:4px;">
            <div class="card" style="padding:12px;"><div class="plan-tabs">
              <span class="plan-tab is-active">Goals</span><span class="plan-tab">Report</span><span class="plan-tab">Profile</span></div></div></div>
          <p class="prev" style="margin-top:10px;line-height:1.6;">The active pill fills with <code>--color-text-strong</code> (near-black) and inverts its type. Toggle-chip metaphor.</p>
        </div>
      </div>
      <p style="margin:18px 0 0;font-size:14px;color:var(--body);line-height:1.6;max-width:80ch;">
        Nothing is broken in either one &mdash; but a person moving from Recipes to Plan meets two different
        answers to &ldquo;which tab am I on?&rdquo; within two clicks. <span class="note">finding 01</span></p>
    </div>
  </div>
</div>"""

# ── Entry surfaces ──
login = """<div class="ab"><div class="body" style="align-items:center;justify-content:center;padding:40px;">
  <div class="card" style="width:100%;max-width:380px;">
    <h1 style="margin:0 0 4px;font-size:28px;font-weight:600;color:var(--strong);text-align:center;"><span class="ring">Flops</span></h1>
    <p class="prev" style="text-align:center;margin-bottom:18px;">bare &lt;h1&gt;, not .page-title</p>
    <p class="section-label" style="margin-bottom:6px;">Email</p>
    <div class="field">you@example.com</div>
    <div class="btn btn-primary" style="width:100%;margin-top:12px;">Send code</div>
    <p class="prev" style="text-align:center;margin-top:14px;">We&rsquo;ll email you a six-digit code.</p>
  </div></div></div>"""

onboarding = """<div class="ab"><div class="body" style="align-items:center;justify-content:center;padding:40px;">
  <div class="card" style="width:100%;max-width:440px;text-align:center;">
    <h1 style="margin:0 0 4px;font-size:28px;font-weight:600;color:var(--strong);"><span class="ring">Welcome to FLOPS</span></h1>
    <p class="prev" style="margin-bottom:20px;">bare &lt;h1&gt; &middot; and the only surface spelling the brand FLOPS</p>
    <p style="margin:0 0 20px;font-size:15px;color:var(--body);line-height:1.6;">A notebook for what you eat and how you train. Nothing here nags you.</p>
    <div style="display:flex;gap:8px;justify-content:center;margin-bottom:18px;">
      """ + ''.join(f'<span style="width:7px;height:7px;border-radius:999px;background:{"var(--primary)" if i==0 else "var(--divider-strong)"};"></span>' for i in range(4)) + """
    </div>
    <div class="btn btn-primary" style="width:100%;">Get started</div>
  </div></div></div>"""

boot = """<div class="ab"><div class="body" style="align-items:center;justify-content:center;">
  <p style="margin:0;font-family:var(--font-serif);font-size:44px;color:var(--primary-ink);"><span class="ring">Flops</span></p>
  <p class="prev" style="margin-top:10px;">Loading</p>
  <p class="prev" style="margin-top:26px;">.boot-wordmark &middot; App.jsx</p>
</div></div>"""

landing = """<div class="ab" style="background:#f7f2e9;">
  <div style="display:flex;align-items:center;justify-content:space-between;padding:0 26px;height:60px;">
    <span class="brand" style="font-size:22px;">Flops</span>
    <div style="display:flex;gap:10px;align-items:center;">
      <span style="font-size:13px;color:var(--muted);">EN / ES</span>
      <span class="btn btn-secondary btn-sm">Sign in</span></div></div>
  <div class="body" style="padding:34px 40px;gap:22px;">
    <h1 style="margin:0;font-family:var(--font-serif);font-size:42px;line-height:1.12;color:var(--primary-ink);letter-spacing:-0.02em;max-width:15ch;">
      A notebook for what you eat and how you train.</h1>
    <p style="margin:0;font-size:16px;color:var(--body);line-height:1.65;max-width:56ch;">
      Built by one person, for one person, then opened up. No streaks to protect, no nagging, no feed. You write it down; it remembers.</p>
    <div style="display:flex;gap:10px;"><div class="btn btn-primary">Start your notebook</div><div class="btn btn-secondary">Read the story</div></div>
    <div style="border-top:1px solid var(--divider-strong);padding-top:20px;margin-top:4px;">
      <p class="section-label" style="margin-bottom:12px;">How it works</p>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;">
      """ + ''.join(f"""<div><p style="margin:0;font-family:ui-monospace,Menlo,monospace;font-size:12px;color:var(--muted);">0{i}</p>
        <p style="margin:6px 0 0;font-size:15px;font-weight:600;color:var(--strong);">{t}</p>
        <p style="margin:5px 0 0;font-size:13px;color:var(--body);line-height:1.6;">{d}</p></div>"""
        for i,(t,d) in enumerate([('Scan a label','Barcode or photo. The macros come back filled in.'),
                                  ('Log the day','A meal, a weight, a set. Whatever you actually did.'),
                                  ('Look back','Charts and adherence, when you want them.')],1)) + """
      </div></div>
    <p class="prev" style="margin-top:8px;">Landing runs its own module (Landing.module.css) with a gradient atmosphere layer &mdash; deliberately outside the app design system.</p>
  </div></div>"""

FIND = [
 ('Two sub-navs, two active-state metaphors',
  'LibrarySubNav slides a white thumb along a grey track with <code>--color-primary</code> type. <code>.plan-tab.is-active</code> fills the pill with <code>--color-text-strong</code> and inverts. Both are pill-shaped; neither resembles the other in behaviour.',
  'Recipes &rarr; Plan is two clicks, and the answer to &ldquo;which tab am I on?&rdquo; changes on the way. This is the clearest chrome inconsistency in the app.',
  'Pick one. The sliding thumb is the more distinctive of the two and already handles a two-item set; plan-tabs would need it to handle three.'),
 ('The nav item for the plan section',
  'It read <code>Goals</code> &rarr; <code>/plan</code>, colliding with the <em>Goals</em> tab inside <code>PlanLayout</code> &mdash; one word meaning both the section and one of its three tabs.',
  'Report and Profile sat under a nav item that never mentioned them.',
  '<strong>Settled: Profile &rarr; /plan/profile</strong>, with <code>matchPaths: [&#39;/plan&#39;]</code> so it stays lit across the section. This canvas originally argued for &ldquo;Plan&rdquo;; that was proposed, briefly shipped in <code>640c769</code>, and reverted in <code>1bd9da2</code>. Profile is the intended label &mdash; the Goals collision is resolved either way.', 'settled'),
 ('Two styling systems',
  'Nutrition styles through global classes in <code>index.css</code>. Training and the shared navs use CSS modules. Both consume the same tokens, so nothing looks broken.',
  'A fork with no signpost: every future shared control has to pick a side, and today the answer is &ldquo;whichever domain builds it first&rdquo;.',
  'A deliberate call, not a cleanup. Worth deciding before the Phase 3 bridge adds UI that belongs to both domains.'),
 ('Auth and onboarding sit outside the design system',
  '<code>Login.jsx</code> and <code>Onboarding.jsx</code> use bare <code>&lt;h1&gt;</code> with their own modules &mdash; no <code>.page-title</code>, no DM Serif. Onboarding is also the only surface spelling the brand <strong>FLOPS</strong>; the boot screen, Login, Landing and Navbar all say <strong>Flops</strong>.',
  'These are the first two screens a new person sees, and they do not look like the product behind them.',
  'Adopt <code>.page-title</code> on both, and settle the wordmark on one casing.'),
 ('--color-text-faint carries the most sub-AA text',
  '4.26:1 off-today, across <code>.section-label</code> (11px), <code>.empty-state</code> (15px) and gym <code>.prev</code> (12px) &mdash; 64 call sites.',
  'The smallest type in the app has the least contrast, and it is worst on notebook days.',
  '<strong>Applied in <code>640c769</code>:</strong> <code>#a1a1aa</code> &rarr; <code>#a8a8b0</code>. 4.63:1 on the card, 5.94:1 on the page.', 'applied'),
 ('--color-success at 12px',
  '<code>#059669</code> on cream is 3.58:1 &mdash; the lowest pair in the palette, in <code>.macro-status.is-ok</code>.',
  'The &ldquo;on target&rdquo; indicator you read every day is the least legible text on the Dashboard.',
  '<strong>Applied in <code>640c769</code>:</strong> <code>#059669</code> &rarr; <code>#047a55</code> &mdash; not the <code>#04815a</code> first proposed here. Success text also renders directly on <code>--color-bg</code> (the paste confirmation in <code>Dashboard.jsx</code>), and cream is a harder background than the card: <code>#04815a</code> reached only 4.20:1 there. <code>#047a55</code> clears both (4.60 / 5.09).', 'applied'),
 ('.btn-ghost has no notebook override',
  'The other three button variants have <code>html[data-notebook-day]</code> rules. <code>.btn-ghost</code> inherits sky-blue at 4.30:1 on charcoal.',
  'A gap in an otherwise complete set.',
  '<strong>Applied in <code>640c769</code>:</strong> a new <code>html[data-notebook-day] .btn-ghost</code> rule at <code>#6dacfa</code> (4.65:1), plus a hover pair. The token itself was left alone.', 'applied'),
]

STATUS = {'settled': ('Settled', '#065f46', '#d1fae5', '#6ee7b7'),
          'applied': ('Applied', '#065f46', '#d1fae5', '#6ee7b7'),
          'open':    ('Open',    '#9a3412', '#ffedd5', '#fdba74')}

def fcard(i,f):
    t,what,why,fix = f[0],f[1],f[2],f[3]
    st = f[4] if len(f)>4 else 'open'
    lbl,fg,bgc,bd = STATUS[st]
    chip = (f'<span style="display:inline-flex;padding:2px 8px;border-radius:999px;font-family:ui-monospace,Menlo,monospace;'
            f'font-size:10px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;'
            f'color:{fg};background:{bgc};border:1px solid {bd};margin-left:10px;vertical-align:middle;">{lbl}</span>')
    return f"""<div style="border-top:1px solid var(--divider-strong);padding:18px 0;display:grid;grid-template-columns:30px minmax(0,1fr);gap:14px;">
      <p style="margin:0;font-family:ui-monospace,Menlo,monospace;font-size:13px;color:var(--muted);">{i:02d}</p>
      <div><p style="margin:0;font-size:17px;font-weight:600;color:var(--strong);">{t}{chip}</p>
      <p style="margin:8px 0 0;font-size:14px;color:var(--body);line-height:1.6;">{what}</p>
      <p style="margin:8px 0 0;font-size:14px;color:var(--body);line-height:1.6;"><em style="color:var(--muted);">Why it matters &mdash;</em> {why}</p>
      <p style="margin:8px 0 0;font-size:14px;color:var(--primary-ink);line-height:1.6;">{fix}</p></div></div>"""

findings = f"""<div class="ab" style="height:auto;min-height:1560px;">
  <div class="body" style="padding:26px 30px;">
    <h1 class="page-title">Review findings</h1>
    <p class="page-subtitle" style="margin:8px 0 0;max-width:78ch;">
      A pass over all 14 routes and all 5 persistent chrome surfaces. Ordered by how much each one
      shapes the product, not by how fast it can be fixed. Four are still open calls; three shipped in <code>640c769</code> and one is settled.</p>
    <div style="margin-top:16px;padding:14px 16px;border-radius:10px;background:#fff7ed;border:1px solid #fdba74;">
      <p style="margin:0;font-size:13px;font-weight:600;color:#9a3412;">Correction to the first version of this canvas</p>
      <p style="margin:6px 0 0;font-size:13px;color:var(--body);line-height:1.6;">
        It claimed Training had no page title. It does &mdash; <code>&lt;h1 class="page-title"&gt;Training&lt;/h1&gt;</code> lives in
        <code>app/layouts/TrainingLayout.jsx</code>, the layout shell. The earlier grep was scoped to
        <code>features/training-workouts/</code> and missed it. The per-page <code>&lt;h2 class="section-title"&gt;</code>
        is a correct sub-heading under that h1. That finding is withdrawn.</p></div>
    <div style="margin-top:6px;">{''.join(fcard(i+1,f) for i,f in enumerate(FIND))}</div>
    <p class="prev" style="margin-top:20px;">Read from index.css, Gym.module.css, Navbar.jsx, BottomNav.jsx, LibrarySubNav.module.css, PlanLayout.jsx and App.jsx on 2026-09-04.</p>
  </div></div>"""

page('Chrome.dc.html', 900, 1000, chrome)
page('Login.dc.html', 800, 900, login)
page('Onboarding.dc.html', 800, 900, onboarding)
page('Boot.dc.html', 800, 900, boot)
page('Landing.dc.html', 800, 900, landing)
page('Findings.dc.html', 900, 1560, findings)

C=[0,880,1760]; R=[0,1020,2040]
A=[]
def put(f,c,r,pg,w=800,h=900,**kw):
    d={'file':f,'x':C[c],'y':R[r],'w':w,'h':h,'page':pg}; d.update(kw); A.append(d)

for f,c,r in [('Main',0,0),('Recipes',1,0),('Ingredients',2,0),('MealBuilder',0,1),('AiLogger',1,1),('Review',2,1)]:
    put(f'{f}.dc.html',c,r,'page-1')
for f,c,r in [('GymToday',0,0),('GymSchedule',1,0),('GymWorkouts',2,0),('GymProgress',0,1)]:
    put(f'{f}.dc.html',c,r,'page-2')
for f,c,r in [('Goals',0,0),('Report',1,0),('Profile',2,0),('Coach',0,1)]:
    put(f'{f}.dc.html',c,r,'page-3')
A.append({'file':'Chrome.dc.html','x':0,'y':0,'w':900,'h':1000,'page':'page-4','print':'flow'})
for f,c in [('Landing',0),('Login',1),('Onboarding',2)]:
    put(f'{f}.dc.html',c,0,'page-5')
put('Boot.dc.html',0,1,'page-5')
A.append({'file':'Findings.dc.html','x':0,'y':0,'w':900,'h':1560,'page':'page-6','print':'flow'})

canvas={'pages':[{'id':'page-1','name':'Nutrition'},{'id':'page-2','name':'Training'},
                 {'id':'page-3','name':'Plan & Coach'},{'id':'page-4','name':'Chrome'},
                 {'id':'page-5','name':'Entry'},{'id':'page-6','name':'Findings'}],
        'artboards':A,
        'annotations':[
          {'id':'coverage','page':'page-1','x':-360,'y':0,'w':300,
           'text':'All 14 routes and all 5 chrome surfaces, rebuilt from source.\n\nNutrition: Dashboard, Recipes, Ingredients, Meal Builder, AI Logger, Review.\n\nDashed rings mark something the Findings page argues about.'},
          {'id':'chrome-note','page':'page-4','x':-360,'y':0,'w':300,
           'text':'The sub-nav comparison at the bottom of this sheet is finding 01 — the thing you asked about.\n\nBoth navs use the same five labels, so desktop and mobile agree. I had drawn them wrong in the first version.'},
          {'id':'entry-note','page':'page-5','x':-360,'y':0,'w':300,
           'text':'The three screens a new person meets before the app proper, plus the boot wordmark.\n\nAll four are outside the design system: bare h1s, their own CSS modules. Finding 04.'},
          {'id':'find-note','page':'page-6','x':-360,'y':0,'w':300,
           'text':'Seven findings. 01-04 are judgment calls about what the app should be. 05-07 are measured contrast defects with exact values.\n\nThe orange box at the top withdraws a finding from the first version that was wrong.'},
        ],
        'launch':{'view':'canvas','page':'page-4'}}
json.dump(canvas, open(os.path.join(OUT,'canvas.json'),'w'), indent=2)
print('chrome + entry + findings written;', len(A), 'artboards')
