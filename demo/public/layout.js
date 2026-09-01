/* Chameleon layout solver — packs app tiles onto a fixed grid.
   Works in browser (window.Layout) and Node (module.exports) for tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Layout = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const GRID = { cols: 8, rows: 6 };
  const SIZE_ORDER = ['s', 'm', 'l', 'xl'];

  function sizeRank(s) { return SIZE_ORDER.indexOf(s); }

  function ladderFor(requested) {
    // requested size first, then progressively smaller
    const r = sizeRank(requested);
    const out = [];
    for (let i = r; i >= 0; i--) out.push(SIZE_ORDER[i]);
    return out;
  }

  function makeOcc(grid) {
    return Array.from({ length: grid.rows }, () => Array(grid.cols).fill(null));
  }

  function fits(occ, x, y, w, h, grid) {
    if (x + w > grid.cols || y + h > grid.rows) return false;
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++)
        if (occ[j][i]) return false;
    return true;
  }

  function mark(occ, x, y, w, h, id) {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++)
        occ[j][i] = id;
  }

  function findSpot(occ, w, h, grid) {
    for (let y = 0; y <= grid.rows - h; y++)
      for (let x = 0; x <= grid.cols - w; x++)
        if (fits(occ, x, y, w, h, grid)) return { x, y };
    return null;
  }

  /* items: [{ id, size, focus, openedAt, at?: {x,y}, spec: { sizes: {s:[w,h],...}, max:[w,h] } }] */
  function solve(items, grid) {
    grid = grid || GRID;
    const occ = makeOcc(grid);
    const placed = [];
    const failed = [];

    /* pass 0 — EXACT tiles (user-held, user-sized, or custom-dimensioned):
       exact footprint at the exact anchor, most-recently-touched wins first,
       small spiral nudge if two exacts collide, everyone else bends */
    const exact = items
      .filter(it => it.at && (it.force || it.custom))
      .sort((a, b) => (b.force ? 1 : 0) - (a.force ? 1 : 0) || (b.touched || 0) - (a.touched || 0));
    const exactSet = new Set(exact);
    for (const it of exact) {
      const dims = it.custom ? [it.custom.w, it.custom.h] : (it.spec.sizes[it.size] || it.spec.sizes.s);
      const w = Math.max(1, Math.min(dims[0], grid.cols));
      const h = Math.max(1, Math.min(dims[1], grid.rows));
      let x = Math.max(0, Math.min(grid.cols - w, it.at.x));
      let y = Math.max(0, Math.min(grid.rows - h, it.at.y));
      if (!fits(occ, x, y, w, h, grid)) {
        let spot = null;
        for (let r = 1; r <= 3 && !spot; r++) {
          for (let dy = -r; dy <= r && !spot; dy++) for (let dx = -r; dx <= r && !spot; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const nx = Math.max(0, Math.min(grid.cols - w, x + dx));
            const ny = Math.max(0, Math.min(grid.rows - h, y + dy));
            if (fits(occ, nx, ny, w, h, grid)) spot = { x: nx, y: ny };
          }
        }
        if (!spot) { failed.push(it.id); continue; }
        x = spot.x; y = spot.y;
      }
      mark(occ, x, y, w, h, it.id);
      placed.push({ id: it.id, x, y, w, h, size: it.size, spec: it.spec, pinned: true, custom: !!it.custom, noGrow: true });
    }

    /* pass 1 — legacy pinned (anchor preference, preset dims, may ladder-shrink) */
    const pinned = items.filter(it => it.at && !exactSet.has(it));
    const loose = items.filter(it => !it.at && !exactSet.has(it));
    for (const it of pinned) {
      let done = false;
      for (const s of ladderFor(it.size)) {
        const dims = it.spec.sizes[s];
        if (!dims) continue;
        const [w, h] = dims;
        const x = Math.max(0, Math.min(grid.cols - w, it.at.x));
        const y = Math.max(0, Math.min(grid.rows - h, it.at.y));
        if (fits(occ, x, y, w, h, grid)) {
          mark(occ, x, y, w, h, it.id);
          placed.push({ id: it.id, x, y, w, h, size: s, spec: it.spec, pinned: true, noGrow: !!it.noGrow });
          done = true;
          break;
        }
      }
      if (!done) loose.push(it); // spot taken — flow normally
    }

    const order = loose.sort((a, b) =>
      (b.focus ? 1 : 0) - (a.focus ? 1 : 0) ||
      sizeRank(b.size) - sizeRank(a.size) ||
      b.openedAt - a.openedAt
    );

    for (const it of order) {
      let done = false;
      for (const s of ladderFor(it.size)) {
        const dims = it.spec.sizes[s];
        if (!dims) continue;
        const [w, h] = dims;
        const pos = findSpot(occ, w, h, grid);
        if (pos) {
          mark(occ, pos.x, pos.y, w, h, it.id);
          placed.push({ id: it.id, x: pos.x, y: pos.y, w, h, size: s, spec: it.spec, noGrow: !!it.noGrow });
          done = true;
          break;
        }
      }
      if (!done) failed.push(it.id);
    }

    growToFill(occ, placed, grid);
    placed.forEach(p => { delete p.spec; });
    return { placed, failed };
  }

  function growToFill(occ, placed, grid) {
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 64) {
      changed = false;
      for (const p of placed) {
        if (p.noGrow) continue; // user-sized: respect their emptiness
        const maxW = Math.min(p.spec.max[0], grid.cols);
        const maxH = Math.min(p.spec.max[1], grid.rows);
        // grow right
        if (p.w < maxW && p.x + p.w < grid.cols) {
          let free = true;
          for (let j = p.y; j < p.y + p.h; j++) if (occ[j][p.x + p.w]) { free = false; break; }
          if (free) { for (let j = p.y; j < p.y + p.h; j++) occ[j][p.x + p.w] = p.id; p.w++; changed = true; }
        }
        // grow down
        if (p.h < maxH && p.y + p.h < grid.rows) {
          let free = true;
          for (let i = p.x; i < p.x + p.w; i++) if (occ[p.y + p.h][i]) { free = false; break; }
          if (free) { for (let i = p.x; i < p.x + p.w; i++) occ[p.y + p.h][i] = p.id; p.h++; changed = true; }
        }
      }
    }
  }

  return { GRID, SIZE_ORDER, sizeRank, solve };
});
