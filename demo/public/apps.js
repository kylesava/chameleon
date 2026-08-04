/* Chameleon app registry + stub renderers.
   Every app: grid sizes per s/m/l/xl, a max grow bound, icon, accent, and a
   render(body, app, sizeLabel) function that draws believable fake content. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Apps = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const short = s => { s = String(s ?? ''); return s.length > 26 ? s.slice(0, 24) + '…' : s; };
  const fmt$ = n => '$' + Number(n).toLocaleString();
  const initials = n => n.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

  /* ------------------------------------------------------------------ */
  /* Default fake data                                                   */
  /* ------------------------------------------------------------------ */

  const D = {
    presentation: {
      title: 'Northwind Energy — Q3 Renewal & AI Expansion',
      slides: [
        { title: 'Northwind Energy', bullets: ['Q3 Renewal & AI Expansion Proposal', 'Prepared by your account team'], notes: 'Open with the 12-year partnership. Thank Dana for sponsoring the exec briefing.' },
        { title: 'Where We Are Today', bullets: ['$2.4M ARR across hybrid cloud', '99.98% uptime over 24 months', '3 business units live on watsonx'], notes: 'Anchor on reliability before pricing. CFO cares about uptime SLAs.' },
        { title: 'The Opportunity', bullets: ['Grid-failure prediction with AI ops', 'Est. $8.2M/yr in avoided outages', 'Pilot in 6 weeks, scale in Q4'], notes: 'This is the headline number — pause here.' },
        { title: 'Proposed Investment', bullets: ['Renewal: $2.4M (flat)', 'AI Ops expansion: +$940K', 'Multi-year: 12% committed-spend discount'], notes: 'Only show discount if procurement pushes. Floor is 9%.' },
        { title: 'Next Steps', bullets: ['Exec alignment — Aug 12', 'Technical validation — Aug 26', 'Signature target — Sep 30'], notes: 'Get Dana to co-own the Sep 30 date on the call.' },
      ],
    },
    podcast: {
      title: 'Account Briefing: Northwind Energy',
      subtitle: 'AI-generated · 2 hosts · 12 min',
      duration: 743,
      chapters: [
        { t: '0:00', title: 'The relationship at a glance' },
        { t: '2:40', title: 'Stakeholder rundown — who really decides' },
        { t: '5:10', title: 'The $940K AI Ops expansion math' },
        { t: '8:30', title: 'Risks & the Sep 30 path to signature' },
      ],
    },
    flashcards: {
      topic: 'Northwind Stakeholders',
      cards: [
        { q: 'Who is the economic buyer?', a: 'Dana Whitfield, CFO — owns the infrastructure budget.' },
        { q: 'Biggest competitive threat?', a: 'Hyperion Cloud — incumbent on the data lake, aggressive on price.' },
        { q: 'Renewal date?', a: 'September 30 — procurement needs 3 weeks lead time.' },
        { q: 'Our champion?', a: 'Priya Raman, VP Platform — sponsored the watsonx pilot.' },
      ],
    },
    relationships: {
      account: 'Northwind Energy',
      people: [
        { name: 'Marcus Hale', role: 'CEO', sentiment: 'neutral' },
        { name: 'Dana Whitfield', role: 'CFO', sentiment: 'neutral', reportsTo: 'Marcus Hale' },
        { name: 'Priya Raman', role: 'VP Platform', sentiment: 'champion', reportsTo: 'Marcus Hale' },
        { name: 'Tom Okafor', role: 'CISO', sentiment: 'detractor', reportsTo: 'Marcus Hale' },
        { name: 'Lena Cruz', role: 'Dir. Data', sentiment: 'champion', reportsTo: 'Priya Raman' },
        { name: 'Sam Iqbal', role: 'Procurement', sentiment: 'neutral', reportsTo: 'Dana Whitfield' },
      ],
    },
    territory: {
      name: 'Northeast — Energy & Utilities',
      accounts: [
        { name: 'Northwind Energy', value: 2400, region: 'Tri-State', industry: 'Utilities', stage: 'Close', health: 'good' },
        { name: 'Meridian Utilities', value: 640, region: 'New England', industry: 'Utilities', stage: 'Propose', health: 'good' },
        { name: 'Ironpeak Grid', value: 1200, region: 'Great Lakes', industry: 'Utilities', stage: 'Propose', health: 'warn' },
        { name: 'Coastal Gas', value: 320, region: 'Mid-Atlantic', industry: 'Oil & Gas', stage: 'Qualify', health: 'warn' },
        { name: 'Ravenna Power', value: 180, region: 'Tri-State', industry: 'Utilities', stage: 'Qualify', health: 'good' },
        { name: 'Bluewater Hydro', value: 450, region: 'New England', industry: 'Renewables', stage: 'Prospect', health: 'good' },
        { name: 'Solaris Fields', value: 260, region: 'Mid-Atlantic', industry: 'Renewables', stage: 'Qualify', health: 'risk' },
        { name: 'Keystone Pipe Co', value: 530, region: 'Mid-Atlantic', industry: 'Oil & Gas', stage: 'Propose', health: 'warn' },
        { name: 'Granite Power', value: 210, region: 'New England', industry: 'Utilities', stage: 'Prospect', health: 'good' },
        { name: 'Lakeshore Electric', value: 380, region: 'Great Lakes', industry: 'Utilities', stage: 'Qualify', health: 'good' },
        { name: 'Harborline LNG', value: 290, region: 'Tri-State', industry: 'Oil & Gas', stage: 'Prospect', health: 'risk' },
        { name: 'Vermont Wind', value: 140, region: 'New England', industry: 'Renewables', stage: 'Prospect', health: 'good' },
        { name: 'Metro Transit', value: 760, region: 'Tri-State', industry: 'Public Sector', stage: 'Propose', health: 'warn' },
        { name: 'Erie County Water', value: 120, region: 'Great Lakes', industry: 'Public Sector', stage: 'Qualify', health: 'good' },
        { name: 'Alleghany Power', value: 340, region: 'Mid-Atlantic', industry: 'Utilities', stage: 'Prospect', health: 'warn' },
        { name: 'Beacon Renewables', value: 520, region: 'Tri-State', industry: 'Renewables', stage: 'Qualify', health: 'good' },
      ],
    },
    accountplan: {
      account: 'Northwind Energy',
      objectives: [
        { text: 'Renew $2.4M base before Sep 30', done: false },
        { text: 'Land AI Ops expansion (+$940K)', done: false },
        { text: 'Exec sponsor mapped to our GM', done: true },
        { text: 'Displace Hyperion on data lake', done: false },
      ],
      risks: ['CISO security review pending', 'Hyperion undercutting on storage', 'Budget freeze rumored for Q4'],
      nextSteps: ['Exec briefing Aug 12', 'Security workshop w/ Tom Okafor', 'Draft multi-year pricing', 'Reference call: Meridian Utilities'],
    },
    pipeline: {
      stages: [
        { name: 'Qualify', deals: [{ name: 'Grid AI Pilot', account: 'Ravenna Power', value: 180 }, { name: 'Data Fabric', account: 'Coastal Gas', value: 320 }] },
        { name: 'Validate', deals: [{ name: 'Hybrid Migration', account: 'Meridian Utilities', value: 640 }] },
        { name: 'Propose', deals: [{ name: 'AI Ops Expansion', account: 'Northwind Energy', value: 940 }, { name: 'Mainframe Refresh', account: 'Ironpeak Grid', value: 1200 }] },
        { name: 'Negotiate', deals: [{ name: 'Q3 Renewal', account: 'Northwind Energy', value: 2400 }] },
      ],
    },
    pricing: {
      account: 'Northwind Energy',
      discount: 12,
      lines: [
        { sku: 'WX-AI-ENT', desc: 'watsonx.ai Enterprise', qty: 1, unit: 420000 },
        { sku: 'HC-CORE-24', desc: 'Hybrid Cloud Core (24 mo)', qty: 2, unit: 660000 },
        { sku: 'AIOPS-PRD', desc: 'AI Ops — Grid Prediction', qty: 1, unit: 540000 },
        { sku: 'SUP-PREM', desc: 'Premium Support', qty: 1, unit: 180000 },
      ],
    },
    metrics: {
      kpis: [
        { label: 'Pipeline', value: '$5.7M', delta: '+18%', spark: [3, 4, 3.6, 4.4, 5, 4.8, 5.7] },
        { label: 'Quota Att.', value: '84%', delta: '+6 pts', spark: [61, 66, 70, 74, 79, 81, 84] },
        { label: 'Win Rate', value: '31%', delta: '+4%', spark: [22, 25, 24, 27, 29, 28, 31] },
        { label: 'Avg. Cycle', value: '94 d', delta: '-11 d', spark: [120, 116, 110, 108, 101, 98, 94] },
      ],
    },
    profile: {
      name: 'Dana Whitfield', role: 'CFO', account: 'Northwind Energy',
      sentiment: 'neutral', influence: 86, lastTouch: 'Jul 18 · pricing call',
      bio: 'Owns the $40M infrastructure budget. Data-driven, allergic to vendor fluff — wants uptime math and multi-year cost curves before anything else.',
      talkingPoints: ['Lead with 99.98% uptime over 24 months', 'Frame AI Ops as $8.2M avoided outages', 'Offer multi-year lock before discount talk'],
      watchouts: ['Rumored Q4 budget freeze', 'Hyperion pitched her CFO-to-CFO in June'],
      connections: [{ name: 'Marcus Hale', note: 'reports to' }, { name: 'Sam Iqbal', note: 'her procurement lead' }],
    },
    notes: {
      title: 'Working Notes',
      items: ['Dana prefers Tuesday mornings', 'Legal redlines due back Friday', 'Mention Meridian reference win', 'Tom O. wants SOC2 + FedRAMP docs'],
    },
  };

  /* ------------------------------------------------------------------ */
  /* Icons (inline SVG, 16px, stroke-based)                              */
  /* ------------------------------------------------------------------ */

  const I = {
    presentation: '<rect x="2" y="3" width="12" height="8" rx="1.5"/><path d="M5.5 8l2-2 1.8 1.5L11 5"/><path d="M8 11v2.5M5.5 14.5h5"/>',
    podcast: '<rect x="6" y="2" width="4" height="7" rx="2"/><path d="M3.5 8a4.5 4.5 0 0 0 9 0M8 12.5V14"/>',
    flashcards: '<rect x="4.5" y="2.5" width="9" height="7" rx="1.5"/><rect x="2.5" y="6" width="9" height="7" rx="1.5"/>',
    relationships: '<circle cx="8" cy="3.5" r="1.8"/><circle cx="3.5" cy="12" r="1.8"/><circle cx="12.5" cy="12" r="1.8"/><path d="M7 5l-2.4 5M9 5l2.4 5M5.3 12h5.4"/>',
    territory: '<path d="M2.5 4.5l3.7-1.5 3.6 1.5 3.7-1.5v9l-3.7 1.5-3.6-1.5-3.7 1.5z"/><path d="M6.2 3v9M9.8 4.5v9"/>',
    accountplan: '<rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3"/>',
    pipeline: '<path d="M2.5 3h11L10 8v4.5l-4 1.5V8z"/>',
    pricing: '<path d="M8.6 2.5H13.5V7.4L7.9 13a1.4 1.4 0 0 1-2 0L3 10.1a1.4 1.4 0 0 1 0-2z"/><circle cx="11" cy="5" r="0.8"/>',
    metrics: '<path d="M3 13V8M6.4 13V4M9.8 13V9.5M13.2 13V6"/>',
    notes: '<path d="M3 3.5h10M3 7h10M3 10.5h6"/><path d="M11.5 13.5l3-3" transform="translate(-1,-1)"/>',
    profile: '<circle cx="8" cy="5" r="2.6"/><path d="M3 13.5c.8-3 2.7-4.5 5-4.5s4.2 1.5 5 4.5"/>',
    oppmap: '<circle cx="3" cy="8" r="1.5"/><circle cx="8" cy="4.5" r="1.5"/><circle cx="8" cy="11.5" r="1.5"/><circle cx="13" cy="8" r="1.5"/><path d="M4.4 7.3l2.3-2M4.4 8.7l2.3 2M9.4 5.2l2.4 2M9.4 10.8l2.4-2"/>',
    battlecard: '<path d="M8 1.8l5.5 2v4.4c0 3.4-2.2 5.6-5.5 6.9-3.3-1.3-5.5-3.5-5.5-6.9V3.8z"/><path d="M5.6 8l1.7 1.7L10.6 6"/>',
    callprep: '<rect x="2.5" y="3.5" width="11" height="10" rx="1.6"/><path d="M5.5 2v3M10.5 2v3M2.5 7h11"/><path d="M6.2 10.2l1.3 1.3 2.3-2.3"/>',
    convo: '<path d="M2.5 5A2.5 2.5 0 0 1 5 2.5h6A2.5 2.5 0 0 1 13.5 5v3.6a2.5 2.5 0 0 1-2.5 2.5H8.4L5.2 13.7v-2.6H5a2.5 2.5 0 0 1-2.5-2.5z"/><path d="M5.4 5.8h5.2M5.4 8h3.4"/>',
    oppcard: '<circle cx="8" cy="8" r="5.6"/><circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2"/>',
    callreview: '<path d="M13.2 8.6A5.5 5.5 0 1 1 11 3.9"/><path d="M13.5 2.5v3h-3"/><path d="M5.6 8.4l1.7 1.7 3.1-3.1"/>',
    pointer: '<path d="M4.5 2.5l8 6.5-4 .9 2 4.6-2 .9-2-4.6-2.8 3z"/>',
  };

  function icon(id) {
    return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${I[id] || I.notes}</svg>`;
  }

  /* ------------------------------------------------------------------ */
  /* Registry                                                            */
  /* ------------------------------------------------------------------ */

  const REGISTRY = {
    presentation: { name: 'Presentation', hue: 212, sizes: { s: [3, 2], m: [4, 3], l: [6, 4], xl: [6, 6] }, max: [8, 6], desc: 'Slide deck viewer with speaker notes' },
    podcast:      { name: 'Podcast',      hue: 268, sizes: { s: [2, 1], m: [3, 2], l: [4, 2], xl: [4, 3] }, max: [4, 3], desc: 'AI account-briefing audio player' },
    flashcards:   { name: 'Flashcards',   hue: 38,  sizes: { s: [2, 2], m: [3, 2], l: [4, 3], xl: [5, 4] }, max: [5, 4], desc: 'Prep flashcards' },
    relationships:{ name: 'Relationship Map', hue: 172, sizes: { s: [2, 2], m: [4, 3], l: [6, 4], xl: [6, 6] }, max: [8, 6], desc: 'Stakeholder influence graph' },
    territory:    { name: 'Territory',    hue: 142, sizes: { s: [2, 2], m: [4, 3], l: [6, 4], xl: [8, 5] }, max: [8, 6], desc: 'Territory heat + quota attainment' },
    accountplan:  { name: 'Account Plan', hue: 190, sizes: { s: [2, 2], m: [4, 3], l: [6, 4], xl: [8, 5] }, max: [8, 6], desc: 'Health, engagement, objectives, risks' },
    pipeline:     { name: 'Opportunities', hue: 232, sizes: { s: [3, 2], m: [4, 2], l: [6, 3], xl: [8, 4] }, max: [8, 4], desc: 'Deal pipeline board' },
    pricing:      { name: 'Pricing',      hue: 330, sizes: { s: [2, 2], m: [4, 3], l: [5, 4], xl: [6, 5] }, max: [6, 5], desc: 'Quote builder with discounting' },
    metrics:      { name: 'Metrics',      hue: 200, sizes: { s: [2, 1], m: [4, 1], l: [4, 2], xl: [8, 2] }, max: [8, 2], desc: 'KPI strip' },
    notes:        { name: 'Notes',        hue: 20,  sizes: { s: [2, 2], m: [2, 3], l: [3, 4], xl: [4, 4] }, max: [4, 6], desc: 'Working notes' },
    profile:      { name: 'Profile',      hue: 288, sizes: { s: [2, 2], m: [3, 3], l: [4, 4], xl: [5, 5] }, max: [5, 5], desc: 'Stakeholder deep-dive' },
    oppmap:       { name: 'Strategy Map', hue: 95,  sizes: { s: [3, 2], m: [4, 3], l: [6, 4], xl: [8, 5] }, max: [8, 6], desc: 'Customer goals → initiatives → our deals' },
    battlecard:   { name: 'Battlecard',   hue: 356, sizes: { s: [2, 2], m: [3, 3], l: [4, 4], xl: [6, 5] }, max: [6, 5], desc: 'Competitive battlecard vs Hyperion' },
    callprep:     { name: 'Call Prep',    hue: 26,  sizes: { s: [2, 2], m: [3, 3], l: [4, 4], xl: [6, 5] }, max: [6, 5], desc: 'Next meeting: goal, agenda, intel' },
    convo:        { name: 'Conversation', hue: 220, sizes: { s: [2, 3], m: [3, 4], l: [4, 5], xl: [5, 6] }, max: [5, 6], desc: 'The chat transcript as a tile' },
    oppcard:      { name: 'Opportunity',  hue: 252, sizes: { s: [2, 2], m: [3, 3], l: [4, 3], xl: [4, 4] }, max: [4, 4], desc: 'Deal snapshot: stage, value, next step' },
    callreview:   { name: 'Call Review',  hue: 4,   sizes: { s: [2, 2], m: [3, 3], l: [4, 4], xl: [5, 4] }, max: [5, 5], desc: 'Last call: score, wins, commitments' },
  };

  function emit(detail) {
    document.dispatchEvent(new CustomEvent('chameleon:event', { detail }));
  }

  /* ---- CRM wiring (configured by app.js at boot) ---- */
  let CRMD = null;
  let LOGEL = null;
  let getCtx = () => ({ account: null, opp: null });
  let selectCtx = () => {};
  function configure(o) {
    if (o.crm) CRMD = o.crm;
    if (o.logEl) LOGEL = o.logEl;
    if (o.getContext) getCtx = o.getContext;
    if (o.selectContext) selectCtx = o.selectContext;
  }
  const acctById = id => CRMD && CRMD.accounts.find(a => a.id === id);
  const oppById = id => {
    if (!CRMD) return null;
    for (const a of CRMD.accounts) { const o = a.opps.find(x => x.id === id); if (o) return { acct: a, opp: o }; }
    return null;
  };
  const ctxAcct = () => { const c = getCtx(); return c.account ? acctById(c.account) : null; };
  const ctxOpp = () => { const c = getCtx(); return c.opp ? oppById(c.opp) : null; };
  const hdot = h => `<i class="hdot ${h || 'good'}"></i>`;
  const fmtM = k => k >= 1000 ? `$${(k / 1000).toFixed(1)}M` : `$${k}K`;

  function accountPicker(el, toolLabel, appIcon, toolId) {
    if (!CRMD) return false;
    el.innerHTML = `<div class="pick">
      <div class="pick-cap">Pick an account for the ${esc(toolLabel)}</div>
      ${CRMD.accounts.map(a => `
        <button class="pick-row" data-a="${a.id}">${hdot(a.health)}<b>${esc(a.name)}</b>
          <span>${esc(a.industry)} · ${a.arr ? fmtM(a.arr) + ' ARR' : 'new logo'} · ${a.opps.length} opp${a.opps.length > 1 ? 's' : ''}</span><em>›</em></button>`).join('')}
    </div>`;
    el.querySelectorAll('.pick-row').forEach(b => b.onclick = () => {
      const a = acctById(b.dataset.a);
      selectCtx(a.id, null, {
        emitDesc: `selected the account ${a.name} in the ${toolLabel} — it just auto-filled from CRM. Give a one-line read on ${a.name} and arrange anything else that helps.`,
        emitLabel: `Account · ${a.name}`, emitIcon: appIcon,
        emitRoute: { key: `pick:${toolId || appIcon}:${a.id}` },
      });
    });
    return true;
  }

  function oppPicker(el, opts) {
    if (!CRMD) return false;
    opts = opts || {};
    const ca = ctxAcct();
    const src = ca ? [ca] : CRMD.accounts; // context account scopes the list
    const rows = src.flatMap(a => a.opps.map(o => ({ a, o })));
    el.innerHTML = `<div class="pick">
      <div class="pick-cap">${esc(opts.caption || (ca ? `Pick a ${ca.name} opportunity` : 'Pick an opportunity to quote'))}</div>
      ${rows.map(({ a, o }) => `
        <button class="pick-row" data-o="${o.id}">${hdot(o.health)}<b>${esc(o.name)}</b>
          <span>${esc(a.name)} · ${esc(o.stage)} · ${fmtM(o.value)}</span><em>›</em></button>`).join('')}
    </div>`;
    el.querySelectorAll('.pick-row').forEach(b => b.onclick = () => {
      const { acct, opp } = oppById(b.dataset.o);
      selectCtx(acct.id, opp.id, opts.route === 'oppswitch' ? {
        emitDesc: `selected the "${opp.name}" opportunity on ${acct.name} (${opp.stage}, $${opp.value}K). Its card just loaded — arrange what moves it.`,
        emitLabel: `Opp · ${short(opp.name)}`, emitIcon: 'oppcard',
        emitRoute: { key: `oppswitch:${opp.id}` },
      } : {
        emitDesc: `selected the "${opp.name}" opportunity on ${acct.name} in the pricing tool — the CRM quote loaded ($${opp.value}K, stage ${opp.stage}). React briefly and arrange anything that helps close it.`,
        emitLabel: `Quote · ${short(opp.name)}`, emitIcon: 'pricing',
        emitRoute: { key: `pickopp:${opp.id}` },
      });
    });
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Renderers                                                           */
  /* ------------------------------------------------------------------ */

  const R = {};

  R.presentation = (el, app) => {
    const d = { ...D.presentation, ...app.data };
    const slides = (d.slides && d.slides.length ? d.slides : D.presentation.slides);
    app.ui = app.ui || { idx: 0 };
    if (app.ui.idx >= slides.length) app.ui.idx = 0;

    const draw = () => {
      const i = app.ui.idx, s = slides[i];
      const wide = el.clientWidth > 620, tall = el.clientHeight > 430;
      el.innerHTML = `
        <div class="pres ${wide ? 'wide' : ''} ${tall ? 'tall' : ''}">
          ${wide ? `<div class="pres-rail">${slides.map((sl, j) =>
            `<div class="thumb ${j === i ? 'on' : ''}" data-j="${j}"><span>${j + 1}</span>${esc(sl.title)}</div>`).join('')}</div>` : ''}
          <div class="pres-main">
            <div class="slide">
              <div class="slide-kicker">${esc(d.title)}</div>
              <div class="slide-title">${esc(s.title)}</div>
              <ul>${(s.bullets || []).map((b, j) => `<li class="zap" data-b="${j}" title="Click to expand this point">${esc(b)}</li>`).join('')}</ul>
              <div class="slide-num">${i + 1} / ${slides.length}</div>
              <div class="slide-wm">${String(i + 1).padStart(2, '0')}</div>
            </div>
            ${tall ? `<div class="pres-notes"><b>Speaker notes</b>${esc(s.notes || '—')}</div>` : ''}
            <div class="pres-ctl">
              <button class="pbtn" data-nav="-1">‹</button>
              <div class="dots">${slides.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</div>
              <button class="pbtn" data-nav="1">›</button>
            </div>
          </div>
        </div>`;
      el.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => {
        app.ui.idx = (app.ui.idx + Number(b.dataset.nav) + slides.length) % slides.length; draw();
      });
      el.querySelectorAll('.thumb').forEach(t => t.onclick = () => { app.ui.idx = Number(t.dataset.j); draw(); });
      el.querySelectorAll('.slide li').forEach(li => li.onclick = () => {
        const b = (s.bullets || [])[Number(li.dataset.b)];
        if (!b) return;
        emit({
          desc: `clicked the bullet "${b}" on slide ${i + 1} ("${s.title}") of the deck "${d.title}". Elaborate: UPDATE the presentation — re-open it with the same slides PLUS one new supporting slide inserted right after slide ${i + 1} going deep on this point — and/or open the single tool that proves it (pricing, metrics, relationships…).`,
          label: `Bullet · ${short(b)}`, icon: 'presentation',
        });
      });
    };
    draw();
  };

  R.podcast = (el, app) => {
    const d = { ...D.podcast, ...app.data };
    const chapters = Array.isArray(d.chapters) && d.chapters.length ? d.chapters : D.podcast.chapters;
    app.ui = app.ui || { playing: false, t: 137 };
    const bars = Array.from({ length: 36 }, (_, i) =>
      `<i style="--h:${18 + Math.round(60 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.4)))}%;--d:${(i * 47) % 900}ms"></i>`).join('');
    const mm = t => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    const showCh = el.clientHeight > 185 && chapters.length;
    el.innerHTML = `
      <div class="podw">
        <div class="pod">
          <div class="pod-art">${icon('podcast')}</div>
          <div class="pod-info">
            <div class="pod-title">${esc(d.title)}</div>
            <div class="pod-sub">${esc(d.subtitle || 'AI-generated briefing')}</div>
            <div class="pod-wave ${app.ui.playing ? 'live' : ''}">${bars}</div>
            <div class="pod-row">
              <button class="pod-play">${app.ui.playing ? '❚❚' : '▶'}</button>
              <div class="pod-track"><i style="width:${Math.round(100 * app.ui.t / d.duration)}%"></i></div>
              <span class="pod-time">${mm(app.ui.t)} / ${mm(d.duration)}</span>
            </div>
          </div>
        </div>
        ${showCh ? `<div class="pod-ch">${chapters.map((c, i) => `
          <button class="pod-cr zap" data-i="${i}"><em>${esc(c.t)}</em><span>${esc(c.title)}</span><i>›</i></button>`).join('')}</div>` : ''}
      </div>`;
    el.querySelector('.pod-play').onclick = () => { app.ui.playing = !app.ui.playing; R.podcast(el, app); };
    el.querySelectorAll('.pod-cr').forEach(b => b.onclick = () => {
      const c = chapters[Number(b.dataset.i)];
      const parts = String(c.t).split(':').map(Number);
      app.ui.t = (parts[0] || 0) * 60 + (parts[1] || 0);
      app.ui.playing = true;
      R.podcast(el, app);
      emit({
        desc: `clicked the podcast chapter "${c.title}" (${c.t}) in the briefing "${d.title}" — playback jumped there. Bring this chapter to life — open/arrange the tools that visualize exactly what it covers.`,
        label: `Chapter · ${short(c.title)}`, icon: 'podcast',
      });
    });
  };

  R.flashcards = (el, app) => {
    /* CRM-aware: no agent data ⇒ build rapid-fire cards for the context account */
    let auto = null;
    const ca = ctxAcct();
    if (!(app.data.cards && app.data.cards.length) && ca) {
      const champ = ca.stakeholders.find(s => s.sentiment === 'champion');
      const foe = ca.stakeholders.find(s => s.sentiment === 'detractor');
      const buyer = ca.stakeholders.find(s => (s.tag || '').includes('economic')) || [...ca.stakeholders].sort((x, y) => y.influence - x.influence)[0];
      const top = ca.opps[0];
      const cards = [];
      if (buyer) cards.push({ q: 'Who is the economic buyer?', a: `${buyer.name}, ${buyer.role} — ${buyer.tag}.` });
      if (champ) cards.push({ q: 'Who is our champion?', a: `${champ.name} (${champ.role}) — ${champ.tag}.` });
      if (foe) cards.push({ q: 'Who could kill the deal?', a: `${foe.name} — ${(foe.watchouts && foe.watchouts[0]) || foe.tag}.` });
      if (top) cards.push({ q: `When does ${top.name} close?`, a: `${top.close} — currently ${top.stage}, $${top.value}K.` });
      if (ca.plan.risks[0]) cards.push({ q: 'Top risk right now?', a: ca.plan.risks[0] + '.' });
      if (ca.meetings && ca.meetings[0]) cards.push({ q: 'Next scheduled touch?', a: `${ca.meetings[0].title} — ${ca.meetings[0].when}.` });
      auto = { topic: `${ca.name} rapid-fire`, cards };
    }
    const d = { ...(auto || D.flashcards), ...app.data };
    const cards = d.cards && d.cards.length ? d.cards : D.flashcards.cards;
    app.ui = app.ui || { idx: 0, flip: false };
    if (app.ui.idx >= cards.length) app.ui.idx = 0;
    const c = cards[app.ui.idx];
    el.innerHTML = `
      <div class="fc">
        <div class="fc-topic">${esc(d.topic)} · ${app.ui.idx + 1}/${cards.length}</div>
        <div class="fc-stage"><div class="fc-card ${app.ui.flip ? 'flip' : ''}">
          <div class="fc-face fc-front"><span>Q</span>${esc(c.q)}</div>
          <div class="fc-face fc-back"><span>A</span>${esc(c.a)}</div>
        </div></div>
        <div class="fc-row"><button class="chipbtn" data-a="flip">Flip</button><button class="chipbtn" data-a="next">Next ›</button><button class="chipbtn deep" data-a="deep">Go deeper ✦</button></div>
      </div>`;
    el.querySelector('[data-a=flip]').onclick = () => { app.ui.flip = !app.ui.flip; el.querySelector('.fc-card').classList.toggle('flip'); };
    el.querySelector('[data-a=next]').onclick = () => { app.ui.idx = (app.ui.idx + 1) % cards.length; app.ui.flip = false; R.flashcards(el, app); };
    el.querySelector('[data-a=deep]').onclick = () => emit({
      desc: `wants to go deeper on the flashcard Q: "${c.q}" / A: "${c.a}" (topic: ${d.topic}). Open the tool(s) that turn this fact into an edge — profile, account plan, pricing, whatever fits.`,
      label: `Deeper · ${short(c.q)}`, icon: 'flashcards',
    });
    el.querySelector('.fc-card').onclick = () => el.querySelector('[data-a=flip]').onclick();
  };

  R.relationships = (el, app) => {
    let acctName, people;
    if (app.data.people && app.data.people.length) {
      acctName = app.data.account || (ctxAcct() || {}).name || '';
      people = app.data.people;
    } else {
      const acct = ctxAcct();
      if (!acct) {
        if (accountPicker(el, 'relationship map', 'relationships')) return;
        acctName = D.relationships.account;
        people = D.relationships.people;
      } else {
        acctName = acct.name;
        people = acct.stakeholders;
      }
    }
    const d = { account: acctName, people };
    const W = Math.max(el.clientWidth, 220), H = Math.max(el.clientHeight - 8, 180);
    const small = W < 340;
    // levels via reportsTo
    const byName = Object.fromEntries(people.map(p => [p.name, p]));
    const lvl = p => { let n = 0, cur = p; const seen = new Set(); while (cur && cur.reportsTo && byName[cur.reportsTo] && !seen.has(cur.name)) { seen.add(cur.name); cur = byName[cur.reportsTo]; n++; } return n; };
    const levels = {};
    people.forEach(p => { const L = lvl(p); (levels[L] = levels[L] || []).push(p); });
    const nLv = Object.keys(levels).length;
    const pos = {};
    const span = H - 92;
    const lvGap = nLv > 1 ? Math.min(span / (nLv - 1), 130) : 0;
    const yTop = 34 + Math.max(0, (span - lvGap * (nLv - 1)) / 2);
    Object.keys(levels).sort((a, b) => a - b).forEach(L => {
      const row = levels[L];
      row.forEach((p, i) => {
        pos[p.name] = {
          x: W * (i + 1) / (row.length + 1),
          y: nLv === 1 ? H / 2 : yTop + lvGap * L,
        };
      });
    });
    const col = s => s === 'champion' ? 'var(--good)' : s === 'detractor' ? 'var(--bad)' : 'var(--mid)';
    const edges = people.filter(p => p.reportsTo && pos[p.reportsTo]).map(p =>
      `<path d="M${pos[p.reportsTo].x},${pos[p.reportsTo].y + 16} C ${pos[p.reportsTo].x},${(pos[p.reportsTo].y + pos[p.name].y) / 2} ${pos[p.name].x},${(pos[p.reportsTo].y + pos[p.name].y) / 2} ${pos[p.name].x},${pos[p.name].y - 16}" class="rel-edge"/>`).join('');
    const nodes = people.map((p, i) => `
      <g transform="translate(${pos[p.name].x},${pos[p.name].y})" class="rel-node" style="animation-delay:${i * 60}ms">
        <circle r="20" class="halo" stroke="${col(p.sentiment)}"/>
        <circle r="16" class="core" fill="${col(p.sentiment)}"/>
        <text y="4.5" class="rel-init">${initials(p.name)}</text>
        ${!small ? `<text y="34" class="rel-name">${esc(p.name)}</text><text y="46" class="rel-role">${esc(p.role)}</text>` : ''}
      </g>`).join('');
    el.innerHTML = `
      <div class="rel">
        <svg width="100%" height="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
          <defs><linearGradient id="relgrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(255,255,255,.4)"/><stop offset="1" stop-color="rgba(120,160,255,.25)"/></linearGradient></defs>
          ${edges}${nodes}</svg>
        ${!small ? `<div class="rel-legend"><span><i style="background:var(--good)"></i>Champion</span><span><i style="background:var(--mid)"></i>Neutral</span><span><i style="background:var(--bad)"></i>Detractor</span></div>` : ''}
        ${!small ? `<div class="rel-hint">Click a person for their profile</div>` : ''}
        ${acctName ? `<div class="rel-acct">${esc(acctName)}</div>` : ''}
      </div>`;
    const relBox = el.querySelector('.rel');
    if ((app.ui || {}).sel) relBox.classList.add('hassel');
    el.querySelectorAll('.rel-node').forEach((g, i) => {
      const p = people[i];
      if (!p) return;
      if ((app.ui || {}).sel === p.name) g.classList.add('sel');
      g.addEventListener('click', ev => {
        ev.stopPropagation();
        app.ui = { ...(app.ui || {}), sel: p.name };
        el.querySelectorAll('.rel-node').forEach(n => n.classList.remove('sel'));
        g.classList.add('sel');
        relBox.classList.add('hassel');
        emit({ kind: 'person', person: p, account: d.account || acctName });
      });
    });
  };

  /* Territory — "petri dish": category membranes with account bubbles, circle-packed. */
  const CAT_HUES = [160, 210, 268, 330, 36, 190, 130, 300];
  const HEALTH_RING = { good: 'rgba(53,224,161,.85)', warn: 'rgba(255,198,92,.85)', risk: 'rgba(255,93,143,.9)' };
  const HEALTH_HUE = { good: 160, warn: 38, risk: 336 };

  function packCircles(radii, R, pad) {
    // greedy pack inside circle of radius R centered at 0,0; returns [{x,y,r}] or null
    const placed = [];
    for (let i = 0; i < radii.length; i++) {
      const r = radii[i];
      if (r > R) return null;
      if (i === 0) { placed.push({ x: 0, y: 0, r }); continue; }
      let best = null;
      for (const p of placed) {
        for (let a = 0; a < 64; a++) {
          const ang = (a / 64) * Math.PI * 2;
          const x = p.x + Math.cos(ang) * (p.r + r + pad);
          const y = p.y + Math.sin(ang) * (p.r + r + pad);
          if (Math.hypot(x, y) + r > R) continue;
          let ok = true;
          for (const q of placed) {
            if (Math.hypot(x - q.x, y - q.y) < q.r + r + pad - 0.5) { ok = false; break; }
          }
          if (!ok) continue;
          const d = Math.hypot(x, y);
          if (!best || d < best.d) best = { x, y, r, d };
        }
      }
      if (!best) return null;
      placed.push({ x: best.x, y: best.y, r });
    }
    return placed;
  }

  function packFit(weights, R, pad, fill) {
    const order = weights.map((w, i) => i).sort((a, b) => weights[b] - weights[a]);
    const raw = order.map(i => Math.sqrt(Math.max(weights[i], 1)));
    const area = raw.reduce((a, r) => a + r * r, 0);
    let scale = R * Math.sqrt(fill / area);
    let res = null;
    for (let t = 0; t < 16 && !res; t++) {
      res = packCircles(raw.map(r => r * scale), R, pad);
      if (!res) scale *= 0.93;
    }
    if (!res) res = raw.map(r => ({ x: 0, y: 0, r: r * scale }));
    // re-center the cluster's bounding box inside the container
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    res.forEach(p => { x0 = Math.min(x0, p.x - p.r); x1 = Math.max(x1, p.x + p.r); y0 = Math.min(y0, p.y - p.r); y1 = Math.max(y1, p.y + p.r); });
    const dx = -(x0 + x1) / 2, dy = -(y0 + y1) / 2;
    let shifted = res;
    for (const f of [1, 0.6, 0.3, 0]) {
      const cand = res.map(p => ({ x: p.x + dx * f, y: p.y + dy * f, r: p.r }));
      if (cand.every(p => Math.hypot(p.x, p.y) + p.r <= R + 0.5)) { shifted = cand; break; }
    }
    // undo the size-sort so results align with input order
    const out = [];
    order.forEach((origIdx, k) => { out[origIdx] = shifted[k]; });
    return out;
  }

  R.territory = (el, app) => {
    /* Resolve bubbles = opportunities (CRM-backed; agent/legacy data as fallback). */
    let items;
    if (Array.isArray(app.data.accounts) && app.data.accounts.length) {
      items = app.data.accounts.map((a, i) => ({ key: 'lg' + i, acctId: null, oppId: null, name: a.name, account: a.name, value: a.value || 100, region: a.region || '—', industry: a.industry || '—', stage: a.stage || 'Qualify', health: a.health || 'good', close: '', next: '' }));
    } else if (CRMD) {
      items = CRMD.accounts.flatMap(a => a.opps.map(o => ({ key: o.id, acctId: a.id, oppId: o.id, name: o.name, account: a.name, value: o.value, region: a.region, industry: a.industry, stage: o.stage, health: o.health, close: o.close, next: o.next })));
    } else {
      items = D.territory.accounts.map((a, i) => ({ key: 'df' + i, acctId: null, oppId: null, name: a.name, account: a.name, value: a.value, region: a.region, industry: a.industry, stage: a.stage, health: a.health, close: '', next: '' }));
    }
    const MODES = ['account', 'stage', 'region'];
    app.ui = app.ui || {};
    if (!app.ui.mode) app.ui.mode = MODES.includes(app.data.groupBy) ? app.data.groupBy : 'account';
    if (!('zoom' in app.ui)) app.ui.zoom = null;
    if (typeof location !== 'undefined' && !app.ui._tz) {
      const q = new URLSearchParams(location.search);
      const g = q.get('tzg'), o = q.get('tzo');
      if (g || o) { app.ui._tz = true; app.ui.zoom = o ? { group: g || '', opp: o } : { group: g }; }
    }

    const compact = el.clientHeight < 190 || el.clientWidth < 300;

    el.innerHTML = `
      <div class="terv">
        ${!compact ? `<div class="terv-top">
          <div class="terv-bc"></div>
          <div class="seg">${MODES.map(m => `<button data-m="${m}" class="${app.ui.mode === m ? 'on' : ''}">${m}</button>`).join('')}</div>
          <div class="terv-total"></div>
        </div>` : ''}
        <div class="petri"></div>
        ${!compact ? `<div class="terv-legend">
          <span><i style="color:${HEALTH_RING.good};background:${HEALTH_RING.good}"></i>Healthy</span>
          <span><i style="color:${HEALTH_RING.warn};background:${HEALTH_RING.warn}"></i>Watch</span>
          <span><i style="color:${HEALTH_RING.risk};background:${HEALTH_RING.risk}"></i>At risk</span>
          <span class="terv-hint">Click to zoom</span>
        </div>` : ''}
      </div>`;

    const petri = el.querySelector('.petri');
    const bcEl = el.querySelector('.terv-bc');
    const segEl = el.querySelector('.seg');
    const totEl = el.querySelector('.terv-total');
    el.querySelectorAll('.seg button').forEach(b => b.onclick = () => {
      app.ui.mode = b.dataset.m;
      app.ui.zoom = null;
      el.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b));
      paint();
    });

    const nodes = new Map();
    const ensure = (kind, key, cls) => {
      const k = kind + ':' + key;
      let n = nodes.get(k);
      if (!n) { n = document.createElement('div'); n.className = cls; petri.appendChild(n); nodes.set(k, n); }
      n.classList.remove('hide');
      return n;
    };
    const hueFor = label => CAT_HUES[[...String(label)].reduce((s, c) => s + c.charCodeAt(0), 0) % CAT_HUES.length];
    const groupOf = it => app.ui.mode === 'account' ? it.account : app.ui.mode === 'stage' ? it.stage : it.region;
    const place = (n, cx, cy, r) => Object.assign(n.style, { left: cx - r + 'px', top: cy - r + 'px', width: r * 2 + 'px', height: r * 2 + 'px' });

    function paint() {
      const pw = petri.clientWidth, ph = petri.clientHeight;
      if (pw < 40 || ph < 40) return;
      const R0 = Math.min(pw, ph) / 2 - 8;
      const cx0 = pw / 2, cy0 = ph / 2;
      let dish = petri.querySelector('.dish');
      if (!dish) { dish = document.createElement('div'); dish.className = 'dish'; petri.prepend(dish); }
      place(dish, cx0, cy0, R0);

      const zoom = app.ui.zoom;
      const ctx = getCtx();
      const used = new Set();

      if (zoom && zoom.opp) {
        /* -------- deal zoom: one bubble morphs into a detail disc -------- */
        const it = items.find(x => x.key === zoom.opp) || items[0];
        const n = ensure('opp', it.key, 'acct');
        n.classList.add('detail');
        n.classList.remove('ctxsel');
        n.style.setProperty('--ah', HEALTH_HUE[it.health] || 200);
        n.style.setProperty('--ring', HEALTH_RING[it.health] || HEALTH_RING.good);
        n.style.fontSize = '';
        place(n, cx0, cy0, Math.min(R0 * 0.68, 190));
        n.title = '';
        n.onclick = null;
        n.innerHTML = `<span class="acct-d">
          <b>${esc(it.name)}</b>
          <i>${esc(it.account)}</i>
          <strong>${fmtM(it.value)}</strong>
          <span class="acct-chips"><em>${esc(it.stage)}</em>${it.close ? `<em>closes ${esc(it.close)}</em>` : ''}<em class="hh-${it.health}">${it.health === 'good' ? 'healthy' : it.health === 'warn' ? 'watch' : 'at risk'}</em></span>
          ${it.next ? `<u>Next · ${esc(it.next)}</u>` : ''}
        </span>`;
        used.add('opp:' + it.key);
      } else {
        /* -------- grouped view (optionally zoomed to one group) -------- */
        const scoped = zoom && zoom.group ? items.filter(it => groupOf(it) === zoom.group) : items;
        const groupsM = new Map();
        scoped.forEach(it => { const k = groupOf(it); if (!groupsM.has(k)) groupsM.set(k, []); groupsM.get(k).push(it); });
        const cats = [...groupsM.entries()].map(([label, its]) => ({ label, its, total: its.reduce((s, x) => s + x.value, 0) })).sort((a, b) => b.total - a.total);
        const single = !!zoom;
        const catPos = single ? [{ x: 0, y: 0, r: R0 - 5 }] : packFit(cats.map(c => c.total), R0 - 6, 8, 0.82);

        cats.forEach((c, i) => {
          const p = catPos[i];
          const cx = cx0 + p.x, cy = cy0 + p.y, r = p.r;
          const showLabel = r > 46;
          const cn = ensure('cat', c.label, 'cat');
          cn.style.setProperty('--ch', hueFor(c.label));
          place(cn, cx, cy, r);
          cn.innerHTML = showLabel ? `<b>${esc(c.label)}</b><em>${fmtM(c.total)}</em>` : '';
          used.add('cat:' + c.label);
          cn.onclick = () => {
            if (app.ui.zoom) return;
            app.ui.zoom = { group: c.label };
            paint();
            const acct = app.ui.mode === 'account' && CRMD ? CRMD.accounts.find(a => a.name === c.label) : null;
            if (acct) selectCtx(acct.id, null, {});
            emit({
              desc: `clicked the "${c.label}" group in the book of business — the app zoomed into it (${fmtM(c.total)}, ${c.its.length} opportunit${c.its.length > 1 ? 'ies' : 'y'}: ${c.its.map(x => x.name).join(', ')}).${acct ? ` Context is now ${acct.name}.` : ''} Give a sharp read on this segment and open the most useful views alongside.`,
              label: `Zoom · ${short(c.label)}`, icon: 'territory',
              route: { key: `groupzoom:${app.ui.mode}:${c.label}` },
            });
          };

          const inner = packFit(c.its.map(x => x.value || 1), Math.max(r - (showLabel ? 16 : 8), 10), single ? 6 : 3, single ? 0.58 : 0.66);
          c.its.forEach((it, j) => {
            const q = inner[j];
            const ar = q.r, ax = cx + q.x, ay = cy + q.y + (showLabel ? 5 : 0);
            const n = ensure('opp', it.key, 'acct');
            n.classList.remove('detail');
            n.classList.toggle('ctxsel', !!ctx.opp && it.oppId === ctx.opp);
            n.style.setProperty('--ah', HEALTH_HUE[it.health] || 200);
            n.style.setProperty('--ring', HEALTH_RING[it.health] || HEALTH_RING.good);
            n.style.fontSize = Math.max(7.5, Math.min(11, ar / 3.4)) + 'px';
            place(n, ax, ay, ar);
            n.title = `${it.name} — ${it.account} · ${fmtM(it.value)} · ${it.stage}`;
            n.innerHTML = `<span>${ar >= 24 ? `${esc(short(it.name))}${ar >= 36 ? `<small>${fmtM(it.value)}</small>` : ''}` : esc(initials(it.name))}</span>`;
            used.add('opp:' + it.key);
            n.onclick = ev => {
              ev.stopPropagation();
              app.ui.zoom = { group: groupOf(it), opp: it.key };
              paint();
              if (it.acctId) selectCtx(it.acctId, it.oppId, {});
              emit({
                desc: `clicked the opportunity "${it.name}" (${it.account}, ${fmtM(it.value)}, stage ${it.stage}, health ${it.health}${it.close ? `, close ${it.close}` : ''}) in the book of business — the app zoomed into the deal and context is now set. Open the views that move this deal.`,
                label: `Opp · ${short(it.name)}`, icon: 'territory',
                route: it.oppId ? { key: `oppzoom:${it.oppId}` } : null,
              });
            };
          });
        });
      }

      for (const [k, n] of nodes) if (!used.has(k)) { n.classList.add('hide'); n.onclick = null; }

      /* top chrome */
      if (bcEl) {
        const z = app.ui.zoom;
        if (z) {
          const it = z.opp ? items.find(x => x.key === z.opp) : null;
          bcEl.innerHTML = `<button data-z="all">All</button>${z.group ? `<s>›</s>${it ? `<button data-z="group">${esc(short(z.group))}</button>` : `<b>${esc(short(z.group))}</b>`}` : ''}${it ? `<s>›</s><b>${esc(short(it.name))}</b>` : ''}`;
          bcEl.querySelectorAll('button').forEach(b => b.onclick = () => {
            app.ui.zoom = b.dataset.z === 'all' ? null : { group: z.group };
            paint();
          });
          if (segEl) segEl.style.display = 'none';
        } else {
          bcEl.innerHTML = '';
          if (segEl) segEl.style.display = '';
        }
      }
      if (totEl) {
        const z = app.ui.zoom;
        const scoped = z && z.group && !z.opp ? items.filter(it => groupOf(it) === z.group) : items;
        totEl.innerHTML = z && z.opp ? '<b>deal view</b>' : `${scoped.length} opportunit${scoped.length === 1 ? 'y' : 'ies'} · <b>${fmtM(scoped.reduce((s, x) => s + x.value, 0))}</b>`;
      }
    }

    requestAnimationFrame(paint);
  };

  R.accountplan = (el, app) => {
    const acct = ctxAcct();
    if (!acct && !(app.data.objectives && app.data.objectives.length)) {
      if (accountPicker(el, 'account plan', 'accountplan')) return;
    }
    const base = acct ? { account: acct.name, arr: acct.arr, health: acct.health, ...acct.plan } : D.accountplan;
    const d = { ...base, ...app.data };
    const obj = d.objectives || base.objectives;
    const W = el.clientWidth, H = el.clientHeight;
    const tall = H > 300, wide = W > 640, mid = H > 190;

    const score = acct ? acct.health_score : 70;
    const donut = (sc, r = 21) => {
      const c = 2 * Math.PI * r;
      const col = sc >= 75 ? 'var(--good)' : sc >= 60 ? 'var(--warn)' : 'var(--bad)';
      return `<svg class="ap-donut" viewBox="0 0 56 56">
        <circle cx="28" cy="28" r="${r}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="5"/>
        <circle cx="28" cy="28" r="${r}" fill="none" stroke="${col}" stroke-width="5" stroke-linecap="round"
          stroke-dasharray="${(c * sc / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 28 28)"/>
        <text x="28" y="32.5" class="ap-donut-t">${sc}</text>
      </svg>`;
    };
    const activity = acct ? acct.activity : [3, 4, 4, 5, 6, 5];
    const mx = Math.max(...activity, 1);
    const months = ['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'];
    const bars = `<div class="ap-bars">${activity.map((v, i) => `
      <div class="ap-bar"><i style="height:${Math.max(8, 100 * v / mx)}%"></i><span>${months[i]}</span></div>`).join('')}</div>`;
    const touches = acct ? (acct.touches || []) : [];
    const tIcon = t => t === 'call' ? '☎' : t === 'email' ? '✉' : '▣';
    const touchesHTML = touches.length ? `
      <div class="ap-sec"><h4>Recent touches</h4><div class="ap-touches">${touches.map((t, i) => `
        <button class="ap-touch zap" data-t="${i}">
          <i class="tt-${t.s}">${tIcon(t.type)}</i>
          <div><b>${esc(t.who)} <em>· ${esc(t.d)}</em></b><span>${esc(t.note)}</span></div>
        </button>`).join('')}</div></div>` : '';

    const statsHTML = acct ? `
      <div class="ap-vitals">
        ${donut(score)}
        <div class="ap-stats">
          <div><b>${touches.length * 3 + 2}</b><span>touches / qtr</span></div>
          <div><b>${acct.opps[0] ? acct.opps[0].close : '—'}</b><span>next close</span></div>
          <div><b>${acct.arr ? fmtM(acct.arr) : 'new'}</b><span>ARR</span></div>
        </div>
      </div>
      <div class="ap-sec"><h4>Engagement · 6 mo</h4>${bars}</div>` : '';

    const planHTML = `
      <div class="ap-sec"><h4>Objectives</h4>${obj.map((o, i) => `
        <div class="ap-obj"><input type="checkbox" data-i="${i}" ${o.done ? 'checked' : ''}><span class="zap" data-o="${i}">${esc(o.text || o)}</span></div>`).join('')}</div>
      ${mid ? `<div class="ap-sec"><h4>Risks</h4><div class="ap-chips">${(d.risks || []).map((r, i) => `<span class="risk zap" data-r="${i}">${esc(r)}</span>`).join('')}</div></div>` : ''}
      ${tall ? `<div class="ap-sec"><h4>Next steps</h4><ol>${(d.nextSteps || []).map((s, i) => `<li class="zap" data-n="${i}">${esc(s)}</li>`).join('')}</ol></div>` : ''}`;

    el.innerHTML = `
      <div class="ap ${wide ? 'wide' : ''}">
        <div class="ap-acct">${esc(d.account || 'Account')}${acct ? `<span class="ap-meta">${hdot(acct.health)}${acct.arr ? fmtM(acct.arr) + ' ARR' : 'new logo'} · ${acct.opps.length} open opp${acct.opps.length > 1 ? 's' : ''}</span>` : ''}</div>
        ${wide
    ? `<div class="ap-cols"><div class="ap-col">${planHTML}</div><div class="ap-col">${statsHTML}${tall ? touchesHTML : ''}</div></div>`
    : `${mid ? statsHTML : ''}${planHTML}${tall ? touchesHTML : ''}`}
      </div>`;

    el.querySelectorAll('.ap-touch').forEach(n => n.onclick = () => {
      const t = touches[Number(n.dataset.t)];
      emit({
        desc: `clicked the recent touch "${t.note}" (${t.type} with ${t.who}, ${t.d}) in the ${d.account} account plan. React — what does it mean and what's the follow-up?`,
        label: `Touch · ${short(t.who)}`, icon: 'accountplan',
        route: acct ? { key: `touch:${acct.id}:${n.dataset.t}` } : null,
      });
    });
    el.querySelectorAll('.ap-obj input').forEach(c => c.onchange = () => { if (obj[c.dataset.i]) obj[c.dataset.i].done = c.checked; });
    const acctLabel = d.account || 'the account';
    el.querySelectorAll('[data-o]').forEach(n => n.onclick = () => {
      const o = obj[Number(n.dataset.o)];
      emit({ desc: `clicked the objective "${o.text || o}" (${o.done ? 'done' : 'open'}) in the account plan for ${acctLabel}. Break it down — open or update the tool(s) that advance it.`, label: `Objective · ${short(o.text || o)}`, icon: 'accountplan', route: acct ? { key: `obj:${acct.id}:${n.dataset.o}` } : null });
    });
    el.querySelectorAll('[data-r]').forEach(n => n.onclick = () => {
      const r = (d.risks || [])[Number(n.dataset.r)];
      emit({ desc: `clicked the risk "${r}" in the account plan for ${acctLabel}. Propose a mitigation and open the supporting tool(s).`, label: `Risk · ${short(r)}`, icon: 'accountplan', route: acct ? { key: `risk:${acct.id}:${n.dataset.r}` } : null });
    });
    el.querySelectorAll('[data-n]').forEach(n => n.onclick = () => {
      const s = (d.nextSteps || [])[Number(n.dataset.n)];
      emit({ desc: `clicked the next step "${s}" in the account plan for ${acctLabel}. Prep them for it — open what they need to execute it.`, label: `Step · ${short(s)}`, icon: 'accountplan', route: acct ? { key: `step:${acct.id}:${n.dataset.n}` } : null });
    });
  };

  R.pipeline = (el, app) => {
    let stages;
    if (app.data.stages && app.data.stages.length) {
      stages = app.data.stages;
    } else if (CRMD) {
      stages = CRMD.stages.map(name => ({
        name,
        deals: CRMD.accounts.flatMap(a => a.opps.filter(o => o.stage === name).map(o => ({
          name: o.name, account: a.name, value: o.value, acctId: a.id, oppId: o.id, health: o.health, close: o.close, next: o.next,
        }))),
      }));
    } else {
      stages = D.pipeline.stages;
    }
    const ctx = getCtx();
    const narrow = el.clientWidth < 460;
    if (narrow) {
      const max = Math.max(...stages.map(s => s.deals.reduce((a, x) => a + x.value, 0)), 1);
      el.innerHTML = `<div class="pipe-funnel">${stages.map(s => {
        const tot = s.deals.reduce((a, x) => a + x.value, 0);
        return `<div class="pf-row"><span>${esc(s.name)}</span><div class="pf-bar"><i style="width:${Math.max(8, 100 * tot / max)}%"></i></div><em>${fmt$(tot)}K</em></div>`;
      }).join('')}</div>`;
      return;
    }
    el.innerHTML = `<div class="pipe">${stages.map((s, si) => `
      <div class="pipe-col">
        <div class="pipe-head zap" data-s="${si}"><span>${esc(s.name)}</span><em>${fmt$(s.deals.reduce((a, x) => a + x.value, 0))}K</em></div>
        ${s.deals.map((dl, di) => `<div class="deal ${dl.oppId && dl.oppId === ctx.opp ? 'ctx' : ''}" data-s="${si}" data-d="${di}">
          <b>${esc(dl.name)}</b><span>${esc(dl.account)}</span><em>${fmt$(dl.value)}K</em>
          ${dl.next ? `<div class="deal-x">${hdot(dl.health)}<span>${esc(dl.next)}</span>${dl.close ? `<em>${esc(dl.close)}</em>` : ''}</div>` : ''}
        </div>`).join('') || '<div class="pipe-empty">no deals</div>'}
      </div>`).join('')}</div>`;
    el.querySelectorAll('.deal').forEach(n => n.onclick = () => {
      const st = stages[Number(n.dataset.s)];
      const dl = st && st.deals[Number(n.dataset.d)];
      if (!dl) return;
      if (n.classList.contains('open')) { n.classList.remove('open'); return; }
      el.querySelectorAll('.deal.open').forEach(x => x.classList.remove('open'));
      n.classList.add('open');
      if (dl.acctId) selectCtx(dl.acctId, dl.oppId, {});
      emit({
        desc: `clicked the deal "${dl.name}" (${dl.account}, $${dl.value}K, stage ${st.name}${dl.close ? `, close ${dl.close}` : ''}) in the pipeline board — it expanded inline and context is now set. Open whatever moves this deal.`,
        label: `Deal · ${short(dl.name)}`, icon: 'pipeline',
        route: dl.oppId ? { key: `deal:${dl.oppId}` } : null,
      });
    });
    el.querySelectorAll('.pipe-head').forEach(n => n.onclick = () => {
      const st = stages[Number(n.dataset.s)];
      if (!st) return;
      const tot = st.deals.reduce((a, x) => a + x.value, 0);
      emit({
        desc: `clicked the "${st.name}" stage header ($${tot}K across ${st.deals.length} deal${st.deals.length === 1 ? '' : 's'}: ${st.deals.map(x => x.name).join(', ')}). Give a stage health read and open what helps move these deals forward.`,
        label: `Stage · ${st.name}`, icon: 'pipeline',
        route: { key: `stage:${st.name}` },
      });
    });
  };

  /* Call Review — post-call debrief, wired to open what comes next */
  R.callreview = (el, app) => {
    const acct = ctxAcct();
    const rv = (app.data.title && app.data) || (acct && acct.review);
    if (!rv || !acct) {
      if (accountPicker(el, 'call review', 'callreview', 'callreview')) return;
      el.innerHTML = '<div class="pick"><div class="pick-cap">No recent call</div></div>';
      return;
    }
    const H = el.clientHeight;
    const mid = H > 185, tall = H > 300;
    const sc = rv.score;
    const scol = sc >= 75 ? 'var(--good)' : sc >= 60 ? '#e8a020' : 'var(--bad)';
    const c = 2 * Math.PI * 15;
    el.innerHTML = `
      <div class="cr">
        <div class="cr-head">
          <svg viewBox="0 0 40 40" class="cr-ring">
            <circle cx="20" cy="20" r="15" fill="none" stroke="var(--fill-2)" stroke-width="4"/>
            <circle cx="20" cy="20" r="15" fill="none" stroke="${scol}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(c * sc / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 20 20)"/>
            <text x="20" y="24">${sc}</text>
          </svg>
          <div class="cr-id">
            <b>${esc(rv.title)}</b>
            <span>${esc(rv.when)} · ${esc(acct.name)}</span>
            <div class="cr-with">${(rv.with || []).map(w => `<button class="cp-att zap" data-w="${esc(w)}">${esc(initials(w))} ${esc(w.split(' ')[0])}</button>`).join('')}</div>
          </div>
        </div>
        ${mid ? `<div class="cr-cols">
          <div><h5>What landed</h5><ul class="cr-win">${(rv.wins || []).map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>
          <div><h5>What worries</h5><ul class="cr-con">${(rv.concerns || []).map((w, i) => `<li class="zap" data-c="${i}">${esc(w)}</li>`).join('')}</ul></div>
        </div>` : ''}
        ${tall ? `<div class="ap-sec"><h4>Commitments</h4><div class="cr-com">${(rv.commitments || []).map((cm, i) => `
          <button class="cr-cm zap" data-m="${i}"><b>${esc(cm.who)}</b><span>${esc(cm.what)}</span><em>${esc(cm.by)}</em></button>`).join('')}</div></div>` : ''}
        ${tall ? `<div class="oc-act">
          <button data-a="follow">${icon('notes')}Draft follow-up</button>
          <button data-a="next">${icon('callprep')}Prep next call</button>
        </div>` : ''}
      </div>`;
    el.querySelectorAll('.cp-att').forEach(b => b.onclick = () => {
      const name = b.dataset.w;
      const person = acct.stakeholders.find(s => s.name === name) || { name, role: '', sentiment: 'neutral' };
      emit({ kind: 'person', person, account: acct.name });
    });
    el.querySelectorAll('[data-c]').forEach(n => n.onclick = () => {
      const w = rv.concerns[Number(n.dataset.c)];
      emit({
        desc: `clicked the call-review concern "${w}" from the ${rv.title} with ${acct.name}. Turn it into a move — who to touch, what to open.`,
        label: `Concern · ${short(w)}`, icon: 'callreview',
        route: { key: `rvw:${acct.id}:${n.dataset.c}` },
      });
    });
    el.querySelectorAll('.cr-cm').forEach(n => n.onclick = () => {
      const cm = rv.commitments[Number(n.dataset.m)];
      emit({
        desc: `clicked the commitment "${cm.who}: ${cm.what} (by ${cm.by})" from the ${acct.name} call review. Make sure it happens.`,
        label: `Commit · ${short(cm.what)}`, icon: 'callreview',
        route: { key: `commit:${acct.id}:${n.dataset.m}` },
      });
    });
    el.querySelectorAll('.oc-act button').forEach(b => b.onclick = () => {
      if (b.dataset.a === 'next') {
        emit({
          desc: `hit “Prep next call” from the ${acct.name} call review.`,
          label: 'Prep next call', icon: 'callprep',
          route: { key: `uc:call:${acct.id}` },
        });
      } else {
        emit({
          desc: `hit “Draft follow-up” on the ${acct.name} call review (${rv.title}, ${rv.when}). Draft a crisp follow-up note in the notes tile covering wins, open concerns and both commitments, then arrange anything that helps.`,
          label: 'Draft follow-up', icon: 'notes',
        });
      }
    });
  };

  /* Opportunity snapshot card */
  R.oppcard = (el, app) => {
    const co = ctxOpp();
    if (!co) {
      if (CRMD) { oppPicker(el, { caption: 'Pick an opportunity', route: 'oppswitch' }); return; }
      el.innerHTML = '<div class="pick"><div class="pick-cap">No opportunity</div></div>';
      return;
    }
    const acct = co.acct, opp = co.opp;
    const stages = CRMD.stages;
    const idx = Math.max(0, stages.indexOf(opp.stage));
    const H = el.clientHeight;
    const mid = H > 175, tall = H > 290;
    el.innerHTML = `
      <div class="oc">
        <div class="oc-top"><span>${esc(acct.name)}</span>${hdot(opp.health)}</div>
        <div class="oc-name">${esc(opp.name)}</div>
        <div class="oc-val">${fmtM(opp.value)}<span>closes ${esc(opp.close)} · ${opp.term || 24} mo · ${opp.lines.length} SKU${opp.lines.length > 1 ? 's' : ''}</span></div>
        <div class="oc-stage">${stages.map((s, i) => `<i class="${i < idx ? 'done' : ''}${i === idx ? ' now' : ''}" title="${esc(s)}"></i>`).join('')}<b>${esc(opp.stage)}</b></div>
        ${mid ? `<p class="oc-sum">${esc(opp.summary || '')}</p>` : ''}
        ${mid ? `<button class="oc-next zap"><span>Next</span>${esc(opp.next)}</button>` : ''}
        ${tall ? `<div class="oc-act">
          <button data-a="quote">${icon('pricing')}Open quote</button>
          <button data-a="room">${icon('accountplan')}Deal room</button>
        </div>` : ''}
      </div>`;
    const nx = el.querySelector('.oc-next');
    if (nx) nx.onclick = () => emit({
      desc: `clicked the next step "${opp.next}" on the ${opp.name} card. Set them up to execute it.`,
      label: `Next · ${short(opp.next)}`, icon: 'oppcard',
      route: { key: `deal:${opp.id}` },
    });
    el.querySelectorAll('.oc-act button').forEach(b => b.onclick = () => {
      const quote = b.dataset.a === 'quote';
      emit({
        desc: quote
          ? `hit “Open quote” on the ${opp.name} card — open the configurator and coach the pricing posture.`
          : `hit “Deal room” on the ${opp.name} card — assemble the room.`,
        label: quote ? 'Open quote' : 'Deal room', icon: quote ? 'pricing' : 'accountplan',
        route: { key: quote ? `uc:quote:${opp.id}` : `uc:dealroom:${opp.id}` },
      });
    });
  };

  /* Pricing v2 — IBM-grade configurator: metric sizing, term, support tier,
     volume + term + negotiated discount stack, TCV / annual / monthly. */
  const TERM_DISC = { 3: 0, 12: 0, 24: 0.06, 36: 0.12 };
  const SUPPORT = [['std', 'Standard', 0], ['prem', 'Premium', 0.10], ['elite', 'Elite', 0.18]];

  R.pricing = (el, app) => {
    const co = ctxOpp();
    if (!co) {
      if (CRMD) { oppPicker(el); return; }
      el.innerHTML = '<div class="pick"><div class="pick-cap">No quote</div></div>';
      return;
    }
    const d = { account: co.acct.name, opp: co.opp.name, stage: co.opp.stage, close: co.opp.close, lines: co.opp.lines, key: co.opp.id };
    const lines = d.lines;
    if (!app.ui || app.ui.key !== d.key) {
      app.ui = { key: d.key, disc: app.data.discount ?? co.opp.discount ?? 10, term: app.data.term ?? co.opp.term ?? 24, supp: 'std', warned: false };
    }
    const U = app.ui;
    const H = el.clientHeight;
    const compact = H < 250, tiny = H < 170;

    const calc = () => {
      const monthly = lines.filter(l => l.type !== 'svc').reduce((s, l) => s + l.qty * l.price, 0);
      const svc = lines.filter(l => l.type === 'svc').reduce((s, l) => s + l.qty * l.price, 0);
      const list = monthly * U.term + svc;
      const vol = list >= 1000000 ? 0.06 : list >= 500000 ? 0.03 : 0;
      const tdisc = TERM_DISC[U.term] || 0;
      const neg = U.disc / 100;
      const subNet = monthly * U.term * (1 - vol) * (1 - tdisc) * (1 - neg);
      const suppPct = SUPPORT.find(s => s[0] === U.supp)[2];
      const support = subNet * suppPct;
      const svcNet = svc * (1 - neg);
      const net = subNet + support + svcNet;
      const stack = Math.round((vol + tdisc + neg) * 100);
      return { monthly, svc, list, vol, tdisc, subNet, support, svcNet, net, stack, suppPct };
    };
    const lineTotal = l => l.type === 'svc' ? l.qty * l.price : l.qty * l.price * U.term;

    const draw = () => {
      const c = calc();
      el.innerHTML = `
      <div class="price v2">
        <div class="price-acct">${esc(d.account)}<span class="price-opp">${esc(d.opp)} · ${esc(d.stage)} · closes ${esc(d.close)}</span></div>
        ${!tiny ? `
        <div class="pr-ctl">
          <div class="seg">${[12, 24, 36].map(t => `<button data-t="${t}" class="${U.term === t ? 'on' : ''}">${t} mo</button>`).join('')}</div>
          <div class="seg">${SUPPORT.map(([k, lb]) => `<button data-s="${k}" class="${U.supp === k ? 'on' : ''}">${lb}</button>`).join('')}</div>
        </div>` : ''}
        ${!compact ? `<div class="price-lines">${lines.map((l, i) => `
          <div class="pl v2 ${l.type === 'svc' ? 'issvc' : ''}" data-i="${i}">
            <div class="pl-main zap" data-x="${i}">
              <span class="pl-sku">${esc(l.sku)}</span>
              <span class="pl-desc">${esc(l.desc)}</span>
              <span class="pl-tag">${l.type === 'svc' ? 'one-time' : '$' + l.price + '/' + esc(l.unit).replace(/s$/, '') + '/mo'}</span>
              <span class="pl-amt">${fmt$(Math.round(lineTotal(l)))}</span>
            </div>
            ${l.max > l.min ? `<div class="pl-size">
              <button class="qb" data-q="-1" data-i="${i}">−</button>
              <b>${l.qty.toLocaleString()}</b><span>${esc(l.unit)}</span>
              <button class="qb" data-q="1" data-i="${i}">+</button>
            </div>` : ''}
            <div class="pl-x">${l.type === 'svc' ? 'One-time services · outside term & volume discounts' : `${l.qty.toLocaleString()} ${esc(l.unit)} × $${l.price}/mo × ${U.term} mo = ${fmt$(Math.round(lineTotal(l)))} list`}</div>
          </div>`).join('')}</div>` : ''}
        <div class="price-disc"><span>Negotiated <b class="pd-val">${U.disc}%</b></span><input type="range" min="0" max="30" value="${U.disc}"></div>
        <div class="pr-break">
          <div><span>List TCV · ${U.term} mo</span><em>${fmt$(Math.round(c.list))}</em></div>
          ${c.vol ? `<div class="dsc"><span>Volume tier</span><em>−${Math.round(c.vol * 100)}%</em></div>` : ''}
          ${c.tdisc ? `<div class="dsc"><span>Term commit</span><em>−${Math.round(c.tdisc * 100)}%</em></div>` : ''}
          ${U.disc ? `<div class="dsc"><span>Negotiated</span><em>−${U.disc}%</em></div>` : ''}
          ${c.suppPct ? `<div><span>Support uplift</span><em>+${Math.round(c.suppPct * 100)}%</em></div>` : ''}
          <div class="net"><span>Net TCV</span><em class="pd-net">${fmt$(Math.round(c.net))}</em></div>
          <div class="pr-run"><span>≈ ${fmt$(Math.round((c.net - c.svcNet) / Math.max(U.term / 12, 0.25)))} / yr · ${fmt$(Math.round((c.net - c.svcNet) / U.term))} / mo</span>${c.stack >= 20 ? '<i class="dd">deal desk required</i>' : ''}</div>
        </div>
      </div>`;

      el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { U.term = Number(b.dataset.t); draw(); });
      el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { U.supp = b.dataset.s; draw(); });
      el.querySelectorAll('.qb').forEach(b => b.onclick = ev => {
        ev.stopPropagation();
        const l = lines[Number(b.dataset.i)];
        l.qty = Math.max(l.min, Math.min(l.max, l.qty + Number(b.dataset.q) * l.step));
        draw();
      });
      const range = el.querySelector('input[type=range]');
      range.oninput = ev => {
        U.disc = Number(ev.target.value);
        const c2 = calc();
        el.querySelector('.pd-val').textContent = U.disc + '%';
        el.querySelector('.pd-net').textContent = fmt$(Math.round(c2.net));
      };
      range.onchange = () => {
        draw();
        const c2 = calc();
        if (c2.stack >= 20 && !U.warned) {
          U.warned = true;
          emit({
            desc: `stacked the ${d.opp} quote to ${c2.stack}% total discount (volume+term+negotiated → net ${fmt$(Math.round(c2.net))} TCV over ${U.term} mo). React like a deal desk: margin impact, approval path, and what to demand in return.`,
            label: `Discount stack → ${c2.stack}%`, icon: 'pricing',
            route: { key: `disc:${d.key}`, params: { pct: c2.stack } },
          });
        } else if (c2.stack < 20) U.warned = false;
      };
      el.querySelectorAll('.pl-main').forEach(n => n.onclick = () => {
        const row = n.closest('.pl');
        const l = lines[Number(n.dataset.x)];
        if (row.classList.contains('open')) { row.classList.remove('open'); return; }
        el.querySelectorAll('.pl.open').forEach(x => x.classList.remove('open'));
        row.classList.add('open');
        emit({
          desc: `clicked the quote line ${l.sku} — ${l.qty} ${l.unit} of ${l.desc} (${fmt$(Math.round(lineTotal(l)))} of the ${U.term}-mo TCV) on ${d.opp}. Justify the sizing: ROI proof, what it replaces, or how to restructure.`,
          label: `Line · ${l.sku}`, icon: 'pricing',
          route: { key: `line:${d.key}:${l.sku}` },
        });
      });
    };
    draw();
  };

  R.metrics = (el, app) => {
    const d = { ...app.data };
    const kpis = d.kpis && d.kpis.length ? d.kpis : (CRMD && CRMD.metrics ? CRMD.metrics.kpis : D.metrics.kpis);
    const spark = pts => {
      if (!pts || pts.length < 2) return '';
      const min = Math.min(...pts), max = Math.max(...pts), r = max - min || 1;
      const p = pts.map((v, i) => `${(i * 60 / (pts.length - 1)).toFixed(1)},${(19 - 15 * (v - min) / r).toFixed(1)}`).join(' ');
      return `<svg viewBox="0 0 60 22" preserveAspectRatio="none"><polygon points="0,22 ${p} 60,22"/><polyline points="${p}"/></svg>`;
    };
    el.innerHTML = `<div class="kpis">${kpis.map((k, i) => `
      <div class="kpi" data-i="${i}" title="Click to drill in"><span class="kpi-label">${esc(k.label)}</span><div class="kpi-val">${esc(k.value)}<em class="${String(k.delta).startsWith('-') ? 'down' : 'up'}">${esc(k.delta)}</em></div>${spark(k.spark)}</div>`).join('')}</div>`;
    el.querySelectorAll('.kpi').forEach(n => n.onclick = () => {
      const k = kpis[Number(n.dataset.i)];
      emit({
        desc: `clicked the KPI "${k.label}" (${k.value}, ${k.delta}). Drill in — open the tool(s) that explain what's driving this number and where it's headed.`,
        label: `KPI · ${k.label}`, icon: 'metrics',
        route: { key: `kpi:${k.label}` },
      });
    });
  };

  R.profile = (el, app) => {
    const d = {};
    for (const [k, v] of Object.entries(app.data || {})) if (v !== undefined && v !== null && v !== '') d[k] = v;
    const name = d.name || D.profile.name;
    let base = null;
    if (CRMD) {
      const pool = [ctxAcct(), ...CRMD.accounts].filter(Boolean);
      for (const a of pool) {
        const s = (a.stakeholders || []).find(x => x.name === name);
        if (s) { base = { ...s, account: a.name }; break; }
      }
    }
    const merged = base ? { ...base, ...d } : d;
    const skeleton = !(merged.bio || (merged.talkingPoints && merged.talkingPoints.length));
    const full = skeleton ? { ...D.profile, ...merged } : merged;
    const sent = full.sentiment || 'neutral';
    const sc = sent === 'champion' ? 'var(--good)' : sent === 'detractor' ? 'var(--bad)' : '#9aa6bd';
    const tall = el.clientHeight > 300, mid = el.clientHeight > 190;
    const inf = Math.max(5, Math.min(100, full.influence || 50));
    const sk = n => Array.from({ length: n }, (_, i) => `<div class="skl" style="width:${88 - i * 14}%"></div>`).join('');
    el.innerHTML = `
      <div class="prof">
        <div class="prof-head">
          <div class="prof-ava" style="--sc:${sc}">${initials(name)}</div>
          <div class="prof-id">
            <b>${esc(name)}</b>
            <span>${esc(full.role || '')}${full.account ? ' · ' + esc(full.account) : ''}</span>
            <div class="prof-tags"><i class="prof-sent" style="--sc:${sc}">${esc(sent)}</i>${full.lastTouch ? `<i class="prof-touch">${esc(full.lastTouch)}</i>` : ''}</div>
          </div>
        </div>
        <div class="prof-inf"><span>Influence</span><div class="prof-bar"><i style="width:${skeleton ? 30 : inf}%"></i></div><em>${skeleton ? '—' : inf}</em></div>
        ${skeleton ? `<div class="prof-sk">${sk(3)}<div class="prof-skcap">Copilot is pulling the full profile…</div></div>` : `
          <p class="prof-bio">${esc(full.bio || '')}</p>
          ${mid && full.talkingPoints ? `<div class="prof-sec"><h5>Talking points</h5><ul class="prof-tp">${full.talkingPoints.map((t, i) => `<li class="zap" data-tp="${i}">${esc(t)}</li>`).join('')}</ul></div>` : ''}
          ${tall && full.watchouts && full.watchouts.length ? `<div class="prof-sec"><h5>Watch out</h5><div class="ap-chips">${full.watchouts.map((w, i) => `<span class="risk zap" data-w="${i}">${esc(w)}</span>`).join('')}</div></div>` : ''}
          ${tall && full.connections && full.connections.length ? `<div class="prof-sec"><h5>Connections</h5><div class="prof-conn">${full.connections.map(c => `<button data-n="${esc(c.name)}">${esc(c.name)}<span>${esc(c.note || '')}</span></button>`).join('')}</div></div>` : ''}
        `}
      </div>`;
    el.querySelectorAll('.prof-conn button').forEach(b => b.onclick = () =>
      emit({ kind: 'person', person: { name: b.dataset.n, role: '', sentiment: 'neutral' }, account: full.account || '' }));
    el.querySelectorAll('[data-tp]').forEach(n => n.onclick = () => {
      const t = (full.talkingPoints || [])[Number(n.dataset.tp)];
      emit({
        desc: `clicked the talking point "${t}" for ${name}. Turn it into ammunition — e.g. update the deck with a slide built on it, or open the proof (metrics, pricing, references).`,
        label: `Point · ${short(t)}`, icon: 'profile',
        route: { key: `tp:${full.name}:${n.dataset.tp}` },
      });
    });
    el.querySelectorAll('[data-w]').forEach(n => n.onclick = () => {
      const w = (full.watchouts || [])[Number(n.dataset.w)];
      emit({
        desc: `clicked the watch-out "${w}" for ${name}. Build the counter — mitigation plan and the tool(s) that defuse it.`,
        label: `Risk · ${short(w)}`, icon: 'profile',
        route: { key: `wo:${full.name}:${n.dataset.w}` },
      });
    });
  };

  R.notes = (el, app) => {
    const acct = ctxAcct();
    const d = { ...app.data };
    const items = d.items && d.items.length ? d.items
      : acct ? acct.notes
      : CRMD ? CRMD.globalNotes
      : D.notes.items;
    const title = d.title || (acct ? `${acct.name} — Notes` : 'Territory Notes');
    el.innerHTML = `<div class="notes"><div class="notes-title">${esc(title)}</div>
      <ul>${items.map((t, i) => `<li class="zap" data-i="${i}">${esc(t)}</li>`).join('')}</ul></div>`;
    el.querySelectorAll('.notes li').forEach(n => n.onclick = () => {
      const t = items[Number(n.dataset.i)];
      emit({
        desc: `clicked the note "${t}". Act on it — open or update whatever tool addresses it, and say what you did.`,
        label: `Note · ${short(t)}`, icon: 'notes',
        route: acct && !d.items ? { key: `note:${acct.id}:${n.dataset.i}` } : null,
      });
    });
  };

  /* ---- Call Prep: next meeting, goal, agenda, intel ---- */
  R.callprep = (el, app) => {
    const acct = ctxAcct();
    const mt = (app.data.title && app.data) || (acct && acct.meetings && acct.meetings[0]);
    if (!mt || !acct) {
      if (accountPicker(el, 'call prep', 'callprep', 'callprep')) return;
      el.innerHTML = '<div class="pick"><div class="pick-cap">No upcoming call</div></div>';
      return;
    }
    app.ui = app.ui || { done: {} };
    const tall = el.clientHeight > 300, mid = el.clientHeight > 185;
    el.innerHTML = `
      <div class="cp">
        <div class="cp-when">${esc(mt.when)} · ${esc(acct.name)}</div>
        <div class="cp-title">${esc(mt.title)}</div>
        <div class="cp-goal"><span>One goal</span>${esc(mt.goal)}</div>
        ${mid ? `<div class="cp-with">${(mt.with || []).map(w => `<button class="cp-att zap" data-w="${esc(w)}">${esc(initials(w))}<span>${esc(w)}</span></button>`).join('')}</div>` : ''}
        ${mid ? `<div class="ap-sec"><h4>Agenda</h4>${(mt.agenda || []).map((a, i) => `
          <div class="ap-obj"><input type="checkbox" data-ci="${i}" ${app.ui.done[i] ? 'checked' : ''}><span class="zap" data-a="${i}">${esc(a)}</span></div>`).join('')}</div>` : ''}
        ${tall && mt.intel ? `<div class="ap-sec"><h4>Intel</h4><ul class="cp-intel">${mt.intel.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      </div>`;
    el.querySelectorAll('[data-ci]').forEach(c => c.onchange = () => { app.ui.done[c.dataset.ci] = c.checked; });
    el.querySelectorAll('.cp-att').forEach(b => b.onclick = () => {
      const name = b.dataset.w;
      const person = acct.stakeholders.find(s => s.name === name) || { name, role: '', sentiment: 'neutral' };
      emit({ kind: 'person', person, account: acct.name });
    });
    el.querySelectorAll('[data-a]').forEach(n => n.onclick = () => {
      const a = mt.agenda[Number(n.dataset.a)];
      emit({
        desc: `clicked the agenda item "${a}" for the "${mt.title}" call with ${acct.name} (${mt.when}). Arm them for this item — coaching plus the right tool.`,
        label: `Agenda · ${short(a)}`, icon: 'callprep',
        route: acct ? { key: `agenda:${acct.id}:${n.dataset.a}` } : null,
      });
    });
  };

  /* ---- Strategy Map: customer goals → initiatives → our opportunities ---- */
  R.oppmap = (el, app) => {
    const acct = ctxAcct();
    const strat = (app.data.goals && app.data.inits) ? app.data : (acct && acct.strategy);
    if (!strat || !acct) {
      if (accountPicker(el, 'strategy map', 'oppmap', 'oppmap')) return;
      el.innerHTML = '<div class="pick"><div class="pick-cap">No strategy data</div></div>';
      return;
    }
    const goals = strat.goals || [];
    const inits = strat.inits || [];
    const oppIds = [...new Set(inits.flatMap(x => x.opps || []))];
    const opps = oppIds.map(id => acct.opps.find(o => o.id === id)).filter(Boolean);
    const compact = el.clientHeight < 175;

    el.innerHTML = `
      <div class="smap">
        ${!compact ? `<div class="smap-cols"><span>Their goals</span><span>Their initiatives</span><span>Our deals</span></div>` : ''}
        <div class="smap-body">
          <svg class="smap-svg"></svg>
          <div class="smap-col" data-c="g">${goals.map(g => `<div class="sm-node g zap" data-k="g:${g.id}"><span>${esc(g.t)}</span></div>`).join('')}</div>
          <div class="smap-col" data-c="i">${inits.map(x => `<div class="sm-node i zap" data-k="i:${x.id}"><span>${esc(x.t)}</span></div>`).join('')}</div>
          <div class="smap-col" data-c="o">${opps.map(o => `<div class="sm-node o zap" data-k="o:${o.id}"><i class="hdot ${o.health}"></i><span>${esc(o.name)}</span><em>${fmtM(o.value)}</em></div>`).join('')}</div>
        </div>
      </div>`;

    const body = el.querySelector('.smap-body');
    const svg = el.querySelector('.smap-svg');
    const nodeEl = k => el.querySelector(`[data-k="${k}"]`);
    const links = [];
    inits.forEach(x => {
      (x.goals || []).forEach(g => links.push([`g:${g}`, `i:${x.id}`]));
      (x.opps || []).forEach(o => links.push([`i:${x.id}`, `o:${o}`]));
    });
    const adj = new Map();
    const addAdj = (a, b) => { if (!adj.has(a)) adj.set(a, new Set([a])); adj.get(a).add(b); };
    links.forEach(([a, b]) => { addAdj(a, b); addAdj(b, a); });
    // transitive: goal → opp through inits
    links.forEach(([a, b]) => { if (a.startsWith('g:')) links.filter(l => l[0] === b).forEach(l2 => { addAdj(a, l2[1]); addAdj(l2[1], a); }); });

    requestAnimationFrame(() => {
      const br = body.getBoundingClientRect();
      svg.setAttribute('viewBox', `0 0 ${br.width} ${br.height}`);
      const paths = [];
      links.forEach(([a, b]) => {
        const na = nodeEl(a), nb = nodeEl(b);
        if (!na || !nb) return;
        const ra = na.getBoundingClientRect(), rb = nb.getBoundingClientRect();
        const x1 = ra.right - br.left, y1 = ra.top + ra.height / 2 - br.top;
        const x2 = rb.left - br.left, y2 = rb.top + rb.height / 2 - br.top;
        const mx = (x1 + x2) / 2;
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`);
        p.setAttribute('class', 'sm-link');
        p.dataset.a = a; p.dataset.b = b;
        svg.appendChild(p);
        paths.push(p);
      });
      const light = k => {
        const set = adj.get(k) || new Set([k]);
        el.querySelectorAll('.sm-node').forEach(n => n.classList.toggle('lit', set.has(n.dataset.k)));
        paths.forEach(p => p.classList.toggle('lit', set.has(p.dataset.a) && set.has(p.dataset.b)));
        body.classList.add('focused');
      };
      const unlight = () => {
        el.querySelectorAll('.sm-node').forEach(n => n.classList.remove('lit'));
        paths.forEach(p => p.classList.remove('lit'));
        body.classList.remove('focused');
      };
      el.querySelectorAll('.sm-node').forEach(n => {
        n.addEventListener('mouseenter', () => light(n.dataset.k));
        n.addEventListener('mouseleave', unlight);
        n.onclick = () => {
          const [kind, id] = n.dataset.k.split(':');
          if (kind === 'o') {
            const o = acct.opps.find(x => x.id === id);
            selectCtx(acct.id, id, {});
            emit({
              desc: `clicked our opportunity "${o.name}" in the strategy map for ${acct.name} — its card just popped and context is set. Show how it lands.`,
              label: `Deal · ${short(o.name)}`, icon: 'oppmap',
              route: { key: `deal:${id}` },
              instant: { app: 'oppcard', size: 'm' },
            });
          } else if (kind === 'g') {
            const g = goals.find(x => x.id === id);
            emit({ desc: `clicked the customer goal "${g.t}" in ${acct.name}'s strategy map. Trace it to our opportunities.`, label: `Goal · ${short(g.t)}`, icon: 'oppmap', route: { key: `goal:${acct.id}:${id}` } });
          } else {
            const x = inits.find(y => y.id === id);
            emit({ desc: `clicked the initiative "${x.t}" in ${acct.name}'s strategy map. Trace it to our opportunities.`, label: `Initiative · ${short(x.t)}`, icon: 'oppmap', route: { key: `init:${acct.id}:${id}` } });
          }
        };
      });
    });
  };

  /* ---- Battlecard vs Hyperion ---- */
  R.battlecard = (el, app) => {
    const B = app.data.competitor ? app.data : (CRMD && CRMD.battle);
    if (!B) { el.innerHTML = '<div class="pick"><div class="pick-cap">No battlecard data</div></div>'; return; }
    const acct = ctxAcct();
    const pres = acct && B.presence && B.presence[acct.id];
    const tall = el.clientHeight > 330, mid = el.clientHeight > 210;
    el.innerHTML = `
      <div class="bc">
        <div class="bc-head">
          <b>${esc(B.competitor)}</b>
          <span>${esc(B.tagline || '')}</span>
          ${pres ? `<div class="bc-pres bc-${pres.status}"><i></i>${esc(acct.name)}: ${esc(pres.status)} — ${esc(pres.note)}</div>` : ''}
        </div>
        <div class="bc-grid">
          <div class="bc-sec win"><h5>Why we win</h5><ul>${(B.weWin || []).slice(0, mid ? 4 : 2).map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>
          <div class="bc-sec lose"><h5>Where they attack</h5><ul>${(B.theyWin || []).map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>
        </div>
        ${tall ? `
        <div class="bc-sec"><h5>Landmines to plant</h5><ol class="bc-land">${(B.landmines || []).map((l, i) => `<li class="zap" data-l="${i}">${esc(l)}</li>`).join('')}</ol></div>
        <div class="bc-sec"><h5>Counters</h5><div class="bc-counters">${(B.counters || []).map((c, i) => `<button class="bc-c zap" data-c="${i}"><b>${esc(c.claim)}</b><span>${esc(c.counter)}</span></button>`).join('')}</div></div>` : ''}
      </div>`;
    el.querySelectorAll('[data-l]').forEach(n => n.onclick = () => {
      const l = B.landmines[Number(n.dataset.l)];
      emit({ desc: `clicked the landmine "${l}" on the Hyperion battlecard. Coach me on planting it.`, label: `Landmine · ${short(l)}`, icon: 'battlecard', route: { key: `land:${n.dataset.l}` } });
    });
    el.querySelectorAll('.bc-c').forEach(n => n.onclick = () => {
      n.classList.toggle('open');
      const c = B.counters[Number(n.dataset.c)];
      if (n.classList.contains('open')) emit({ desc: `clicked the counter for ${c.claim} on the Hyperion battlecard. Sharpen it for the current context.`, label: `Counter · ${short(c.claim)}`, icon: 'battlecard', route: { key: `counter:${n.dataset.c}` } });
    });
  };

  R.convo = (el) => {
    if (!LOGEL) { el.innerHTML = '<div class="pick"><div class="pick-cap">Conversation</div></div>'; return; }
    if (LOGEL.parentElement !== el) { el.innerHTML = ''; el.appendChild(LOGEL); }
    LOGEL.scrollTop = LOGEL.scrollHeight;
  };

  function render(id, bodyEl, app) {
    (R[id] || R.notes)(bodyEl, app);
  }

  return { REGISTRY, DEFAULTS: D, icon, render, configure };
});
