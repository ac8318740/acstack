// measure.js: mechanical UI checks, run inside the page.
//
//   agent-browser eval --stdin < measure.js          -> static report for <body>
//   agent-browser eval "acstackMeasure.run({scope: '#panel'})"
//   agent-browser eval "acstackMeasure.snapshot()"   -> record boxes
//   (change state: click, type, toggle)
//   agent-browser eval "acstackMeasure.jiggle({allow: ['.toast']})"
//
// Every finding is {rule, selector, actual, expected}. No dependencies.
(() => {
  const TOL = 0.5; // px rounding slack
  const px = (v) => Math.round(parseFloat(v) * 100) / 100;
  const near = (a, b) => Math.abs(a - b) <= TOL;

  function cssPath(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const tid = el.getAttribute('data-testid');
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) {
      if (n.id) { parts.unshift(`#${CSS.escape(n.id)}`); break; }
      let part = n.tagName.toLowerCase();
      const cls = [...n.classList].slice(0, 2).map((c) => `.${CSS.escape(c)}`).join('');
      part += cls;
      const p = n.parentElement;
      if (p) {
        const same = [...p.children].filter((c) => c.tagName === n.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(n) + 1})`;
      }
      parts.unshift(part);
    }
    const path = parts.join(' > ') || el.tagName.toLowerCase();
    return tid ? `${path} [data-testid="${tid}"]` : path;
  }

  function visible(el) {
    if (!el.getClientRects().length) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  }

  function elements(scope) {
    const root = typeof scope === 'string' ? document.querySelector(scope) : scope || document.body;
    if (!root) throw new Error(`measure: no element matches scope ${scope}`);
    return [root, ...root.querySelectorAll('*')].filter((el) =>
      !['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'BR'].includes(el.tagName) && visible(el));
  }

  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());

  // Tokens: custom properties declared on :root or html, resolved to px through a probe.
  function tokens() {
    const names = new Set();
    const walk = (rules) => {
      for (const r of rules) {
        if (r.cssRules && !r.selectorText) { walk(r.cssRules); continue; }
        if (!r.selectorText || !/(^|,)\s*(:root|html)\s*(,|$)/.test(r.selectorText)) continue;
        for (const p of r.style) if (p.startsWith('--')) names.add(p);
      }
    };
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules); } catch { /* cross-origin sheet: unreadable */ }
    }
    const rootStyle = getComputedStyle(document.documentElement);
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
    document.body.appendChild(probe);
    const out = [];
    for (const name of names) {
      const raw = rootStyle.getPropertyValue(name).trim();
      probe.style.width = '';
      probe.style.width = `var(${name})`;
      const w = getComputedStyle(probe).width;
      // Colors and unitless numbers are not lengths; CSS.supports rejects them.
      const length = CSS.supports('width', raw) && !/^\s*[\d.]+\s*$/.test(raw) && /px$/.test(w) ? px(w) : null;
      out.push({ name, raw, length });
    }
    probe.remove();
    return out;
  }

  function scales(toks) {
    const lengths = (re) => {
      const named = toks.filter((t) => t.length !== null && re.test(t.name)).map((t) => t.length);
      return named.length ? named : null;
    };
    const family = (s) => s.split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();
    const families = toks.filter((t) => /font|family/i.test(t.name) && t.length === null && /[a-z]/i.test(t.raw) && !/weight/i.test(t.name)).map((t) => family(t.raw));
    const weights = toks.filter((t) => /weight/i.test(t.name) && /^\d+$/.test(t.raw)).map((t) => +t.raw);
    const anyLength = toks.filter((t) => t.length !== null).map((t) => t.length);
    return {
      fontSize: lengths(/font-?size|text|type|fs\b/i) || (anyLength.length ? anyLength : null),
      spacing: lengths(/space|spacing|gap|pad|margin|inset|gutter|sp-/i) || (anyLength.length ? anyLength : null),
      family: families.length ? families : null,
      weight: weights.length ? weights : null,
      familyOf: family,
    };
  }

  // Without tokens, the page's frequent values form the scale (used by 2+ elements).
  function frequentScale(values) {
    const counts = new Map();
    for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
    return [...counts].filter(([, c]) => c >= 2).map(([v]) => v);
  }
  // An empty scale (no tokens, nothing repeated) has no baseline to judge against.
  const inScale = (v, scale) => !scale.length || scale.some((s) => typeof s === 'number' ? near(v, s) : s === v);

  function rgba(color) {
    const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    c.clearRect(0, 0, 1, 1);
    c.fillStyle = color;
    c.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = c.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  }
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  function background(el) {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage !== 'none') return null; // gradient or image: cannot judge
      const c = rgba(s.backgroundColor);
      if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
    }
    let out = [255, 255, 255];
    for (const [r, g, b, a] of layers.reverse()) out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)];
    return out;
  }

  // Words of the last rendered line of el's own text.
  function lastLineWords(el) {
    const words = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const re = /\S+/g;
      let m;
      while ((m = re.exec(n.textContent))) {
        const range = document.createRange();
        range.setStart(n, m.index);
        range.setEnd(n, m.index + m[0].length);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0);
        if (rects.length) words.push({ word: m[0], top: rects[rects.length - 1].top });
      }
    }
    if (!words.length) return null;
    const tops = [...new Set(words.map((w) => Math.round(w.top)))].sort((a, b) => a - b);
    const lines = [];
    for (const t of tops) if (!lines.length || t - lines[lines.length - 1] > 2) lines.push(t);
    if (lines.length < 2) return null;
    const last = lines[lines.length - 1];
    return words.filter((w) => Math.round(w.top) >= last - 2).map((w) => w.word);
  }

  const INTERACTIVE = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=tab],[role=menuitem],[tabindex]:not([tabindex="-1"])';
  const role = (el) => `${el.tagName}|${[...el.classList].sort().join('.')}|${el.getAttribute('role') || ''}`;

  function run(opts = {}) {
    const els = elements(opts.scope);
    const toks = tokens();
    const sc = scales(toks);
    const v = [];
    const add = (rule, el, actual, expected) => v.push({ rule, selector: cssPath(el), actual, expected });
    const textEls = els.filter(ownText);
    const style = new Map(els.map((el) => [el, getComputedStyle(el)]));

    // 1. Type. Fallback scales come from the whole page, so a small scope is not its own baseline.
    const pageText = elements(document.body).filter(ownText).map((el) => getComputedStyle(el));
    const sizeOf = (s) => px(s.fontSize);
    const famOf = (s) => sc.familyOf(s.fontFamily);
    const weightOf = (s) => +s.fontWeight;
    const sizes = textEls.map((el) => sizeOf(style.get(el)));
    const fams = textEls.map((el) => famOf(style.get(el)));
    const weights = textEls.map((el) => weightOf(style.get(el)));
    const sizeScale = sc.fontSize || frequentScale(pageText.map(sizeOf));
    const famScale = sc.family || frequentScale(pageText.map(famOf));
    const weightScale = sc.weight || frequentScale(pageText.map(weightOf));
    const scaleNote = (fromTokens) => fromTokens ? 'token scale' : 'values used by 2+ elements';
    textEls.forEach((el, i) => {
      if (!inScale(sizes[i], sizeScale)) add('type-size', el, `${sizes[i]}px`, `one of ${[...new Set(sizeScale)].sort((a, b) => a - b).join(', ')}px (${scaleNote(sc.fontSize)})`);
      if (!inScale(fams[i], famScale)) add('type-family', el, fams[i], `one of ${[...new Set(famScale)].join(', ')} (${scaleNote(sc.family)})`);
      if (!inScale(weights[i], weightScale)) add('type-weight', el, weights[i], `one of ${[...new Set(weightScale)].join(', ')} (${scaleNote(sc.weight)})`);
    });

    // 2. Spacing (horizontal margins skipped: auto margins compute to arbitrary px)
    const SPACING = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginBottom', 'rowGap', 'columnGap'];
    const spacingOf = (list, st) => {
      const out = [];
      for (const el of list) for (const p of SPACING) {
        const val = Math.abs(px(st(el)[p]));
        if (val > 0) out.push([el, p, val]);
      }
      return out;
    };
    const spacingValues = spacingOf(els, (el) => style.get(el));
    const spaceScale = sc.spacing || frequentScale(spacingOf(elements(document.body), getComputedStyle).map((x) => x[2]));
    for (const [el, p, val] of spacingValues) {
      if (!inScale(val, spaceScale)) add('spacing', el, `${p}: ${val}px`, `one of ${[...new Set(spaceScale)].sort((a, b) => a - b).join(', ')}px (${scaleNote(sc.spacing)})`);
    }

    // 3 and 4. Siblings and edges
    const parents = new Set(els.map((el) => el.parentElement).filter(Boolean));
    for (const parent of parents) {
      const kids = [...parent.children].filter((c) => style.has(c) && !['absolute', 'fixed'].includes(style.get(c).position));
      const groups = new Map();
      for (const k of kids) groups.set(role(k), [...(groups.get(role(k)) || []), k]);
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        const pad = (k) => ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map((p) => px(style.get(k)[p])).join(' ');
        const mode = (vals) => { const c = new Map(); vals.forEach((x) => c.set(x, (c.get(x) || 0) + 1)); return [...c].sort((a, b) => b[1] - a[1])[0][0]; };
        const pads = group.map(pad);
        const common = mode(pads);
        group.forEach((k, i) => { if (pads[i] !== common) add('sibling-padding', k, pads[i], common); });
        // Height only for siblings sharing a row: stacked rows may hold different content.
        const rows = new Map();
        for (const k of group) { const t = Math.round(k.getBoundingClientRect().top); rows.set(t, [...(rows.get(t) || []), k]); }
        for (const row of rows.values()) {
          if (row.length < 2) continue;
          const hs = row.map((k) => px(k.getBoundingClientRect().height));
          const h = mode(hs);
          row.forEach((k, i) => { if (!near(hs[i], h)) add('sibling-height', k, `${hs[i]}px`, `${h}px`); });
        }
      }
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i].getBoundingClientRect(); const b = kids[j].getBoundingClientRect();
        for (const edge of ['left', 'right']) {
          const d = Math.abs(a[edge] - b[edge]);
          if (d > TOL && d <= 4) add('edge', kids[j], `${edge} ${px(b[edge])}px`, `${px(a[edge])}px, shared with ${cssPath(kids[i])}`);
        }
      }
    }

    // 5. Lone last-line word
    for (const el of textEls) {
      if (style.get(el).display.startsWith('inline')) continue;
      const last = lastLineWords(el);
      if (last && last.length === 1) add('lone-word', el, `last line "${last[0]}"`, 'two or more words on the last line');
    }

    // 6. Contrast and targets
    for (const el of textEls) {
      const s = style.get(el);
      const fg = rgba(s.color);
      const bg = background(el);
      if (!bg || fg[3] === 0) continue;
      const fgBlend = fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3]));
      const [l1, l2] = [lum(fgBlend), lum(bg)].sort((a, b) => b - a);
      const ratio = Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
      const size = px(s.fontSize);
      const large = size >= 24 || (size >= 18.66 && +s.fontWeight >= 700);
      const need = large ? 3 : 4.5;
      if (ratio < need) add('contrast', el, `${ratio}:1`, `>= ${need}:1 (WCAG AA)`);
    }
    for (const el of els.filter((e) => e.matches(INTERACTIVE))) {
      if (style.get(el).display === 'inline' && el.tagName === 'A') continue; // inline links are exempt
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 24) add('target-size', el, `${px(r.width)}x${px(r.height)}px`, 'at least 24x24px');
    }

    return {
      tokens: toks.length,
      scale: { fontSize: sizeScale, spacing: spaceScale, family: famScale, weight: weightScale, fromTokens: !!(sc.fontSize || sc.spacing) },
      distinctFontSizes: [...new Set(sizes)].sort((a, b) => a - b),
      violations: v,
    };
  }

  // Jiggle: boxes before and after a state change, measured once motion has settled.
  let before = null;
  function boxes(scope) {
    return new Map(elements(scope).map((el) => { const r = el.getBoundingClientRect(); return [el, { x: r.left, y: r.top, w: r.width, h: r.height }]; }));
  }
  function snapshot(opts = {}) {
    before = { scope: opts.scope, boxes: boxes(opts.scope) };
    return { recorded: before.boxes.size };
  }
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  async function settle() {
    await frame(); // let transitions triggered by the change start
    const finite = document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime));
    await Promise.all(finite.map((a) => a.finished.catch(() => {})));
    await frame();
    await frame();
  }
  async function jiggle(opts = {}) {
    if (!before) throw new Error('measure: call acstackMeasure.snapshot() before the state change');
    await settle();
    const allow = (opts.allow || []).join(',');
    const after = boxes(before.scope);
    const moved = new Map();
    for (const [el, a] of before.boxes) {
      const b = after.get(el);
      if (!b) continue;
      const d = { dx: b.x - a.x, dy: b.y - a.y, dw: b.w - a.w, dh: b.h - a.h };
      if (Object.values(d).some((x) => Math.abs(x) > TOL)) moved.set(el, { a, b, d });
    }
    const v = [];
    for (const [el, { a, b, d }] of moved) {
      if (allow && el.closest(allow)) continue;
      // Report where motion starts, not every descendant carried along with a moved parent.
      const p = moved.get(el.parentElement);
      if (p && near(p.d.dx, d.dx) && near(p.d.dy, d.dy) && near(d.dw, 0) && near(d.dh, 0)) continue;
      const box = (r) => `${px(r.x)},${px(r.y)} ${px(r.w)}x${px(r.h)}`;
      v.push({ rule: 'jiggle', selector: cssPath(el), actual: box(b), expected: box(a) });
    }
    before = null;
    return { violations: v };
  }

  window.acstackMeasure = { run, snapshot, jiggle, settle };
  return run(window.ACSTACK_MEASURE_OPTIONS || {});
})();
