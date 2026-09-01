/* Chameleon route precomputer — enumerates the demo's interaction space from the
   CRM at boot and materializes instant {reply, actions} responses for each route.
   Structured UI events carry a route key; free text goes through an intent matcher.
   Anything generative (decks, podcasts, bullets…) falls through to the LLM stream. */

function build(CRM) {
  const T = new Map(); // key -> (params) => { reply, actions }
  const A = CRM.ACCOUNTS;
  const fmtM = k => k >= 1000 ? `$${(k / 1000).toFixed(1)}M` : `$${k}K`;
  const add = (key, fn) => T.set(key, fn);
  const ctx = (a, o) => ({ type: 'context', account: a || 'none', opportunity: o || 'none' });
  const open = (app, size, extra) => ({ type: 'open', app, size, ...extra });

  const healthWord = h => h === 'good' ? 'healthy' : h === 'warn' ? 'wobbling' : 'at risk';

  /* ---------------- per account ---------------- */
  for (const a of A) {
    const opps = a.opps.map(o => `${o.name} (${fmtM(o.value)}, ${o.stage})`).join(' and ');
    const champion = a.stakeholders.find(s => s.sentiment === 'champion');
    const threat = a.stakeholders.find(s => s.sentiment === 'detractor');

    // full prep (also the "prep me for X" text intent)
    add(`prep:${a.id}`, () => ({
      reply: `${a.name}: ${a.summary} ${threat ? `Watch ${threat.name} — ${threat.tag}.` : champion ? `${champion.name} is your champion — ${champion.tag}.` : ''}`.trim(),
      actions: [ctx(a.id), open('relationships', 'l', { focus: true }), open('accountplan', 'm'), open('notes', 's')],
    }));

    // context pill switch
    add(`acctswitch:${a.id}`, () => ({
      reply: `${a.name} — ${a.arr ? fmtM(a.arr) + ' ARR' : 'new logo'}, ${a.opps.length} open: ${opps}. ${a.plan.risks[0] ? 'Top risk: ' + a.plan.risks[0].toLowerCase() + '.' : ''}`,
      actions: [],
    }));

    // territory membrane zoom (account grouping)
    add(`groupzoom:account:${a.name}`, () => ({
      reply: `${a.name} is carrying ${opps}. ${a.plan.nextSteps[0] ? 'Nearest move: ' + a.plan.nextSteps[0].toLowerCase() + '.' : ''}`,
      actions: [ctx(a.id), open('accountplan', 'm')],
    }));

    // pickers
    for (const tool of ['relationships', 'accountplan', 'oppmap', 'callprep', 'callreview']) {
      add(`pick:${tool}:${a.id}`, () => ({
        reply: `${a.name} loaded. ${a.summary.split('.')[0]}.`,
        actions: [],
      }));
    }

    // plan items
    a.plan.objectives.forEach((o, i) => add(`obj:${a.id}:${i}`, () => {
      const person = a.stakeholders.find(s => o.text.includes(s.name.split(' ')[0]) || o.text.includes(s.name));
      return {
        reply: `“${o.text}” — ${o.done ? 'already banked.' : `the fastest path runs through ${person ? person.name : champion ? champion.name : 'your champion'}. ${a.plan.nextSteps[i] ? 'Pair it with: ' + a.plan.nextSteps[i].toLowerCase() + '.' : ''}`}`,
        actions: person ? [open('profile', 'm', { focus: true, data: { name: person.name } })] : [open('relationships', 'm')],
      };
    }));
    a.plan.risks.forEach((r, i) => add(`risk:${a.id}:${i}`, () => {
      const person = a.stakeholders.find(s => r.includes(s.name.split(' ')[0]));
      return {
        reply: `Mitigation for “${r}”: ${person ? `get in front of ${person.name} directly — ${person.talkingPoints[0].toLowerCase()}` : `neutralize it before ${a.opps[0] ? a.opps[0].close : 'the close'} — put it on the next exec agenda`}.`,
        actions: person ? [open('profile', 'm', { focus: true, data: { name: person.name } })] : [open('notes', 's')],
      };
    }));
    a.plan.nextSteps.forEach((s, i) => add(`step:${a.id}:${i}`, () => {
      const person = a.stakeholders.find(p => s.includes(p.name.split(' ')[0]));
      return {
        reply: `For “${s}”: ${person ? `${person.name} ${person.sentiment === 'detractor' ? 'will push back — ' + (person.watchouts[0] || '').toLowerCase() : 'is receptive — ' + person.talkingPoints[0].toLowerCase()}` : 'I’d time-box it this week; it unblocks ' + (a.opps[0] ? a.opps[0].name : 'the account') + '.'}`,
        actions: person ? [open('profile', 'm', { focus: true, data: { name: person.name } })] : [],
      };
    }));
    // engagement touches + upcoming-call agenda
    (a.touches || []).forEach((t, i) => add(`touch:${a.id}:${i}`, () => {
      const person = a.stakeholders.find(s => s.name === t.who);
      return {
        reply: t.s === 'risk'
          ? `That ${t.type} with ${t.who} is the sore spot — ${person ? person.watchouts[0].toLowerCase() : 'handle with care'}. Follow up in person, not email.`
          : t.s === 'warn'
            ? `${t.who} left that open-ended. Close the loop this week — ${person ? person.talkingPoints[0].toLowerCase() : 'bring specifics'}.`
            : `Good signal. ${t.who} is engaged — ${person ? person.talkingPoints[0].toLowerCase() : 'keep the cadence'}.`,
        actions: person ? [open('profile', 'm', { focus: true, data: { name: person.name } })] : [],
      };
    }));
    (a.meetings && a.meetings[0] ? a.meetings[0].agenda || [] : []).forEach((g, i) => add(`agenda:${a.id}:${i}`, () => {
      const m = a.meetings[0];
      return {
        reply: `For “${g}”: ${i === 0 ? 'open with it — it sets the frame before objections start' : i === 1 ? 'this is the swing item; slow down here and check for nods' : 'land it, then stop talking — let them react'}. ${m.intel && m.intel[0] ? 'Remember: ' + m.intel[0].toLowerCase() + '.' : ''}`,
        actions: [],
      };
    }));
    add(`uc:call:${a.id}`, () => {
      const m = a.meetings && a.meetings[0];
      const first = m && m.with && m.with[0];
      return {
        reply: m ? `Next up: “${m.title}” — ${m.when} with ${m.with.join(', ')}. One goal: ${m.goal.toLowerCase()}.` : `No call on the books for ${a.name} — want me to draft an outreach?`,
        actions: m ? [ctx(a.id), open('callprep', 'l', { focus: true }), ...(first ? [open('profile', 'm', { data: { name: first } })] : [])] : [ctx(a.id)],
      };
    });

    // strategy map: goals + initiatives
    if (a.strategy) {
      for (const g of a.strategy.goals) add(`goal:${a.id}:${g.id}`, () => {
        const inits = a.strategy.inits.filter(x => x.goals.includes(g.id));
        const oppIds = [...new Set(inits.flatMap(x => x.opps))];
        const oppNames = oppIds.map(id => (a.opps.find(o => o.id === id) || {}).name).filter(Boolean);
        const val = oppIds.reduce((s2, id) => s2 + ((a.opps.find(o => o.id === id) || {}).value || 0), 0);
        return {
          reply: `“${g.t}” is carried by ${inits.map(x => x.t.toLowerCase()).join(' and ')} — which is exactly what ${oppNames.join(' + ')} fund${oppNames.length > 1 ? '' : 's'} (${fmtM(val)}). That's your business-case spine.`,
          actions: oppNames.length === 1 ? [ctx(a.id, oppIds[0]), open('pricing', 's')] : [ctx(a.id)],
        };
      });
      for (const it of a.strategy.inits) add(`init:${a.id}:${it.id}`, () => {
        const oppNames = it.opps.map(id => (a.opps.find(o => o.id === id) || {}).name).filter(Boolean);
        const owner = a.stakeholders.find(s => it.t.includes(s.name.split(' ')[0]));
        return {
          reply: `${it.t} maps straight to ${oppNames.join(' + ')}.${owner ? ` ${owner.name.split(' ')[0]} owns it — ${owner.talkingPoints[0].toLowerCase()}.` : ''}`,
          actions: [ctx(a.id, it.opps[0]), ...(owner ? [open('profile', 's', { data: { name: owner.name } })] : []), open('pricing', 's')],
        };
      });
      // last-call review + its threads
    if (a.review) {
      add(`uc:review:${a.id}`, () => ({
        reply: `${a.review.title} (${a.review.when}) scored ${a.review.score} — ${a.review.wins[0].toLowerCase()}, but ${a.review.concerns[0] ? a.review.concerns[0].toLowerCase() : 'nothing scared me'}. Two commitments on the clock.`,
        actions: [ctx(a.id), open('callreview', 'l', { focus: true }), open('notes', 's')],
      }));
      (a.review.concerns || []).forEach((w, i) => add(`rvw:${a.id}:${i}`, () => {
        const person = a.stakeholders.find(s => w.includes(s.name.split(' ')[0]));
        return {
          reply: person
            ? `That concern has a name: ${person.name}. ${person.talkingPoints[0]}. Get in front of it before the next call.`
            : `Handle it this week — fold it into “${a.plan.nextSteps[0]}” and say it out loud to the champion.`,
          actions: person ? [open('profile', 'm', { focus: true, data: { name: person.name } })] : [open('accountplan', 'm')],
        };
      }));
      (a.review.commitments || []).forEach((cm, i) => add(`commit:${a.id}:${i}`, () => ({
        reply: cm.who === 'You'
          ? `Yours, due ${cm.by}: “${cm.what}”. Do it a day early — speed is the cheapest trust signal there is.`
          : `${cm.who} owes “${cm.what}” by ${cm.by}. Nudge with help, not a chase: send something that makes it easier.`,
        actions: [open('notes', 's')],
      })));
    }

    add(`uc:champ:${a.id}`, () => {
      const ch = a.stakeholders.find(s => s.sentiment === 'champion') || a.stakeholders[0];
      return {
        reply: `${ch.name} is your inside voice — ${ch.tag}. Arm them: ${ch.talkingPoints[0].toLowerCase()}. Champions win deals you never see.`,
        actions: [ctx(a.id), open('profile', 'm', { focus: true, data: { name: ch.name } }), open('notes', 's')],
      };
    });
    add(`uc:econ:${a.id}`, () => {
      const buyer = a.stakeholders.find(s => (s.tag || '').includes('economic')) || a.stakeholders.find(s => /CFO|Finance/i.test(s.role)) || [...a.stakeholders].sort((x, y) => y.influence - x.influence)[0];
      return {
        reply: `The money runs through ${buyer.name} (${buyer.role}). ${buyer.talkingPoints[0]}. ${buyer.watchouts && buyer.watchouts[0] ? 'Mind: ' + buyer.watchouts[0].toLowerCase() + '.' : ''}`,
        actions: [ctx(a.id), open('profile', 'm', { focus: true, data: { name: buyer.name } }), open('oppcard', 's')],
      };
    });
    add(`smap:${a.id}`, () => ({
        reply: `${a.name}'s strategy in one picture — ${a.strategy.goals.length} goals, ${a.strategy.inits.length} initiatives, all landing on our ${a.opps.map(o => o.name).join(' and ')}. Click any node to trace the thread.`,
        actions: [ctx(a.id), open('oppmap', 'l', { focus: true }), open('accountplan', 's')],
      }));
    }

    (a.notes || []).forEach((n, i) => add(`note:${a.id}:${i}`, () => {
      const person = a.stakeholders.find(p => n.includes(p.name.split(' ')[0]));
      return {
        reply: person ? `That's about ${person.name} — ${person.tag}. Profile's up.` : `Logged against ${a.name}. It ties to “${a.plan.objectives[0].text}”.`,
        actions: person ? [open('profile', 'm', { focus: true, data: { name: person.name } })] : [open('accountplan', 'm')],
      };
    }));
  }

  /* ---------------- per stakeholder ---------------- */
  for (const a of A) {
    for (const s of a.stakeholders) {
      add(`person:${s.name}`, () => ({
        reply: `${s.name.split(' ')[0]} — ${s.tag}. ${s.watchouts && s.watchouts[0] ? 'Watch: ' + s.watchouts[0].toLowerCase() + '.' : s.talkingPoints[0] + '.'}`,
        actions: [ctx(a.id), { type: 'focus', app: 'profile' }],
      }));
      (s.talkingPoints || []).forEach((t, i) => add(`tp:${s.name}:${i}`, () => ({
        reply: `Use it in the open — ${s.name.split(' ')[0]} ${s.sentiment === 'champion' ? 'will amplify it internally' : 'responds to proof, not promises'}. Want it turned into a slide?`,
        actions: [],
      })));
      (s.watchouts || []).forEach((w, i) => add(`wo:${s.name}:${i}`, () => ({
        reply: `Counter for “${w}”: ${s.sentiment === 'detractor' ? 'bring an ally into every touchpoint and lead with risk reduction' : 'address it unprompted — it builds trust with ' + s.name.split(' ')[0]}.`,
        actions: [open('notes', 's')],
      })));
    }
  }

  /* ---------------- per opportunity ---------------- */
  for (const a of A) {
    for (const o of a.opps) {
      const line = `“${o.name}” is ${o.stage} at ${fmtM(o.value)}, closing ${o.close} — ${healthWord(o.health)}. Next: ${o.next.toLowerCase()}.`;
      const dealActions = [ctx(a.id, o.id), open('oppcard', 'm', { focus: true }), open('accountplan', 'm'), open('pricing', 's')];
      add(`deal:${o.id}`, () => ({ reply: line, actions: dealActions }));
      add(`oppzoom:${o.id}`, () => ({ reply: line, actions: [open('oppcard', 'm'), open('pricing', 'm'), open('accountplan', 's')] }));
      add(`pickopp:${o.id}`, () => ({
        reply: `Quote loaded — ${o.lines.length} lines, ${fmtM(o.value)} list, CRM discount ${o.discount}%. ${o.summary.split('.')[0]}.`,
        actions: [open('oppcard', 's')],
      }));
      add(`oppswitch:${o.id}`, () => ({
        reply: line,
        actions: [open('oppcard', 'm', { focus: true }), open('pricing', 'm')],
      }));
      const quoteList = () => {
        const term = o.term || 24;
        const monthly = o.lines.filter(l => l.type !== 'svc').reduce((x, l) => x + l.qty * l.price, 0);
        const svc = o.lines.filter(l => l.type === 'svc').reduce((x, l) => x + l.qty * l.price, 0);
        return { term, monthly, svc, list: monthly * term + svc };
      };
      add(`disc:${o.id}`, p => {
        const pct = p && p.pct ? p.pct : 20;
        const q = quoteList();
        const net = Math.round(q.list * (1 - pct / 100) / 1000);
        return {
          reply: `${pct}% negotiated on ${o.name} nets ~$${net}K TCV over ${q.term} months — stacked on term and volume that's ${pct >= 20 ? 'deal-desk + finance sign-off' : 'manager approval'} territory. Trade it: ${a.id === 'ironpeak' ? 'RFP-safe fixed-fee framing (and remember Sofia screenshots pricing)' : 'a longer term or a public reference'}, never give it free.`,
          actions: [open('notes', 's')],
        };
      });
      for (const l of o.lines) {
        add(`line:${o.id}:${l.sku}`, () => {
          const q = quoteList();
          const share = l.type === 'svc' ? l.qty * l.price : l.qty * l.price * q.term;
          return {
            reply: `${l.sku} is ${l.qty.toLocaleString()} ${l.unit} of ${l.desc.toLowerCase()} — ${fmtM(Math.round(share / 1000))} of the ${q.term}-month TCV${l.type === 'svc' ? ' (one-time)' : ''}. Justify it with ${a.id === 'northwind' ? 'the $8.2M avoided-outage math' : a.id === 'coastal' ? 'the methane-fine exposure' : 'the Meridian uptime record'}; undersize it and the ${o.name.toLowerCase()} story falls apart.`,
            actions: [],
          };
        });
      }
    }
  }

  /* ---------------- pipeline stages / segments / KPIs ---------------- */
  for (const st of CRM.STAGES) {
    const deals = A.flatMap(a => a.opps.filter(o => o.stage === st).map(o => ({ a, o })));
    const tot = deals.reduce((s, d) => s + d.o.value, 0);
    add(`stage:${st}`, () => ({
      reply: deals.length
        ? `${st}: ${deals.length} deal${deals.length > 1 ? 's' : ''}, ${fmtM(tot)}. ${deals.map(d => d.o.name).join(', ')} — the one to push is ${deals.sort((x, y) => y.o.value - x.o.value)[0].o.name}.`
        : `${st} is empty — your funnel is top-light there; Ravenna's expansion is the natural feeder.`,
      actions: [],
    }));
  }
  for (const mode of ['stage', 'region']) {
    const vals = [...new Set(A.flatMap(a => a.opps.map(o => mode === 'stage' ? o.stage : a.region)))];
    for (const v of vals) {
      const deals = A.flatMap(a => a.opps.filter(o => (mode === 'stage' ? o.stage : a.region) === v).map(o => ({ a, o })));
      const tot = deals.reduce((s, d) => s + d.o.value, 0);
      add(`groupzoom:${mode}:${v}`, () => ({
        reply: `${v}: ${fmtM(tot)} across ${deals.length} deal${deals.length > 1 ? 's' : ''}. Biggest: ${deals.sort((x, y) => y.o.value - x.o.value)[0].o.name} (${deals[0].a.name}).`,
        actions: [open('pipeline', 'm')],
      }));
    }
  }
  const kpiOpens = {
    'Pipeline': [open('pipeline', 'l', { focus: true }), open('territory', 'm')],
    'Quota Att.': [open('territory', 'l', { focus: true }), open('pipeline', 'm')],
    'Win Rate': [open('pipeline', 'l', { focus: true }), open('notes', 's', { data: { title: 'Win-rate levers', items: ['Ironpeak RFP is the swing deal — win it and Q3 rate jumps 8 pts', 'Meridian reference is closing 2 of your last 4', 'Losses cluster in Qualify — tighten exit criteria'] } })],
    'Avg. Cycle': [open('pipeline', 'l', { focus: true }), open('notes', 's', { data: { title: 'Cycle-time levers', items: ['Paper early: Sam Iqbal needs 3 weeks, Ravenna legal needs 6 pages max', 'Security reviews are your longest stage — pre-send compliance packs', 'Multi-threading cut 11 days last quarter — keep it up'] } })],
  };
  for (const k of CRM.METRICS.kpis) {
    add(`kpi:${k.label}`, () => ({
      reply: k.label === 'Pipeline'
        ? `${k.value} across 9 deals — ${fmtM(2400 + 940)} of it is Northwind alone, so the book concentrates hard on Sep/Oct closes.`
        : k.label === 'Quota Att.'
          ? `84% with the two Northwind deals still open — land the renewal and you're at 119%.`
          : k.label === 'Win Rate'
            ? `31% and climbing — the Ironpeak RFP is the swing deal for the quarter.`
            : `94 days average — security reviews are the drag; Tom Okafor's workshop is the unlock.`,
      actions: kpiOpens[k.label] || [],
    }));
  }

  /* ---------------- global intents ---------------- */
  add('intent:book', () => ({
    reply: `Your book: ${fmtM(CRM.pipelineTotal)} across 9 deals in 5 accounts. Northwind dominates, Ironpeak is contested, Ravenna is the growth bet — click any bubble to zoom.`,
    actions: [open('territory', 'xl', { focus: true }), { type: 'chat', mode: 'slim' }],
  }));
  add('intent:pipeline', () => ({
    reply: `Nine deals on the board — ${fmtM(CRM.pipelineTotal)}. Negotiate column is all Northwind; the crowd sits in Qualify.`,
    actions: [open('pipeline', 'xl', { focus: true }), open('metrics', 's')],
  }));
  add('intent:attention', () => ({
    reply: `Ironpeak. The $1.2M mainframe RFP is due Aug 22, Sofia Marino is actively selling Hyperion internally, and Walt is persuadable — that's the fight this week.`,
    actions: [ctx('ironpeak'), open('accountplan', 'm', { focus: true }), open('relationships', 'm'), open('pipeline', 's')],
  }));
  add('intent:metrics', () => ({
    reply: `Quarter at a glance — pipeline's up 18%, cycle time down 11 days. The quota line moves on Northwind.`,
    actions: [open('metrics', 'l', { focus: true })],
  }));
  add('intent:cleanup', () => ({
    reply: `Cleared. Fresh canvas.`,
    actions: [{ type: 'close_all' }, { type: 'chat', mode: 'normal' }],
  }));
  add('intent:battle', () => ({
    reply: `${CRM.BATTLE.competitor}: ${CRM.BATTLE.tagline} They're entrenched at Ironpeak, circling Northwind — and they lost Ravenna to us on speed.`,
    actions: [open('battlecard', 'l', { focus: true })],
  }));
  add('acctswitch:none', () => ({
    reply: `Back to the full book — ${fmtM(CRM.pipelineTotal)} across 5 accounts.`,
    actions: [],
  }));
  add('oppswitch:none', () => ({ reply: `Opportunity cleared — account view.`, actions: [] }));
  CRM.BATTLE.landmines.forEach((l, i) => add(`land:${i}`, () => ({
    reply: `Plant it in the next group setting — ${i === 0 ? 'they have no production grid-AI reference; the silence does your selling' : i === 1 ? 'their year-2 step-ups average 22%; procurement hates surprises' : 'their MSAs push overrun risk to the customer — RFP scorers notice'}.`,
    actions: [],
  })));
  CRM.BATTLE.counters.forEach((c, i) => add(`counter:${i}`, () => ({
    reply: `When they say ${c.claim.toLowerCase()} — ${c.counter}`,
    actions: [],
  })));

  /* ---------------- use-case launchers ---------------- */
  add('uc:morning', () => ({
    reply: `Morning picture: ${fmtM(CRM.pipelineTotal)} in play, 84% to quota. Two clocks ticking — Ironpeak's RFP (Aug 22) and Northwind paper to procurement (Sep 8).`,
    actions: [open('metrics', 'l', { focus: true }), open('pipeline', 'm'), open('notes', 's')],
  }));
  for (const a of A) {
    const champ = a.stakeholders.find(s => s.sentiment === 'champion') || a.stakeholders[0];
    add(`uc:politics:${a.id}`, () => ({
      reply: `${a.name}'s power map. ${champ.name} is your way in — ${champ.tag}. ${a.stakeholders.find(s => s.sentiment === 'detractor') ? `${a.stakeholders.find(s => s.sentiment === 'detractor').name} is the one to defuse.` : 'No open detractors.'}`,
      actions: [ctx(a.id), open('relationships', 'l', { focus: true }), open('profile', 'm', { data: { name: champ.name } })],
    }));
    for (const o of a.opps) {
      add(`uc:dealroom:${o.id}`, () => ({
        reply: `Deal room for ${o.name} — ${fmtM(o.value)}, ${o.stage}, closing ${o.close}. Next move: ${o.next.toLowerCase()}.`,
        actions: [ctx(a.id, o.id), open('oppcard', 's'), open('accountplan', 'm', { focus: true }), open('pricing', 'm')],
      }));
      add(`uc:close:${o.id}`, () => ({
        reply: `Path to signature on ${o.name}: ${o.next.toLowerCase()} → clean paper 3 weeks before ${o.close} → executive nudge in the final week. ${o.health === 'risk' ? 'It\u2019s wobbling — escalate now, not at the deadline.' : 'It\u2019s trackable if the next step lands this week.'}`,
        actions: [ctx(a.id, o.id), open('accountplan', 'm', { focus: true }), open('callprep', 's'), open('oppcard', 's')],
      }));
      add(`uc:quote:${o.id}`, () => ({
        reply: `${o.name} quote: ${o.lines.length} lines, ${fmtM(o.value)} list, ${o.discount}% standard. ${o.stage === 'Negotiate' ? 'You have room to hold — they need the Sep close as much as you do.' : 'Keep discount powder dry this early.'}`,
        actions: [ctx(a.id, o.id), open('pricing', 'l', { focus: true }), open('oppcard', 's'), { type: 'chat', mode: 'slim' }],
      }));
    }
  }

  /* ---------------- free-text intent matcher ---------------- */
  const GEN_WORDS = /deck|slide|present|podcast|flashcard|email|write|draft|brief me a|script|rehears|role.?play|why |what if|compare|versus|vs\b/i;
  function matchText(raw) {
    if (!raw) return null;
    const t = raw.toLowerCase();
    if (GEN_WORDS.test(t)) return null; // generative / analytical → LLM
    const acct = A.find(a => t.includes(a.name.toLowerCase()) || t.includes(a.id));
    if (acct && /review|debrief|how did|went/.test(t) && T.has(`uc:review:${acct.id}`)) return T.get(`uc:review:${acct.id}`)();
    if (acct && /call|meeting/.test(t) && T.has(`uc:call:${acct.id}`)) return T.get(`uc:call:${acct.id}`)();
    if (acct && /prep|brief|ready|plan for|tell me about|pull up|open|show/.test(t)) return T.get(`prep:${acct.id}`)();
    for (const a of A) for (const o of a.opps) if (t.includes(o.name.toLowerCase())) return T.get(`oppswitch:${o.id}`)();
    for (const a of A) for (const s of a.stakeholders) if (t.includes(s.name.toLowerCase())) {
      const r = T.get(`person:${s.name}`)();
      return { reply: r.reply, actions: [...r.actions.filter(x => x.type === 'context'), open('profile', 'm', { focus: true, data: { name: s.name } })] };
    }
    if (/hyperion|battle ?card|competit/.test(t)) return T.get('intent:battle')();
    if (acct && /call|meeting|prep/.test(t) && T.has(`uc:call:${acct.id}`)) return T.get(`uc:call:${acct.id}`)();
    if (acct && /strateg|initiative|goal|map .*(goal|opp)/.test(t) && T.has(`smap:${acct.id}`)) return T.get(`smap:${acct.id}`)();
    if (/book of business|territor|market map|petri/.test(t)) return T.get('intent:book')();
    if (/pipeline|deal board|opportunit/.test(t)) return T.get('intent:pipeline')();
    if (/attention|priorit|focus today|where do we start|what.?s hot|worried/.test(t)) return T.get('intent:attention')();
    if (/clean|clear|reset|start over/.test(t)) return T.get('intent:cleanup')();
    if (/metric|kpi|numbers|dashboard|quota/.test(t)) return T.get('intent:metrics')();
    if (acct) return T.get(`prep:${acct.id}`)();
    return null;
  }

  function resolve(route, text) {
    try {
      if (route && route.key && T.has(route.key)) return T.get(route.key)(route.params || {});
      // free-typed text only — UI events without a route are intentionally LLM-bound
      if (text && !/^\[UI EVENT\]/i.test(text)) return matchText(text);
    } catch (e) { console.error('[route]', e.message); }
    return null;
  }

  return { count: T.size, resolve };
}

module.exports = { build };
