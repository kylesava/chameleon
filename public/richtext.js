/* Rich lesson rendering: markdown → HTML, plus the visual layer.
   Zero dependencies of its own; heavy renderers (diagrams, maths, charts) are
   loaded lazily from a CDN by enhance() and degrade to readable source if
   unavailable. Written to survive being called on every streaming delta. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Rich = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------------- inline ---------------- */
  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => /^https?:\/\//.test(src) ? `<img alt="${alt}" src="${src}" loading="lazy">` : alt)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => /^(https?:|#|\/)/.test(href) ? `<a href="${href}" target="_blank" rel="noopener">${t}</a>` : t)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/==([^=]+)==/g, '<mark>$1</mark>');
  }

  /* ---------------- callouts ----------------
     > [!NOTE] optional title      (also TIP / KEY / WARNING / EXAMPLE / QUESTION) */
  const CALLOUT = {
    NOTE: { cls: 'note', icon: 'ℹ', label: 'Note' },
    TIP: { cls: 'tip', icon: '✦', label: 'Tip' },
    KEY: { cls: 'key', icon: '★', label: 'Key idea' },
    INSIGHT: { cls: 'key', icon: '★', label: 'Key idea' },
    WARNING: { cls: 'warn', icon: '⚠', label: 'Watch out' },
    PITFALL: { cls: 'warn', icon: '⚠', label: 'Common mistake' },
    EXAMPLE: { cls: 'example', icon: '▸', label: 'Example' },
    QUESTION: { cls: 'question', icon: '?', label: 'Think about it' },
  };

  /* ---------------- block parser ---------------- */
  function md(src) {
    const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    let out = '';
    let i = 0;

    const isTableSep = l => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(l) && l.includes('-') && l.includes('|');
    const cells = l => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());

    while (i < lines.length) {
      const line = lines[i];

      /* fenced block — code, or a visual we hand to enhance() later */
      const fence = line.match(/^\s*```[ \t]*([\w+-]*)/);
      if (fence) {
        const lang = (fence[1] || '').toLowerCase();
        const body = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
        const closed = i < lines.length; // an unclosed fence is still streaming
        i++;
        const text = body.join('\n');
        // Only promote to a visual once the fence has closed — mid-stream the
        // source is incomplete and would render as a broken diagram.
        if (closed && lang === 'mermaid') out += `<div class="viz mermaid-src" data-src="${esc(text)}"><pre class="viz-fallback">${esc(text)}</pre></div>`;
        else if (closed && (lang === 'chart' || lang === 'vega' || lang === 'vega-lite')) out += `<div class="viz chart-src" data-src="${esc(text)}"><pre class="viz-fallback">${esc(text)}</pre></div>`;
        else out += `<pre class="code${closed ? '' : ' streaming'}"${lang ? ` data-lang="${esc(lang)}"` : ''}><code${lang ? ` class="language-${esc(lang)}"` : ''}>${esc(text)}</code></pre>`;
        continue;
      }

      /* table */
      if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const head = cells(line);
        const align = cells(lines[i + 1]).map(c => c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : '');
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
        out += '<div class="tablewrap"><table><thead><tr>' +
          head.map((h, n) => `<th${align[n] ? ` style="text-align:${align[n]}"` : ''}>${inline(h)}</th>`).join('') +
          '</tr></thead><tbody>' +
          rows.map(r => '<tr>' + r.map((c, n) => `<td${align[n] ? ` style="text-align:${align[n]}"` : ''}>${inline(c)}</td>`).join('') + '</tr>').join('') +
          '</tbody></table></div>';
        continue;
      }

      /* blockquote / callout */
      if (/^\s*>/.test(line)) {
        const body = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
        const first = body[0] || '';
        const tag = first.match(/^\[!(\w+)\]\s*(.*)$/i);
        if (tag && CALLOUT[tag[1].toUpperCase()]) {
          const c = CALLOUT[tag[1].toUpperCase()];
          const title = tag[2].trim() || c.label;
          out += `<div class="callout ${c.cls}"><div class="callout-head"><i>${c.icon}</i>${esc(title)}</div><div class="callout-body">${md(body.slice(1).join('\n'))}</div></div>`;
        } else {
          out += `<blockquote>${md(body.join('\n'))}</blockquote>`;
        }
        continue;
      }

      /* heading */
      const h = line.match(/^\s*(#{1,6})\s+(.*)$/);
      if (h) { out += `<h${Math.min(h[1].length + 2, 6)} class="md-h">${inline(h[2])}</h${Math.min(h[1].length + 2, 6)}>`; i++; continue; }

      /* horizontal rule */
      if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { out += '<hr>'; i++; continue; }

      /* lists (task lists included) */
      const li = line.match(/^(\s*)([-*•]|\d+[.)])\s+(.*)$/);
      if (li) {
        const ordered = /\d/.test(li[2]);
        const items = [];
        while (i < lines.length) {
          const m = lines[i].match(/^(\s*)([-*•]|\d+[.)])\s+(.*)$/);
          if (!m || /\d/.test(m[2]) !== ordered) break;
          let text = m[3];
          i++;
          // fold continuation lines into the same item
          while (i < lines.length && lines[i].trim() && !/^(\s*)([-*•]|\d+[.)])\s+/.test(lines[i]) && !/^\s*(#{1,6}|>|```)/.test(lines[i])) {
            text += ' ' + lines[i++].trim();
          }
          const task = text.match(/^\[([ xX])\]\s+(.*)$/);
          items.push(task
            ? `<li class="task ${task[1].trim() ? 'done' : ''}"><i></i>${inline(task[2])}</li>`
            : `<li>${inline(text)}</li>`);
        }
        out += `<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`;
        continue;
      }

      /* blank */
      if (!line.trim()) { i++; continue; }

      /* paragraph */
      const para = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !/^\s*(#{1,6}\s|>|```|[-*•]\s|\d+[.)]\s)/.test(lines[i]) && !(lines[i].includes('|') && isTableSep(lines[i + 1] || ''))) {
        para.push(lines[i++]);
      }
      out += `<p>${inline(para.join(' '))}</p>`;
    }
    return out;
  }

  /* ---------------- lazy CDN loading ---------------- */
  const loaded = {};
  function loadScript(url) {
    if (loaded[url]) return loaded[url];
    loaded[url] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('failed to load ' + url));
      document.head.appendChild(s);
    });
    return loaded[url];
  }
  function loadCss(url) {
    if (loaded[url]) return loaded[url];
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = url;
    document.head.appendChild(l);
    loaded[url] = Promise.resolve();
    return loaded[url];
  }

  /* ---------------- the visual layer ----------------
     Versions are pinned deliberately: floating tags have moved these libraries
     onto breaking changes before. Everything is fetched on first use only, so
     a lesson with no diagram pays nothing. */
  const CDN = {
    mermaid: 'https://cdn.jsdelivr.net/npm/mermaid@11.16.0/dist/mermaid.esm.min.mjs',
    katexCss: 'https://cdn.jsdelivr.net/npm/katex@0.18.1/dist/katex.min.css',
    katex: 'https://cdn.jsdelivr.net/npm/katex@0.18.1/dist/katex.min.js',
    katexAuto: 'https://cdn.jsdelivr.net/npm/katex@0.18.1/dist/contrib/auto-render.min.js',
    vega: 'https://cdn.jsdelivr.net/npm/vega@6.3.1',
    vegaLite: 'https://cdn.jsdelivr.net/npm/vega-lite@6.4.3',
    vegaEmbed: 'https://cdn.jsdelivr.net/npm/vega-embed@7.1.0',
    hljsCss: 'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.11.1/styles/github-dark.min.css',
    hljs: 'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.11.1/highlight.min.js',
  };

  /* Mermaid's theming engine takes hex only — it cannot read CSS variables —
     so these mirror style.css by hand. Keep them in step. */
  const MERMAID_THEME = {
    darkMode: true,
    fontSize: '13px',        // sit with the lesson text, not shout over it
    background: '#10141b',
    primaryColor: '#1b2230',
    primaryTextColor: '#e6edf3',
    primaryBorderColor: '#39506f',
    secondaryColor: '#232c3c',
    tertiaryColor: '#161c26',
    lineColor: '#6b7f9c',
    textColor: '#c9d4e0',
    mainBkg: '#1b2230',
    nodeBorder: '#39506f',
    clusterBkg: '#141a24',
    clusterBorder: '#26303f',
    titleColor: '#e6edf3',
    edgeLabelBackground: '#10141b',
    actorBkg: '#1b2230', actorBorder: '#39506f', actorTextColor: '#e6edf3',
    signalColor: '#6b7f9c', signalTextColor: '#c9d4e0',
    noteBkgColor: '#233043', noteTextColor: '#e6edf3', noteBorderColor: '#39506f',
    labelBoxBkgColor: '#1b2230', labelBoxBorderColor: '#39506f', labelTextColor: '#e6edf3',
    pie1: '#5d87ff', pie2: '#3ce2a5', pie3: '#f0a83c', pie4: '#c9b8ff', pie5: '#ff5f8f',
  };

  const VEGA_DARK = {
    view: { stroke: 'transparent' },
    axis: {
      domainColor: '#2a3546', gridColor: '#1c2431', tickColor: '#2a3546',
      labelColor: '#9aa4b4', titleColor: '#edf0f6',
      labelFont: 'IBM Plex Sans', titleFont: 'IBM Plex Sans', titleFontWeight: 600,
    },
    legend: { labelColor: '#9aa4b4', titleColor: '#edf0f6', labelFont: 'IBM Plex Sans', titleFont: 'IBM Plex Sans' },
    title: { color: '#edf0f6', font: 'IBM Plex Sans', fontWeight: 600 },
    range: { category: ['#5d87ff', '#3ce2a5', '#f0a83c', '#c9b8ff', '#ff5f8f', '#7fd4e8'] },
    background: '#10141b',
  };

  let mermaidReady = null;
  async function getMermaid() {
    if (!mermaidReady) {
      mermaidReady = (async () => {
        const m = (await import(CDN.mermaid)).default;
        m.initialize({
          startOnLoad: false,
          securityLevel: 'strict',      // content is model-authored
          suppressErrorRendering: true, // we draw our own fallback
          theme: 'base',
          fontFamily: 'IBM Plex Sans, sans-serif',
          themeVariables: MERMAID_THEME,
        });
        // diagram layout measures text, so webfonts must have landed first
        if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch {} }
        return m;
      })();
    }
    return mermaidReady;
  }

  let seq = 0;
  async function mountMermaid(root) {
    const nodes = [...root.querySelectorAll('.mermaid-src:not([data-done])')];
    if (!nodes.length) return;
    let mermaid;
    try { mermaid = await getMermaid(); }
    catch { nodes.forEach(n => n.setAttribute('data-done', 'offline')); return; }
    for (const n of nodes) {
      n.setAttribute('data-done', '1');
      const src = n.getAttribute('data-src') || '';
      try {
        // strip author frontmatter so one diagram can't reskin the workspace
        const clean = src.replace(/^\s*---\n[\s\S]*?\n---\n/, '');
        const { svg, bindFunctions } = await mermaid.render('mmd-' + (++seq) + '-' + Math.random().toString(36).slice(2, 7), clean);
        n.innerHTML = svg;
        const el = n.querySelector('svg');
        if (el) {
          // Mermaid sizes to its own natural width; let CSS cap it instead so a
          // diagram can't swallow the tile. Sizing lives in .viz svg.
          el.removeAttribute('width');
          el.removeAttribute('height');
          el.style.removeProperty('max-width');
          el.setAttribute('role', 'img');
          n.classList.add('viz-diagram');
          n.title = 'Click to expand';
          n.addEventListener('click', () => n.classList.toggle('zoom'));
        }
        bindFunctions?.(n);
      } catch (e) {
        n.classList.add('viz-error');
        n.setAttribute('data-done', 'error');
      }
    }
  }

  async function mountCharts(root) {
    const nodes = [...root.querySelectorAll('.chart-src:not([data-done])')];
    if (!nodes.length) return;
    try {
      await loadScript(CDN.vega);
      await loadScript(CDN.vegaLite);
      await loadScript(CDN.vegaEmbed);
    } catch { nodes.forEach(n => n.setAttribute('data-done', 'offline')); return; }
    for (const n of nodes) {
      n.setAttribute('data-done', '1');
      try {
        const spec = JSON.parse(n.getAttribute('data-src') || '{}');
        n.innerHTML = '';
        await window.vegaEmbed(n, {
          $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
          width: 'container',
          ...spec,
          background: VEGA_DARK.background,
          config: { ...VEGA_DARK, ...(spec.config || {}) },
        }, { actions: false, renderer: 'svg' });
      } catch (e) {
        n.classList.add('viz-error');
        n.setAttribute('data-done', 'error');
      }
    }
  }

  async function mountCode(root) {
    const nodes = [...root.querySelectorAll('pre.code:not(.streaming) > code:not([data-hl])')];
    if (!nodes.length) return;
    try { loadCss(CDN.hljsCss); await loadScript(CDN.hljs); }
    catch { return; }
    for (const n of nodes) {
      n.setAttribute('data-hl', '1');
      try { window.hljs.highlightElement(n); } catch {}
    }
  }

  const MATH_RE = /\$\$[\s\S]+?\$\$|\$[^$\n]+\$|\\\(|\\\[/;
  async function mountMath(root) {
    if (root.hasAttribute('data-math')) return;
    if (!MATH_RE.test(root.textContent || '')) return;
    root.setAttribute('data-math', '1');
    try { loadCss(CDN.katexCss); await loadScript(CDN.katex); await loadScript(CDN.katexAuto); }
    catch { return; }
    try {
      window.renderMathInElement(root, {
        delimiters: [
          { left: '$$', right: '$$', display: true },   // must precede the single-$ rule
          { left: '$', right: '$', display: false },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
        ],
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option'],
        throwOnError: false,
      });
    } catch {}
  }

  /* Idempotent: safe to call after every streaming repaint. Each mounted node
     is marked, and failures degrade to the readable source rather than an
     error graphic. */
  function enhance(root) {
    if (!root || typeof document === 'undefined') return Promise.resolve();
    return Promise.allSettled([mountMermaid(root), mountCharts(root), mountCode(root), mountMath(root)]);
  }

  return { md, inline, esc, loadScript, loadCss, enhance, CALLOUT, CDN, MERMAID_THEME, VEGA_DARK };
});
