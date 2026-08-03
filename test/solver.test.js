/* Solver invariants: no overlaps, in bounds, hero dominance, degradation, growth caps. */
const Layout = require('../public/layout.js');
const { REGISTRY } = require('../public/apps.js');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL:', name); }
}

function item(id, size, focus, openedAt) {
  return { id, size, focus: !!focus, openedAt, spec: { sizes: REGISTRY[id].sizes, max: REGISTRY[id].max } };
}

function validate(name, placed) {
  const occ = {};
  for (const p of placed) {
    check(`${name}: ${p.id} in bounds`, p.x >= 0 && p.y >= 0 && p.x + p.w <= 8 && p.y + p.h <= 6);
    for (let j = p.y; j < p.y + p.h; j++)
      for (let i = p.x; i < p.x + p.w; i++) {
        const k = i + ',' + j;
        check(`${name}: no overlap at ${k} (${p.id} vs ${occ[k]})`, !occ[k]);
        occ[k] = p.id;
      }
    const max = REGISTRY[p.id].max;
    check(`${name}: ${p.id} within max grow`, p.w <= max[0] && p.h <= max[1]);
  }
}

/* 1. single hero fills as much as it may */
{
  const { placed, failed } = Layout.solve([item('presentation', 'xl', true, 1)]);
  validate('solo-hero', placed);
  check('solo-hero: placed', placed.length === 1 && failed.length === 0);
  check('solo-hero: grows to full grid', placed[0].w === 8 && placed[0].h === 6);
}

/* 2. hero + sidekicks: hero keeps dominance */
{
  const { placed, failed } = Layout.solve([
    item('presentation', 'xl', true, 3),
    item('podcast', 's', false, 2),
    item('notes', 's', false, 1),
  ]);
  validate('hero+2', placed);
  check('hero+2: all placed', placed.length === 3 && failed.length === 0);
  const hero = placed.find(p => p.id === 'presentation');
  check('hero+2: hero >= 6x6', hero.w >= 6 && hero.h >= 6);
}

/* 3. overload: sizes degrade instead of failing outright */
{
  const items = [
    item('presentation', 'xl', true, 6),
    item('relationships', 'l', false, 5),
    item('pipeline', 'l', false, 4),
    item('pricing', 'm', false, 3),
    item('notes', 'm', false, 2),
  ];
  const { placed, failed } = Layout.solve(items);
  validate('overload', placed);
  check('overload: something failed OR everything degraded to fit', placed.length + failed.length === 5);
  check('overload: hero placed first and large', placed.find(p => p.id === 'presentation').w >= 6);
}

/* 4. everything-small dashboard fits */
{
  const items = ['podcast', 'flashcards', 'notes', 'metrics', 'pricing'].map((id, i) => item(id, 's', false, i));
  const { placed, failed } = Layout.solve(items);
  validate('dashboard', placed);
  check('dashboard: all 5 placed', placed.length === 5 && failed.length === 0);
}

/* 5. growth never exceeds per-app caps (podcast max 4x3, metrics max 8x2) */
{
  const { placed } = Layout.solve([item('podcast', 'm', true, 1), item('metrics', 'm', false, 2)]);
  validate('caps', placed);
  const pod = placed.find(p => p.id === 'podcast');
  const met = placed.find(p => p.id === 'metrics');
  check('caps: podcast <= 4x3', pod.w <= 4 && pod.h <= 3);
  check('caps: metrics <= 8x2', met.w <= 8 && met.h <= 2);
}

/* 6. requested size respected when there is room */
{
  const { placed } = Layout.solve([item('relationships', 'm', false, 1), item('accountplan', 'm', false, 2)]);
  validate('two-mediums', placed);
  check('two-mediums: both placed', placed.length === 2);
}

/* 7b. pinned placement wins its spot; others flow around */
{
  const items = [
    { ...item('notes', 's', false, 1), at: { x: 6, y: 4 } },
    item('presentation', 'l', true, 2),
    item('pipeline', 'm', false, 3),
  ];
  const { placed } = Layout.solve(items);
  validate('pinned', placed);
  const n = placed.find(p => p.id === 'notes');
  check('pinned: notes anchored at 6,4-ish', n.x === 6 && n.y === 4);
}

/* 7c. pinned out-of-bounds gets clamped */
{
  const items = [{ ...item('podcast', 'm', false, 1), at: { x: 99, y: 99 } }];
  const { placed } = Layout.solve(items);
  validate('pinned-clamp', placed);
}

/* 7d. noGrow keeps exact preset dims (empty canvas allowed) */
{
  const it = { ...item('podcast', 's', false, 1), noGrow: true };
  const { placed } = Layout.solve([it]);
  validate('nogrow', placed);
  const p = placed[0];
  check('nogrow: stays at s dims', p.w === REGISTRY.podcast.sizes.s[0] && p.h === REGISTRY.podcast.sizes.s[1]);
}

/* 7. determinism */
{
  const items = () => [item('presentation', 'l', false, 1), item('pipeline', 'm', false, 2), item('notes', 's', false, 3)];
  const a = JSON.stringify(Layout.solve(items()));
  const b = JSON.stringify(Layout.solve(items()));
  check('deterministic', a === b);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
