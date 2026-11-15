/* natively · Markdown-Darstellung
   Eigener, kleiner Renderer: Überschriften, Absätze, Listen (verschachtelt, Aufgaben), Tabellen,
   Code, Zitate, Trennlinien, Bilder und Links. Links auf andere MD-Dateien werden aufgelöst.
   Braucht zur Laufzeit: resolveLink(file, href) und icon(name) aus app.js. */

const ESC = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
const esc = s => String(s).replace(/[&<>"']/g, c => ESC[c]);
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stripInline = s => s.replace(/`([^`]*)`/g, '$1').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|__|\*/g, '');
const stripLine = l => stripInline(l.replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, ''))
  .replace(/\|/g, ' ').replace(/^\s*-{3,}\s*$/, '')
  .replace(/<\/?(p|div|span|img|a|br|hr|picture|source|b|i|u|strong|em|details|summary|sup|sub|table|thead|tbody|tr|td|th|ul|ol|li|h[1-6]|center|kbd)\b[^>]*>/gi, '')
  .replace(/\s+/g, ' ').trim();
/* Nur diese Link-Arten dürfen nach außen öffnen (kein javascript:, data:, file: …) */
const safeExternal = u => /^(https?:|mailto:)/i.test(String(u || '').trim());
/* Webadresse erkennen und vervollständigen: „www.x.de“, „x.de/kontakt“, „https://…“ → https-Link, „a@b.de“ → mailto. Sonst null. */
const WEB_TLD = /\.(de|com|org|net|io|ai|app|dev|co|eu|at|ch|info|me|so|link|xyz|uk|us|fr|nl|it|es|tv|gg|page|site|online|shop|store|tech|cloud|studio|design|edu|gov)$/i;
function webURL(s){
  s = String(s || '').trim();
  if (!s || /\s/.test(s)) return null;
  if (/^https?:\/\//i.test(s)) return /^https?:\/\/[^/\s]+\.[^/\s]+/i.test(s) ? s : null;
  if (/^mailto:/i.test(s)) return s;
  if (/^[^@/]+@[^@/]+\.[a-z]{2,}$/i.test(s)) return 'mailto:' + s;
  if (/^www\.[^/]+\.[a-z]{2,}/i.test(s)) return 'https://' + s;
  const host = s.split(/[/?#]/)[0];
  if (/^[\w-]+(\.[\w-]+)+$/.test(host) && WEB_TLD.test(host) && !/\.(md|markdown|mdown)$/i.test(s.split(/[?#]/)[0])) return 'https://' + s;
  return null;
}
const slug = t => stripInline(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'abschnitt';

function mdFmt(s){
  return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/~~(.+?)~~/g, '<del>$1</del>')
          .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<em>$2</em>')
          .replace(/(^|[^\w])_(?!\s)(.+?)_(?!\w)/g, '$1<em>$2</em>');
}

function mdInline(src, file){
  const ph = [];
  const hold = h => { ph.push(h); return '\u0001' + (ph.length - 1) + '\u0002'; };
  let s = src.replace(/`([^`]+)`/g, (m, c) => hold('<code>' + esc(c) + '</code>'));
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, alt, h) => {
    const r = file ? resolveLink(file, h) : { external:webURL(h) || h };
    const local = p => typeof localFileURL === 'function' ? localFileURL(p) : 'file://' + encodeURI(p);
    const url = r && r.local ? local(r.local) : r && r.file ? local(r.file.abs) : r && r.external && /^(https?:|data:image\/)/i.test(r.external) ? r.external : '';
    return url ? hold(`<img src="${esc(url)}" alt="${esc(alt)}" loading="lazy">`) : hold(esc(m));
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, t, h) => {
    const inner = mdFmt(esc(t));
    const r = file ? resolveLink(file, h) : { external:webURL(h) || h };
    if (!r) return hold(inner);
    if (r.file) return hold(`<a href="#" class="mdlink" data-open="${esc(r.file.id)}" title="${esc(r.file.abs)}">${inner}</a>`);
    if (r.missing) return hold(`<span class="mdlink missing" title="${esc(typeof t === 'function' ? t('link.missing', { path:r.missing }) : 'Nicht gefunden: ' + r.missing)}">${inner}</span>`);
    if (r.local) return hold(`<a href="#" class="mdlink" data-ext="${esc(r.local)}" title="${esc(r.local)}">${inner}</a>`);
    if (r.anchor) return hold(`<a href="#" data-jump="${esc(slug(r.anchor))}">${inner}</a>`);
    if (!safeExternal(r.external)) return hold(`<span class="mdlink missing" title="${esc(r.external)}">${inner}</span>`);
    return hold(`<a href="#" data-url="${esc(r.external)}" title="${esc(r.external)}">${inner}</a>`);
  });
  // Nackte Adressen im Text (https://… oder www.…) werden klickbar
  s = s.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<>()]*[^\s<>().,;:!?'"])/gi, (m, pre, u) => { const w = webURL(u); return w ? pre + hold(`<a href="#" data-url="${esc(w)}" title="${esc(w)}">${esc(u)}</a>`) : m; });
  s = s.replace(/<(https?:\/\/[^>\s]+)>/g, (m, u) => hold(`<a href="#" data-url="${esc(u)}">${esc(u)}</a>`));
  s = mdFmt(esc(s));
  for (let n = 0; n < 3 && /\u0001\d+\u0002/.test(s); n++) s = s.replace(/\u0001(\d+)\u0002/g, (m, i) => ph[+i]);
  return s;
}

function mdTable(rows, file){
  const cells = r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  const head = cells(rows[0]);
  const body = rows.slice(2).map(cells);
  let h = `<div class="tablewrap"><button class="iconbtn tbl-expand" data-act="expand-table" title="${typeof t === 'function' ? t('table.expand') : 'Tabelle vergrößern'}" aria-label="${typeof t === 'function' ? t('table.expand') : 'Tabelle vergrößern'}">${icon('expand')}</button><div class="tablescroll"><table>`;
  if (!head.every(c => !c)) h += '<thead><tr>' + head.map(c => `<th>${mdInline(c, file)}</th>`).join('') + '</tr></thead>';
  h += '<tbody>' + body.map(r => '<tr>' + r.map(c => `<td>${mdInline(c, file)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div></div>';
  return h;
}

/* base = Zeile im Quelltext, in der die Liste beginnt (nur oberste Ebene). Aufgaben bekommen dann data-ln,
   damit ein Klick auf das Kästchen genau diese Zeile umschalten kann. */
function mdList(lines, file, base){
  const raw = lines.map((l, k) => {
    const m = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    return m ? { ind:m[1].replace(/\t/g, '    ').length, ord:/\d/.test(m[2]), text:m[3], ln:base == null ? null : base + k } : { cont:true, text:l.trim() };
  });
  const its = [];
  raw.forEach(it => { if (it.cont && its.length) its[its.length - 1].text += ' ' + it.text; else if (!it.cont) its.push(it); });
  let idx = 0;
  function build(ind){
    const ord = its[idx].ord;
    let h = ord ? '<ol>' : '<ul>';
    while (idx < its.length && its[idx].ind >= ind) {
      const it = its[idx];
      if (it.ind > ind) { h += build(it.ind); continue; }
      idx++;
      let t = it.text, cls = '', pre = '';
      const tm = t.match(/^\[([ xX])\]\s+(.*)$/);
      if (tm) { const done = tm[1] !== ' '; cls = ` class="task${done ? ' done' : ''}"${it.ln == null ? '' : ` data-ln="${it.ln}"`}`; pre = `<span class="tbox" aria-hidden="true">${done ? icon('check') : ''}</span>`; t = tm[2]; }
      h += `<li${cls}>${pre}${tm ? '<span>' + mdInline(t, file) + '</span>' : mdInline(t, file)}`;
      if (idx < its.length && its[idx].ind > ind) h += build(its[idx].ind);
      h += '</li>';
    }
    return h + (ord ? '</ol>' : '</ul>');
  }
  return its.length ? build(its[0].ind) : '';
}

/** Liefert { html, heads } für einen Markdown-Text. */
function renderMd(src, file, nested){
  let text = (src || '').replace(/\r/g, '');
  // YAML-Frontmatter am Anfang überspringen
  const fm = text.match(/^---\n[\s\S]*?\n---\n/);
  const off = fm ? fm[0].split('\n').length - 1 : 0;
  if (fm) text = text.slice(fm[0].length);
  const L = text.split('\n');
  const out = [], heads = [], seen = {};
  let i = 0;
  // Oberste Blöcke bekommen data-l="von-bis" (Zeilen im Quelltext), damit der Editor weiß, welche Zeilen ein Block ist
  let start = 0;
  const push = out.push.bind(out);
  out.push = h => push(nested ? h : h.replace(/^<([a-z0-9]+)/i, `<$1 data-l="${start + off}-${Math.max(start, i - 1) + off}"`));
  const isList = l => /^\s*([-*+]|\d+[.)])\s+/.test(l);
  while (i < L.length) {
    const line = L[i];
    let m;
    start = i;
    if (/^\s*$/.test(line)) { i++; continue; }
    if (/^\s*(```|~~~)/.test(line)) {
      const fence = line.trim().slice(0, 3);
      const buf = []; i++;
      while (i < L.length && !L[i].trim().startsWith(fence)) { buf.push(L[i]); i++; }
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      const lvl = m[1].length, t = m[2].replace(/\s+#+\s*$/, '');
      let id = slug(t);
      if (seen[id]) id += '-' + (++seen[id]); else seen[id] = 1;
      heads.push({ lvl, text:stripInline(t), id });
      out.push(`<h${lvl} id="${id}">${mdInline(t, file)}</h${lvl}>`);
      i++; continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^\s*<!--/.test(line)) { while (i < L.length && !/-->/.test(L[i])) i++; i++; continue; }
    // Reine HTML-Zeilen (z. B. <p align="center"> in READMEs) nicht als Text zeigen
    if (/^\s*<\/?[a-zA-Z][^>]*>\s*$/.test(line)) { i++; continue; }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < L.length && /^>\s?/.test(L[i])) { buf.push(L[i].replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote>${renderMd(buf.join('\n'), file, true).html}</blockquote>`);
      continue;
    }
    if (/^\s*\|/.test(line) && i + 1 < L.length && /^\s*\|?\s*:?-{2,}/.test(L[i + 1])) {
      const rows = [];
      while (i < L.length && /^\s*\|/.test(L[i])) { rows.push(L[i]); i++; }
      out.push(mdTable(rows, file));
      continue;
    }
    if (isList(line)) {
      const buf = [];
      while (i < L.length && (isList(L[i]) || /^\s{2,}\S/.test(L[i]))) { buf.push(L[i]); i++; }
      out.push(mdList(buf, file, nested ? null : start + off));
      continue;
    }
    const buf = [];
    while (i < L.length && !/^\s*$/.test(L[i]) && !/^(#{1,6}\s|\s*```|\s*~~~|>|\s*\|)/.test(L[i]) && !isList(L[i]) && !/^\s*-{3,}\s*$/.test(L[i])) { buf.push(L[i].trim()); i++; }
    if (!buf.length) { buf.push(line.trim()); i++; }
    out.push(`<p>${mdInline(buf.join(' '), file)}</p>`);
  }
  return { html:out.join('\n'), heads };
}

if (typeof module !== 'undefined') module.exports = { renderMd, stripLine, stripInline, slug, esc, safeExternal, webURL };
