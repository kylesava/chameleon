/* Chameleon simulated CRM — the single source of truth for the demo.
   Served to the frontend via /api/crm and digested into the model prompt. */

const ACCOUNTS = [
  {
    id: 'northwind',
    name: 'Northwind Energy',
    industry: 'Utilities', region: 'Tri-State',
    arr: 2400, health: 'good',
    summary: '12-year flagship account. $2.4M ARR on hybrid cloud + watsonx. Renewal Sep 30 with an AI Ops expansion in play.',
    stakeholders: [
      { name: 'Marcus Hale', role: 'CEO', sentiment: 'neutral', tag: 'signs off above $2M', influence: 90, lastTouch: 'Jun 3 · QBR', bio: 'Operator-CEO obsessed with grid reliability after the 2023 storm season. Delegates tech, owns the narrative to the board.', talkingPoints: ['Tie everything to storm-season resilience', 'Board cares about outage minutes, not features', 'He green-lights fast when the CFO is covered'], watchouts: ['Only 20 minutes of attention — lead with the number'], connections: [{ name: 'Dana Whitfield', note: 'his CFO' }, { name: 'Priya Raman', note: 'his platform lead' }] },
      { name: 'Dana Whitfield', role: 'CFO', sentiment: 'neutral', tag: 'economic buyer', influence: 86, reportsTo: 'Marcus Hale', lastTouch: 'Jul 18 · pricing call', bio: 'Owns the $40M infrastructure budget. Data-driven, allergic to vendor fluff — wants uptime math and multi-year cost curves.', talkingPoints: ['Lead with 99.98% uptime over 24 months', 'Frame AI Ops as $8.2M avoided outages', 'Offer multi-year lock before discount talk'], watchouts: ['Rumored Q4 budget freeze', 'Hyperion pitched her CFO-to-CFO in June'], connections: [{ name: 'Sam Iqbal', note: 'her procurement lead' }] },
      { name: 'Priya Raman', role: 'VP Platform', sentiment: 'champion', tag: 'sponsored the watsonx pilot', influence: 82, reportsTo: 'Marcus Hale', lastTouch: 'Jul 22 · AI Ops workshop', bio: 'Under pressure to cut MTTR 40% this year. Sees AI Ops as her path to modernizing the NOC — and her promotion case.', talkingPoints: ['Reference Duke Energy 38% MTTR reduction', 'Give her the internal deck to sell upward', 'Early access to anomaly detection = catnip'], watchouts: ['Wary of vendor lock-in; emphasize open APIs'], connections: [{ name: 'Lena Cruz', note: 'her data director' }] },
      { name: 'Tom Okafor', role: 'CISO', sentiment: 'detractor', tag: 'blocking on security review', influence: 65, reportsTo: 'Marcus Hale', lastTouch: 'Jul 9 · tense review', bio: 'Burned by a vendor breach at his last company. Sits on every deal until SOC2, FedRAMP and pen-test docs are in hand.', talkingPoints: ['Bring the full compliance pack unprompted', 'Offer a private security workshop', 'His sign-off unlocks Dana'], watchouts: ['Do NOT go around him — he finds out'], connections: [{ name: 'Dana Whitfield', note: 'aligned on risk' }] },
      { name: 'Lena Cruz', role: 'Director of Data', sentiment: 'champion', tag: 'day-to-day power user', influence: 55, reportsTo: 'Priya Raman', lastTouch: 'Jul 25 · office hours', bio: 'Runs the data platform team. Loves the product, hates the current dashboarding gaps — vocal in internal Slack.', talkingPoints: ['Fix her dashboard asks in the renewal', 'She feeds Priya ammunition weekly'], watchouts: ['If she goes quiet, something is wrong'], connections: [{ name: 'Priya Raman', note: 'her VP' }] },
      { name: 'Sam Iqbal', role: 'Procurement', sentiment: 'neutral', tag: 'needs 3 weeks lead time', influence: 40, reportsTo: 'Dana Whitfield', lastTouch: 'Jul 2 · terms email', bio: 'Process-first. Redlines everything twice but moves fast once Dana signals. Sep 30 means paper by Sep 8.', talkingPoints: ['Send draft paper early, not at the end', 'He rewards clean, standard terms'], watchouts: ['Hates surprise line items'], connections: [{ name: 'Dana Whitfield', note: 'his exec' }] },
    ],
    opps: [
      { id: 'nw-renewal', name: 'Q3 Platform Renewal', stage: 'Negotiate', value: 2400, close: 'Sep 30', health: 'good', next: 'Exec briefing Aug 12', summary: 'Flat renewal of the hybrid cloud + watsonx base. Hyperion sniffing around the data lake.', discount: 12, term: 36, lines: [
        { sku: 'HC-VPC', desc: 'Hybrid Cloud Core', unit: 'VPCs', qty: 280, min: 120, max: 600, step: 20, price: 95, type: 'sub' },
        { sku: 'WX-CAP', desc: 'watsonx.ai capacity', unit: 'RUs', qty: 40, min: 10, max: 120, step: 5, price: 260, type: 'sub' },
        { sku: 'DFAB-TB', desc: 'Data Fabric throughput', unit: 'TB/mo', qty: 60, min: 20, max: 200, step: 10, price: 210, type: 'sub' },
        { sku: 'SVC-TAM', desc: 'Dedicated success team', unit: 'engagement', qty: 1, min: 1, max: 1, step: 1, price: 90000, type: 'svc' },
      ] },
      { id: 'nw-aiops', name: 'AI Ops Expansion', stage: 'Propose', value: 940, close: 'Oct 15', health: 'warn', next: 'Security workshop w/ Tom Okafor', summary: 'Grid-failure prediction pilot → production. Blocked on CISO review; Priya is pushing internally.', discount: 8, term: 24, lines: [
        { sku: 'AIOPS-EP', desc: 'Grid-failure prediction', unit: 'endpoints', qty: 1200, min: 400, max: 4000, step: 100, price: 9.5, type: 'sub' },
        { sku: 'EDGE-GW', desc: 'Edge inference gateways', unit: 'substations', qty: 45, min: 10, max: 120, step: 5, price: 240, type: 'sub' },
        { sku: 'SVC-DEP', desc: 'Deployment & model tuning', unit: 'engagement', qty: 1, min: 1, max: 1, step: 1, price: 140000, type: 'svc' },
      ] },
    ],
    plan: {
      objectives: [{ text: 'Renew $2.4M base before Sep 30', done: false }, { text: 'Land AI Ops expansion (+$940K)', done: false }, { text: 'Clear Tom Okafor security review', done: false }, { text: 'Exec sponsor mapped to our GM', done: true }],
      risks: ['CISO security review pending', 'Hyperion undercutting on storage', 'Q4 budget freeze rumored'],
      nextSteps: ['Exec briefing Aug 12', 'Security workshop w/ Tom Okafor', 'Draft multi-year pricing', 'Reference call: Meridian Utilities'],
    },
    notes: ['Dana prefers Tuesday mornings', 'Paper must reach Sam Iqbal by Sep 8', 'Tom O. wants SOC2 + FedRAMP docs', 'Mention Meridian reference win'],
    health_score: 82,
    activity: [4, 6, 5, 8, 7, 9],
    touches: [
      { d: 'Jul 22', type: 'meeting', who: 'Priya Raman', note: 'AI Ops workshop — MTTR targets agreed', s: 'good' },
      { d: 'Jul 18', type: 'call', who: 'Dana Whitfield', note: 'Pricing call — pressed hard on multi-year cost curve', s: 'warn' },
      { d: 'Jul 9', type: 'meeting', who: 'Tom Okafor', note: 'Security review — tense; SOC2 + FedRAMP docs requested', s: 'risk' },
      { d: 'Jul 2', type: 'email', who: 'Sam Iqbal', note: 'Terms draft acknowledged, redlines by mid-Aug', s: 'good' },
    ],
    meetings: [{
      when: 'Tue Aug 12 · 9:00', title: 'Exec briefing', with: ['Marcus Hale', 'Dana Whitfield', 'Priya Raman'],
      goal: 'Lock the Sep 30 signature path and get AI Ops green-lit',
      agenda: ['Value recap — 99.98% uptime, 24 months', 'AI Ops: the $8.2M avoided-outage math', 'Multi-year pricing frame (hold 12%)'],
      intel: ['Dana wants cost curves, not vision', 'Marcus gives you 20 minutes, not 30'],
    }],
    review: {
      when: 'Jul 22 · 45 min', title: 'AI Ops workshop', with: ['Priya Raman', 'Lena Cruz'], score: 78,
      wins: ['MTTR targets agreed in writing', 'Priya volunteered to sponsor the exec briefing'],
      concerns: ['Tom Okafor absent — security still unowned', 'No budget holder in the room'],
      commitments: [
        { who: 'You', what: 'Send MTTR benchmark pack', by: 'Fri' },
        { who: 'Priya', what: 'Get Tom into the security workshop', by: 'Aug 5' },
      ],
    },
    strategy: {
      goals: [
        { id: 'g1', t: 'Zero major outages through storm season' },
        { id: 'g2', t: 'Cut O&M cost 15% by FY26' },
        { id: 'g3', t: 'Board-visible AI modernization story' },
      ],
      inits: [
        { id: 'i1', t: 'Grid-failure prediction program', goals: ['g1', 'g3'], opps: ['nw-aiops'] },
        { id: 'i2', t: 'Hybrid cloud consolidation', goals: ['g2'], opps: ['nw-renewal'] },
        { id: 'i3', t: 'NOC modernization (Priya)', goals: ['g1', 'g2'], opps: ['nw-aiops', 'nw-renewal'] },
      ],
    },
  },
  {
    id: 'meridian',
    name: 'Meridian Utilities',
    industry: 'Utilities', region: 'New England',
    arr: 640, health: 'good',
    summary: 'Happy 3-year customer and our best reference. COO is championing a full hybrid-cloud migration.',
    stakeholders: [
      { name: 'Elena Vasquez', role: 'COO', sentiment: 'champion', tag: 'exec sponsor, loves us', influence: 88, lastTouch: 'Jul 20 · migration planning', bio: 'Drove the original deal. Wants Meridian to be the "most boring, most reliable" utility in New England — and credits us publicly.', talkingPoints: ['She will speak at our user conference if asked', 'Wants a 3-year roadmap commitment', 'Introduce her to Northwind for peer selling'], watchouts: ['Do not oversell — she values candor above all'], connections: [{ name: 'Rob Chen', note: 'her infra VP' }] },
      { name: 'Rob Chen', role: 'VP Infrastructure', sentiment: 'champion', tag: 'technical champion', influence: 72, reportsTo: 'Elena Vasquez', lastTouch: 'Jul 28 · architecture review', bio: 'Hands-on architect running the migration himself. Active in our community forum; files the best bug reports we get.', talkingPoints: ['Give him beta access, he does the selling', 'His migration runbook could be a case study'], watchouts: ['Stretched thin — offer services help'], connections: [{ name: 'Ingrid Hall', note: 'his security lead' }] },
      { name: 'Marcus Webb', role: 'CFO', sentiment: 'neutral', tag: 'watches every dollar', influence: 70, lastTouch: 'Jun 12 · budget review', bio: 'Small-utility CFO discipline: everything is a payback-period conversation. Trusts Elena but verifies the math.', talkingPoints: ['Show migration TCO vs. their aging DCs', 'Quarterly payment terms win him over'], watchouts: ['Sticker-shock risk on the full migration'], connections: [{ name: 'Elena Vasquez', note: 'peer exec' }] },
      { name: 'Ingrid Hall', role: 'Security Lead', sentiment: 'neutral', tag: 'thorough but fair', influence: 45, reportsTo: 'Rob Chen', lastTouch: 'Jul 15 · controls review', bio: 'Methodical reviewer, no drama. Wants shared-responsibility clarity in writing before cutover.', talkingPoints: ['Send the controls matrix early', 'She and Tom Okafor know each other'], watchouts: ['Slow email responder — call her'], connections: [{ name: 'Rob Chen', note: 'her VP' }] },
    ],
    opps: [
      { id: 'mer-hybrid', name: 'Hybrid Cloud Migration', stage: 'Validate', value: 640, close: 'Nov 8', health: 'good', next: 'Architecture review sign-off', summary: 'Full DC-to-hybrid migration. Rob is validating architecture now; Elena wants it done before winter storm season.', discount: 10, term: 36, lines: [
        { sku: 'HC-VPC', desc: 'Hybrid Cloud Core', unit: 'VPCs', qty: 110, min: 60, max: 300, step: 10, price: 92, type: 'sub' },
        { sku: 'SVC-MIG', desc: 'DC exit & migration', unit: 'engagement', qty: 1, min: 1, max: 1, step: 1, price: 160000, type: 'svc' },
      ] },
      { id: 'mer-support', name: 'Premium Support Upgrade', stage: 'Qualify', value: 120, health: 'good', close: 'Dec 5', next: 'Support gap analysis', summary: 'Upgrade from standard to premium support post-migration. Easy attach if migration lands.', discount: 5, term: 12, lines: [
        { sku: 'SUP-NODE', desc: 'Premium coverage', unit: 'nodes', qty: 200, min: 80, max: 500, step: 20, price: 48, type: 'sub' },
      ] },
    ],
    plan: {
      objectives: [{ text: 'Close migration before storm season', done: false }, { text: 'Turn Elena into a public reference', done: true }, { text: 'Attach premium support (+$120K)', done: false }],
      risks: ['Rob stretched thin — timeline slip', 'CFO sticker shock on full TCO'],
      nextSteps: ['Architecture sign-off w/ Rob', 'TCO model for Marcus Webb', 'Book Elena for user conference'],
    },
    notes: ['Elena agreed to reference call for Northwind', 'Rob wants beta access to AI Ops', 'Quarterly billing preferred by CFO'],
    health_score: 88,
    activity: [3, 4, 4, 5, 6, 5],
    touches: [
      { d: 'Jul 28', type: 'meeting', who: 'Rob Chen', note: 'Architecture review — two open questions on failover', s: 'good' },
      { d: 'Jul 20', type: 'call', who: 'Elena Vasquez', note: 'Migration planning — wants done before storm season', s: 'good' },
      { d: 'Jul 15', type: 'email', who: 'Ingrid Hall', note: 'Controls matrix sent; awaiting review', s: 'warn' },
    ],
    meetings: [{
      when: 'Thu Aug 7 · 14:00', title: 'Architecture sign-off', with: ['Rob Chen', 'Ingrid Hall'],
      goal: 'Close the two failover questions and get written sign-off',
      agenda: ['Failover design answers', 'Cutover runbook walkthrough', 'Shared-responsibility doc for Ingrid'],
      intel: ['Rob is stretched — offer services help', 'Ingrid responds better live than on email'],
    }],
    review: {
      when: 'Jul 28 · 30 min', title: 'Architecture review', with: ['Rob Chen'], score: 84,
      wins: ['Failover design accepted', 'Cutover window agreed for October'],
      concerns: ['Two open failover questions still unanswered', 'Ingrid hasn\u2019t seen the controls matrix'],
      commitments: [
        { who: 'You', what: 'Answer failover Q1/Q2 in writing', by: 'Wed' },
        { who: 'Rob', what: 'Walk Ingrid through controls matrix', by: 'Aug 8' },
      ],
    },
    strategy: {
      goals: [
        { id: 'g1', t: 'Most reliable utility in New England' },
        { id: 'g2', t: 'Exit both data centers by 2027' },
      ],
      inits: [
        { id: 'i1', t: 'DC-to-hybrid migration (Rob)', goals: ['g1', 'g2'], opps: ['mer-hybrid'] },
        { id: 'i2', t: '24/7 ops hardening', goals: ['g1'], opps: ['mer-support'] },
      ],
    },
  },
  {
    id: 'ironpeak',
    name: 'Ironpeak Grid',
    industry: 'Utilities', region: 'Great Lakes',
    arr: 1100, health: 'warn',
    summary: '$1.1M account under active attack by Hyperion. Mainframe refresh is our beachhead — VP Ops wants us out.',
    stakeholders: [
      { name: 'Walt Brennan', role: 'CIO', sentiment: 'neutral', tag: 'decision maker, on the fence', influence: 85, lastTouch: 'Jul 11 · strategy lunch', bio: 'Old-school CIO nearing retirement, wants one last clean modernization on his record. Loyal to whoever de-risks it.', talkingPoints: ['Sell certainty: fixed-fee, reference-backed', 'His legacy = the mainframe refresh story', 'Golf: he plays Thursdays'], watchouts: ['Sofia Marino has his ear on cost'], connections: [{ name: 'Dev Kapoor', note: 'his chief architect' }, { name: 'Sofia Marino', note: 'peer, rival view' }] },
      { name: 'Sofia Marino', role: 'VP Operations', sentiment: 'detractor', tag: 'pushing Hyperion', influence: 78, lastTouch: 'Jun 28 · cost review', bio: 'Ran ops at a Hyperion shop before joining. Believes we are 20% overpriced and says so in every steering meeting.', talkingPoints: ['Never argue price with her — argue risk', 'Bring the Meridian uptime data', 'Win Dev first; she respects him'], watchouts: ['She screenshots pricing slides for Hyperion', 'Avoid one-on-ones without an ally present'], connections: [{ name: 'Walt Brennan', note: 'lobbies him weekly' }] },
      { name: 'Dev Kapoor', role: 'Chief Architect', sentiment: 'champion', tag: 'our inside voice', influence: 60, reportsTo: 'Walt Brennan', lastTouch: 'Jul 24 · design session', bio: 'Wrote the internal architecture memo recommending us. Quietly counters Sofia with benchmarks.', talkingPoints: ['Feed him benchmark data weekly', 'Co-author the migration design doc', 'He wants a speaking slot at our summit'], watchouts: ['Junior to Sofia politically — protect him'], connections: [{ name: 'Walt Brennan', note: 'his CIO' }] },
      { name: 'Nancy Ito', role: 'Procurement Director', sentiment: 'neutral', tag: 'runs a strict RFP', influence: 50, lastTouch: 'Jul 5 · RFP timeline', bio: 'By-the-book procurement. Running a formal RFP for the refresh — Hyperion and us are finalists.', talkingPoints: ['Answer the RFP exactly as structured', 'Ask about evaluation weighting early'], watchouts: ['Any process foul disqualifies us'], connections: [{ name: 'Walt Brennan', note: 'reports process to him' }] },
    ],
    opps: [
      { id: 'iron-mainframe', name: 'Mainframe Refresh', stage: 'Propose', value: 1200, close: 'Dec 20', health: 'risk', next: 'RFP response due Aug 22', summary: 'Competitive RFP vs Hyperion. Dev is our champion; Sofia is theirs. Walt decides.', discount: 15, term: 36, lines: [
        { sku: 'Z-MIPS', desc: 'zSeries modernization', unit: 'MIPS', qty: 900, min: 300, max: 2400, step: 50, price: 26, type: 'sub' },
        { sku: 'SVC-RPL', desc: 'Replatform program', unit: 'engagement', qty: 1, min: 1, max: 1, step: 1, price: 260000, type: 'svc' },
      ] },
      { id: 'iron-dr', name: 'DR Modernization', stage: 'Qualify', value: 380, close: 'Jan 30', health: 'warn', next: 'DR gap assessment', summary: 'Disaster-recovery uplift. Only viable if we win the refresh.', discount: 10, term: 24, lines: [
        { sku: 'DR-VM', desc: 'DR orchestration', unit: 'protected VMs', qty: 500, min: 100, max: 1500, step: 50, price: 18, type: 'sub' },
        { sku: 'SVC-DR', desc: 'Runbook build-out', unit: 'engagement', qty: 1, min: 1, max: 1, step: 1, price: 90000, type: 'svc' },
      ] },
    ],
    plan: {
      objectives: [{ text: 'Win the mainframe RFP vs Hyperion', done: false }, { text: 'Neutralize Sofia with risk narrative', done: false }, { text: 'Arm Dev Kapoor with benchmarks', done: true }],
      risks: ['Sofia actively championing Hyperion', 'RFP scoring weights cost 40%', 'Walt retires mid-2027 — urgency'],
      nextSteps: ['RFP response by Aug 22', 'Meridian uptime proof pack for Walt', 'Benchmark refresh for Dev', 'Thursday golf with Walt'],
    },
    notes: ['RFP due Aug 22 — hard deadline', 'Sofia screenshots our pricing slides', 'Dev wants a summit speaking slot', 'Walt plays golf Thursdays'],
    health_score: 61,
    activity: [2, 3, 5, 6, 8, 9],
    touches: [
      { d: 'Jul 24', type: 'meeting', who: 'Dev Kapoor', note: 'Design session — fed him fresh benchmarks', s: 'good' },
      { d: 'Jul 11', type: 'meeting', who: 'Walt Brennan', note: 'Strategy lunch — he asked about fixed-fee guarantees', s: 'good' },
      { d: 'Jul 5', type: 'call', who: 'Nancy Ito', note: 'RFP timeline confirmed — Aug 22 hard deadline', s: 'warn' },
      { d: 'Jun 28', type: 'meeting', who: 'Sofia Marino', note: 'Cost review — she quoted Hyperion pricing at us', s: 'risk' },
    ],
    meetings: [{
      when: 'Wed Aug 6 · 11:00', title: 'RFP scoring review', with: ['Nancy Ito', 'Walt Brennan'],
      goal: 'Understand scoring weights and position fixed-fee as the risk answer',
      agenda: ['Clarify evaluation weighting', 'Fixed-fee vs overrun-risk framing', 'Reference pack: Meridian uptime'],
      intel: ['Sofia will not attend — speak freely', 'Nancy rewards process discipline'],
    }],
    review: {
      when: 'Jul 24 · 60 min', title: 'Design session', with: ['Dev Kapoor'], score: 71,
      wins: ['Dev aligned on architecture', 'Fresh benchmarks landed well'],
      concerns: ['Sofia circulating Hyperion pricing after the meeting', 'RFP weights still favour cost 40%'],
      commitments: [
        { who: 'You', what: 'Fixed-fee risk framing for the RFP response', by: 'Aug 15' },
        { who: 'Dev', what: 'Socialize benchmarks with Walt', by: 'Thu golf' },
      ],
    },
    strategy: {
      goals: [
        { id: 'g1', t: 'Retire legacy mainframe risk before Walt exits' },
        { id: 'g2', t: 'Sub-4hr disaster recovery guarantee' },
        { id: 'g3', t: '20% IT cost takeout (Sofia\u2019s mandate)' },
      ],
      inits: [
        { id: 'i1', t: 'Core modernization RFP', goals: ['g1', 'g3'], opps: ['iron-mainframe'] },
        { id: 'i2', t: 'Resilience uplift program', goals: ['g2'], opps: ['iron-dr'] },
      ],
    },
  },
  {
    id: 'coastal',
    name: 'Coastal Gas',
    industry: 'Oil & Gas', region: 'Mid-Atlantic',
    arr: 320, health: 'warn',
    summary: 'Small but strategic O&G logo. Data fabric deal stalled — CFO questions everything, data lead loves us.',
    stakeholders: [
      { name: 'Hank Voss', role: 'VP Engineering', sentiment: 'neutral', tag: 'pragmatic gatekeeper', influence: 75, lastTouch: 'Jul 8 · pipeline data demo', bio: 'Field-engineering lifer. Skeptical of "platforms" but desperate to unify sensor data from 400 well sites.', talkingPoints: ['Talk sensors and SCADA, not platforms', 'Site-visit demo beats any slide deck', 'He decides if Pete stays out of the way'], watchouts: ['Tunes out at the first buzzword'], connections: [{ name: 'Amara Diallo', note: 'his data lead' }] },
      { name: 'Amara Diallo', role: 'Head of Data', sentiment: 'champion', tag: 'built the business case', influence: 62, reportsTo: 'Hank Voss', lastTouch: 'Jul 26 · working session', bio: 'Built the data-fabric business case herself: $1.8M/yr in methane-leak detection savings. Needs help selling it up.', talkingPoints: ['Polish her ROI model with her', 'Methane compliance angle wins the CFO', 'She presents to the board Sep 4'], watchouts: ['If we go over her head she loses face'], connections: [{ name: 'Hank Voss', note: 'her VP' }, { name: 'Pete Rourke', note: 'her skeptic' }] },
      { name: 'Pete Rourke', role: 'CFO', sentiment: 'detractor', tag: 'thinks cloud is a fad', influence: 80, lastTouch: 'Jun 20 · budget pushback', bio: 'Commodity-cycle scarred. Cut IT spend three times in a decade and proud of it. Calls SaaS "renting other people\'s computers".', talkingPoints: ['Only ROI in months, never vision', 'Methane fines = the number that moves him', 'Let Amara carry the pitch — he distrusts vendors'], watchouts: ['One bad meeting and the deal dies', 'Never mention multi-year up front'], connections: [{ name: 'Hank Voss', note: 'grudging respect' }] },
    ],
    opps: [
      { id: 'coast-fabric', name: 'Data Fabric Rollout', stage: 'Qualify', value: 320, close: 'Nov 22', health: 'risk', next: 'Board presentation Sep 4 (Amara)', summary: 'Unify 400 well sites\' sensor data. Amara\'s board pitch Sep 4 is make-or-break; Pete is hostile.', discount: 5, term: 24, lines: [
        { sku: 'DFAB-TB', desc: 'Data Fabric throughput', unit: 'TB/mo', qty: 25, min: 10, max: 100, step: 5, price: 200, type: 'sub' },
        { sku: 'IOT-SITE', desc: 'Well-site connectors', unit: 'sites', qty: 400, min: 100, max: 800, step: 25, price: 6, type: 'sub' },
        { sku: 'SVC-QS', desc: 'QuickStart', unit: 'engagement', qty: 1, min: 1, max: 1, step: 1, price: 40000, type: 'svc' },
      ] },
    ],
    plan: {
      objectives: [{ text: 'Get Amara\'s board pitch approved Sep 4', done: false }, { text: 'Neutralize Pete with methane-fine ROI', done: false }, { text: 'Site demo for Hank at a well pad', done: false }],
      risks: ['Pete can veto unilaterally', 'Commodity prices dip = instant freeze'],
      nextSteps: ['Rehearse board deck with Amara', 'Methane compliance one-pager for Pete', 'Schedule well-pad demo for Hank'],
    },
    notes: ['Amara presents to the board Sep 4', 'Pete calls SaaS "renting computers" — avoid the word', 'Hank wants a live well-pad demo'],
    health_score: 55,
    activity: [1, 2, 2, 3, 4, 3],
    touches: [
      { d: 'Jul 26', type: 'meeting', who: 'Amara Diallo', note: 'Board-deck working session — ROI model at $1.8M/yr', s: 'good' },
      { d: 'Jul 8', type: 'meeting', who: 'Hank Voss', note: 'Pipeline data demo — wants it at a live well pad', s: 'warn' },
      { d: 'Jun 20', type: 'call', who: 'Pete Rourke', note: 'Budget pushback — called cloud "a fad" again', s: 'risk' },
    ],
    meetings: [{
      when: 'Fri Aug 8 · 10:00', title: 'Board-pitch rehearsal', with: ['Amara Diallo'],
      goal: 'Get Amara bulletproof for the Sep 4 board pitch',
      agenda: ['Run the deck twice, time it', 'Pete-proof the ROI slide', 'Methane-fine exposure one-pager'],
      intel: ['Her credibility is on the line — she leads, you support', 'Keep vendor logos off her slides'],
    }],
    review: {
      when: 'Jul 26 · 40 min', title: 'Board-deck working session', with: ['Amara Diallo'], score: 66,
      wins: ['ROI model locked at $1.8M/yr', 'Amara confident on the narrative'],
      concerns: ['Pete will attend the board pitch', 'No live demo booked for Hank yet'],
      commitments: [
        { who: 'You', what: 'Methane-fine one-pager, Pete-proof', by: 'Aug 20' },
        { who: 'Amara', what: 'Slot a well-pad demo with Hank', by: 'Aug 25' },
      ],
    },
    strategy: {
      goals: [
        { id: 'g1', t: 'Zero reportable methane incidents' },
        { id: 'g2', t: 'Unify 400 well sites\u2019 sensor data' },
      ],
      inits: [
        { id: 'i1', t: 'Leak-detection analytics (Amara)', goals: ['g1', 'g2'], opps: ['coast-fabric'] },
      ],
    },
  },
  {
    id: 'ravenna',
    name: 'Ravenna Power',
    industry: 'Renewables', region: 'Tri-State',
    arr: 0, health: 'good',
    summary: 'New-logo prospect. Fast-growing solar+storage operator; CTO found us at a conference. Small pilot, big upside.',
    stakeholders: [
      { name: 'Grace Lin', role: 'CTO', sentiment: 'champion', tag: 'inbound — she found us', influence: 92, lastTouch: 'Jul 29 · pilot scoping', bio: 'Ex-Tesla energy software lead. Moves at startup speed, hates enterprise sales theater, writes code on weekends.', talkingPoints: ['Ship the pilot fast — speed IS the pitch', 'Skip the deck; live demo only', 'She will 10x the account if the pilot lands'], watchouts: ['One slow legal cycle and she ghosts', 'Do not send an MSA before the pilot works'], connections: [{ name: 'Omar Haddad', note: 'her ops lead' }] },
      { name: 'Omar Haddad', role: 'Head of Grid Ops', sentiment: 'neutral', tag: 'will run the pilot', influence: 58, reportsTo: 'Grace Lin', lastTouch: 'Jul 29 · scoping call', bio: 'Runs a lean 6-person ops team across 40 solar farms. Cares about one thing: fewer 3am pages.', talkingPoints: ['Quantify alert-noise reduction', 'His team does the eval — train them well'], watchouts: ['No bandwidth for a heavy onboarding'], connections: [{ name: 'Grace Lin', note: 'his CTO' }] },
      { name: 'June Park', role: 'Finance Director', sentiment: 'neutral', tag: 'startup budget discipline', influence: 48, lastTouch: 'Jul 21 · intro email', bio: 'Series-C finance. Fine with spend that shows a growth story; allergic to multi-year commitments pre-proof.', talkingPoints: ['Monthly pilot pricing, expansion later', 'Show the fleet-analytics upside math'], watchouts: ['Board meets quarterly — time asks well'], connections: [{ name: 'Grace Lin', note: 'exec peer' }] },
    ],
    opps: [
      { id: 'rav-pilot', name: 'Grid AI Pilot', stage: 'Qualify', value: 180, close: 'Oct 30', health: 'good', next: 'Pilot success criteria doc', summary: '90-day AI ops pilot across 5 solar farms. Grace wants results before her January board meeting.', discount: 0, term: 3, lines: [
        { sku: 'AIOPS-EP', desc: 'AI ops pilot fleet', unit: 'endpoints', qty: 200, min: 100, max: 600, step: 25, price: 9.5, type: 'sub' },
        { sku: 'SVC-ONB', desc: 'Lightweight onboarding', unit: 'engagement', qty: 1, min: 1, max: 1, step: 1, price: 45000, type: 'svc' },
      ] },
      { id: 'rav-scale', name: 'Fleet Analytics Expansion', stage: 'Prospect', value: 450, close: 'Feb 15', health: 'good', next: 'Pilot must land first', summary: 'Full 40-farm rollout + fleet analytics if the pilot proves out. Grace has budget pre-socialized.', discount: 0, term: 24, lines: [
        { sku: 'AIOPS-EP', desc: 'Fleet AI ops', unit: 'endpoints', qty: 1400, min: 600, max: 4000, step: 100, price: 8.5, type: 'sub' },
        { sku: 'ANL-AST', desc: 'Fleet analytics', unit: 'farms', qty: 40, min: 10, max: 80, step: 5, price: 180, type: 'sub' },
      ] },
    ],
    plan: {
      objectives: [{ text: 'Sign pilot before Oct 30', done: false }, { text: 'Define success criteria with Omar', done: false }, { text: 'Map expansion to January board mtg', done: false }],
      risks: ['Legal cycle slower than Grace\'s patience', 'Omar\'s team has zero spare bandwidth'],
      nextSteps: ['Success criteria doc to Omar', 'Pilot-friendly paper to legal NOW', 'Live demo, no slides, for Grace'],
    },
    notes: ['Grace: live demos only, no decks', 'Pilot paper must be < 6 pages', 'January board mtg = expansion window'],
    health_score: 74,
    activity: [0, 1, 2, 3, 5, 6],
    touches: [
      { d: 'Jul 29', type: 'call', who: 'Grace Lin', note: 'Pilot scoping — she wants signatures inside 30 days', s: 'good' },
      { d: 'Jul 29', type: 'call', who: 'Omar Haddad', note: 'Success criteria draft — alert-noise cut is the metric', s: 'good' },
      { d: 'Jul 21', type: 'email', who: 'June Park', note: 'Intro — asked about monthly pilot pricing', s: 'warn' },
    ],
    meetings: [{
      when: 'Mon Aug 4 · 16:00', title: 'Pilot kickoff scoping', with: ['Grace Lin', 'Omar Haddad'],
      goal: 'Agree success criteria and a 90-day timeline Grace can take to her board',
      agenda: ['Success metrics: alert noise -40%', 'Onboarding plan (zero lift for Omar)', 'Paper: 6-page pilot agreement'],
      intel: ['Live demo only — no slides in the room', 'Grace decides fast; do not slow-walk'],
    }],
    review: {
      when: 'Jul 29 · 25 min', title: 'Pilot scoping call', with: ['Grace Lin', 'Omar Haddad'], score: 88,
      wins: ['Success metric agreed: alert noise −40%', 'Grace wants signatures inside 30 days'],
      concerns: ['Legal cycle could outpace her patience'],
      commitments: [
        { who: 'You', what: '6-page pilot paper to legal', by: 'Mon' },
        { who: 'Omar', what: 'Endpoint list for 5 farms', by: 'Wed' },
      ],
    },
    strategy: {
      goals: [
        { id: 'g1', t: '99% fleet availability at 40 farms' },
        { id: 'g2', t: 'Ops headcount flat while fleet 2x' },
        { id: 'g3', t: 'Series-D story: AI-native operator' },
      ],
      inits: [
        { id: 'i1', t: 'AI ops pilot — 5 farms (Omar)', goals: ['g1', 'g2'], opps: ['rav-pilot'] },
        { id: 'i2', t: 'Fleet analytics platform', goals: ['g2', 'g3'], opps: ['rav-scale'] },
      ],
    },
  },
];

const STAGES = ['Prospect', 'Qualify', 'Validate', 'Propose', 'Negotiate'];

const pipelineTotal = ACCOUNTS.reduce((s, a) => s + a.opps.reduce((x, o) => x + o.value, 0), 0);

const METRICS = {
  kpis: [
    { label: 'Pipeline', value: `$${(pipelineTotal / 1000).toFixed(1)}M`, delta: '+18%', spark: [3.9, 4.4, 4.2, 5.1, 5.8, 6.1, pipelineTotal / 1000] },
    { label: 'Quota Att.', value: '84%', delta: '+6 pts', spark: [61, 66, 70, 74, 79, 81, 84] },
    { label: 'Win Rate', value: '31%', delta: '+4%', spark: [22, 25, 24, 27, 29, 28, 31] },
    { label: 'Avg. Cycle', value: '94 d', delta: '-11 d', spark: [120, 116, 110, 108, 101, 98, 94] },
  ],
};

const GLOBAL_NOTES = ['RFP for Ironpeak due Aug 22', 'Northwind paper to Sam Iqbal by Sep 8', 'Coastal board pitch Sep 4 — rehearse w/ Amara', 'Book Elena Vasquez for user conference'];

const BATTLE = {
  competitor: 'Hyperion Cloud',
  tagline: 'Aggressive on price, thin on grid-scale proof.',
  weWin: [
    '99.98% uptime across 24 months at Northwind — they can\u2019t produce an equivalent',
    'Only platform running AI ops on live grid data (Duke: 38% MTTR reduction)',
    'Meridian reference: migration delivered 3 weeks early',
    'Fixed-fee modernization — zero overrun risk for RFP scoring',
  ],
  theyWin: [
    '15-20% cheaper list on storage — they lead every deal with it',
    'Incumbent on Ironpeak\u2019s data lake (Sofia\u2019s old shop)',
    'Faster procurement paper for small pilots',
  ],
  landmines: [
    'Ask them for a utility reference with 12+ months of AI ops in production',
    'Ask how storage pricing changes at contract year 2 (their step-ups are brutal)',
    'Ask who carries overrun risk on fixed-scope migrations',
  ],
  counters: [
    { claim: '“We\u2019re 20% cheaper.”', counter: 'On list, year one. Model year-2 step-ups + overrun risk and we\u2019re 8% cheaper over 3 years — walk the TCO with Dana/Marcus Webb.' },
    { claim: '“We already run your data lake.”', counter: 'Data gravity isn\u2019t a roadmap. Their lake has no grid AI layer — demo grid prediction on their own data.' },
    { claim: '“Their platform is legacy.”', counter: 'Point at Ravenna: a 2024-born solar operator chose us over Hyperion for speed.' },
  ],
  presence: {
    northwind: { status: 'circling', note: 'CFO-to-CFO pitch to Dana in June; sniffing the data lake.' },
    meridian: { status: 'none', note: 'No footprint. Keep it that way — lock the 3-year roadmap.' },
    ironpeak: { status: 'entrenched', note: 'Incumbent data lake + Sofia advocating. Head-to-head RFP.' },
    coastal: { status: 'none', note: 'Pete would love their pricing — don\u2019t give him a reason to look.' },
    ravenna: { status: 'lost', note: 'They pitched Grace and lost on speed. She\u2019ll tell the story if asked.' },
  },
};

/* Compact digest for the model prompt */
function digest() {
  return ACCOUNTS.map(a => {
    const people = a.stakeholders.map(s => `${s.name} (${s.role}, ${s.sentiment}${s.tag ? ' — ' + s.tag : ''})`).join('; ');
    const opps = a.opps.map(o => `${o.id} "${o.name}" — ${o.stage}, $${o.value}K, close ${o.close}, health ${o.health}, next: ${o.next}`).join('\n    ');
    return `• ${a.id} — ${a.name} | ${a.industry} · ${a.region} | ARR $${(a.arr / 1000).toFixed(1)}M | health ${a.health}\n  ${a.summary}\n  people: ${people}\n  opps:\n    ${opps}`;
  }).join('\n');
}

module.exports = { ACCOUNTS, STAGES, METRICS, GLOBAL_NOTES, BATTLE, pipelineTotal, digest };
