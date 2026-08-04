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
        i++; // closing fence
        const text = body.join('\n');
        if (lang === 'mermaid') out += `<div class="viz mermaid-src" data-src="${esc(text)}"><pre class="viz-fallback">${esc(text)}</pre></div>`;
        else if (lang === 'chart' || lang === 'vega' || lang === 'vega-lite') out += `<div class="viz chart-src" data-src="${esc(text)}"><pre class="viz-fallback">${esc(text)}</pre></div>`;
        else if (lang === 'math' || lang === 'katex') out += `<div class="viz math-block" data-src="${esc(text)}">${esc(text)}</div>`;
        else out += `<pre class="code"${lang ? ` data-lang="${esc(lang)}"` : ''}><code${lang ? ` class="language-${esc(lang)}"` : ''}>${esc(text)}</code></pre>`;
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

  return { md, inline, esc, loadScript, loadCss, CALLOUT };
});
