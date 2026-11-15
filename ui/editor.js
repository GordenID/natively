/* natively · Bearbeiten direkt im Dokument (nur Mac-App)
   - Kästchen von To-dos anklicken schaltet [ ] ↔ [x] in genau dieser Zeile um.
   - Klick auf einen Block öffnet sein Markdown zum Bearbeiten. Esc, ⌘↩ oder Klick daneben beendet.
   - Links neben jedem Block (die ganze Zeilenhöhe zählt, wie in Notion): „+“ fügt darunter ein
     (⌥-Klick: darüber), der Griff ⋮⋮ verschiebt per Ziehen, ein Klick darauf öffnet das Block-Menü
     (Umwandeln in, Duplizieren, Löschen).
   - „/“ am Zeilenanfang öffnet die Bausteine. Eingefügt wird immer reines Markdown.
   - ⌘N legt im aktuellen Ordner eine neue Datei an, der Name kommt aus dem Titel.
   - ⌘Z macht die letzte Block-Aktion rückgängig (außerhalb eines Textfelds).
   Gespeichert wird über native('save'): die Mac-App überschreibt nur, wenn die Datei noch so ist,
   wie natively sie kennt. Sonst Hinweis statt Überschreiben.
   Braucht aus app.js: native, curFile, curDir, dirAbs, byAbs, FILES, indexFile, renderContent, openFile,
   toast, t, icon, esc, S, MAC, $. */

(function(){
  if (!MAC) return;

  const SAVE_DELAY = 1000;
  /* Bausteine: snippet mit ¦ = Position des Cursors danach. pre = Zeilenanfang für „Umwandeln in“ */
  const BLOCKS = [
    { k:'text',    ic:'text',    s:'¦',                   a:'text paragraph absatz',                     pre:'' },
    { k:'h1',      ic:'h1',      s:'# ¦',                 a:'h1 heading title überschrift titel #',      pre:'# ' },
    { k:'h2',      ic:'h2',      s:'## ¦',                a:'h2 heading überschrift ##',                 pre:'## ' },
    { k:'h3',      ic:'h3',      s:'### ¦',               a:'h3 heading überschrift ###',                pre:'### ' },
    { k:'todo',    ic:'todo',    s:'- [ ] ¦',             a:'todo to-do task checkbox aufgabe check',    pre:'- [ ] ' },
    { k:'bullet',  ic:'list',    s:'- ¦',                 a:'bullet list liste aufzählung ul',           pre:'- ' },
    { k:'number',  ic:'ol',      s:'1. ¦',                a:'number numbered list nummeriert ol',        pre:'1. ' },
    { k:'table',   ic:'table',   s:null,                  a:'table tabelle grid' },
    { k:'quote',   ic:'quote',   s:'> ¦',                 a:'quote zitat blockquote',                    pre:'> ' },
    { k:'callout', ic:'callout', s:'> [!NOTE]\n> ¦',      a:'callout hinweis note info' },
    { k:'code',    ic:'code',    s:'```\n¦\n```',         a:'code snippet' },
    { k:'divider', ic:'minus',   s:'---\n¦',              a:'divider trennlinie hr line ---' },
    { k:'link',    ic:'link',    s:'',                    a:'link url verweis web www', hint:'⌘K' },
  ];
  const tableSnippet = () => { const c = t('slash.col'); return `| ${c} 1 | ${c} 2 | ${c} 3 |\n| --- | --- | --- |\n| ¦ |  |  |\n|  |  |  |`; };
  const glyph = k => ({ h1:'H1', h2:'H2', h3:'H3' })[k];
  const blockIcon = b => `<span class="sl-ic">${glyph(b.k) ? `<b>${glyph(b.k)}</b>` : icon(b.ic)}</span>`;

  let ed = null;          // laufende Bearbeitung
  const undo = [];        // { abs, before, after }

  /* ---------- Zeilen-Helfer ---------- */
  const linesOf = f => f.content.replace(/\r/g, '').split('\n');
  const blank = l => !l || !l.trim();
  const join = lines => { let s = lines.join('\n'); if (!s.endsWith('\n')) s += '\n'; return s; };
  /* ins vor Zeile p einfügen, mit genau einer Leerzeile Abstand zu den Nachbarn */
  function insertAt(lines, p, ins){
    if (!ins.length) return lines.slice();
    const before = lines.slice(0, p), after = lines.slice(p);
    let mid = ins;
    if (before.length && !blank(before[before.length - 1])) mid = [''].concat(mid);
    if (after.length && !blank(after[0])) mid = mid.concat(['']);
    return before.concat(mid, after);
  }
  /* Zeilen a..b entfernen, dabei keine doppelte Leerzeile zurücklassen. extra = zusätzlich entfernte Leerzeile */
  function removeRange(lines, a, b){
    const out = lines.slice(0, a).concat(lines.slice(b + 1));
    let extra = 0;
    if (a < out.length && blank(out[a]) && (a === 0 || blank(out[a - 1]))) { out.splice(a, 1); extra = 1; }
    return { lines:out, extra };
  }
  const range = el => el.dataset.l.split('-').map(Number);
  const topBlocks = () => { const art = $('#article'); return art ? [...art.children].filter(el => el.dataset && el.dataset.l) : []; };

  /* ---------- Speichern ---------- */
  async function write(abs, text, base, keepUndo){
    let r;
    try { r = await native('save', JSON.stringify({ abs, text, base })); }
    catch(e) { r = 'error: ' + e.message; }
    if (r === 'ok') {
      const f = byAbs[abs];
      if (f) { f.content = text; indexFile(f); }
      if (!keepUndo && base != null && base !== text) { undo.push({ abs, before:base, after:text }); if (undo.length > 50) undo.shift(); }
      return true;
    }
    toast(r === 'conflict' ? t('edit.conflict') : t('edit.failed', { msg:String(r).replace(/^error:\s*/, '') }));
    return false;
  }
  /* Ganze Datei auf neuen Text setzen und neu zeichnen */
  async function commit(f, lines){
    const sc = $('#scroller'), keep = sc ? sc.scrollTop : null;
    await write(f.abs, join(lines), f.content);
    renderContent(keep);
  }
  async function undoLast(){
    const op = undo.pop();
    if (!op) return;
    const f = byAbs[op.abs];
    if (!f || f.content !== op.after) { toast(t('edit.undoGone')); return; }
    const sc = $('#scroller'), keep = sc ? sc.scrollTop : null;
    if (await write(op.abs, op.before, op.after, true)) { toast(t('edit.undone')); const c = curFile(); if (c && c.abs === op.abs) renderContent(keep); }
  }

  /* ---------- To-dos umschalten ---------- */
  async function toggleTask(li){
    const f = curFile();
    if (!f || f.content == null) return;
    const n = +li.dataset.ln;
    const lines = linesOf(f);
    const m = (lines[n] || '').match(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\].*)$/);
    if (!m) return;
    lines[n] = m[1] + (m[2] === ' ' ? 'x' : ' ') + m[3];
    li.classList.toggle('done', m[2] === ' ');   // sofort sichtbar, Neuzeichnen folgt
    const box = li.querySelector('.tbox');
    if (box) box.innerHTML = m[2] === ' ' ? icon('check') : '';
    const sc = $('#scroller'), keep = sc ? sc.scrollTop : null;
    await write(f.abs, lines.join('\n'), f.content);
    renderContent(keep);
  }

  /* ---------- Block bearbeiten ---------- */
  /* a..b = Zeilen des Blocks. insert: neuer Block vor Zeile a (nichts wird ersetzt), above: Textfeld über el */
  function startEdit(f, a, b, el, insert, withSlash, above){
    if (ed) finish();
    closeBlockMenu();
    const base = f.content.replace(/\r/g, '');
    const baseLines = base.split('\n');
    const ta = document.createElement('textarea');
    ta.className = 'ed-block';
    ta.rows = 1;
    ta.spellcheck = true;
    ta.placeholder = t('edit.hint');
    ta.value = insert ? '' : baseLines.slice(a, b + 1).join('\n');
    ta.dataset.kind = el && !insert ? el.tagName.toLowerCase() : 'p';
    if (insert) { if (el) (above ? el.before(ta) : el.after(ta)); else $('#article .ed-tail').before(ta); }
    else el.replaceWith(ta);
    ed = { abs:f.abs, a, b, insert, baseLines, ta, start:base, last:base, timer:null };
    grow(ta); ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.addEventListener('input', onInput);
    ta.addEventListener('keydown', onKey);
    ta.addEventListener('blur', () => setTimeout(() => { if (ed && ed.ta === ta && !ed.prompt && document.activeElement !== ta) finish(); }, 0));
    ta.addEventListener('paste', onPaste);
    hideGutter(true);
    if (withSlash) { ta.value = '/'; ta.setSelectionRange(1, 1); slashUpdate(); }
  }
  function compose(cur = ed){
    const { a, b, insert, baseLines, ta } = cur;
    const v = ta.value.replace(/\s+$/, '');
    const ins = v ? v.split('\n').map(fixLinks) : [];
    if (insert) return join(insertAt(baseLines, a, ins));
    const rest = ins.length ? baseLines.slice(0, a).concat(baseLines.slice(b + 1)) : removeRange(baseLines, a, b).lines;
    return join(ins.length ? insertAt(rest, a, ins) : rest);
  }
  /* Speichert nacheinander, nie zwei gleichzeitig (sonst hält der zweite den ersten für eine fremde Änderung) */
  async function flush(){
    if (!ed) return;
    const cur = ed;
    clearTimeout(cur.timer);
    while (cur.saving) await cur.saving;
    const text = compose(cur);
    if (text === cur.last) return;
    cur.saving = write(cur.abs, text, cur.last, true).then(ok => { if (ok) cur.last = text; cur.saving = null; });
    await cur.saving;
  }
  async function finish(){
    if (!ed || ed.finishing) return;
    slashClose();
    const cur = ed;
    cur.finishing = true;
    await flush();
    if (cur.last !== cur.start) { undo.push({ abs:cur.abs, before:cur.start, after:cur.last }); if (undo.length > 50) undo.shift(); }
    if (ed !== cur) return;
    ed = null;
    const sc = $('#scroller'), keep = sc ? sc.scrollTop : null;
    renderContent(keep);
  }
  function onInput(){
    grow(ed.ta);
    slashUpdate();
    clearTimeout(ed.timer);
    ed.timer = setTimeout(flush, SAVE_DELAY);
  }
  function grow(ta){ ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; }

  /* Listen fortsetzen wie in Notion: ↩ in einer To-do-/Listenzeile beginnt die nächste, ↩ in einer leeren beendet die Liste */
  function continueList(e){
    const ta = ed.ta, pos = ta.selectionStart;
    if (pos !== ta.selectionEnd) return false;
    const v = ta.value, ls = v.lastIndexOf('\n', pos - 1) + 1;
    const le = v.indexOf('\n', pos) < 0 ? v.length : v.indexOf('\n', pos);
    const line = v.slice(ls, le);
    const m = line.match(/^(\s*)([-*+]\s+\[[ xX]\]\s|[-*+]\s|(\d+)([.)])\s|>\s?)(.*)$/);
    if (!m) return false;
    e.preventDefault();
    if (!m[5].trim()) ta.setRangeText('', ls, le, 'end');   // leere Zeile: Liste beenden
    else {
      let next = m[2];
      if (/\[[ xX]\]/.test(next)) next = next.replace(/\[[xX]\]/, '[ ]');
      if (m[3]) next = (+m[3] + 1) + m[4] + ' ';
      ta.setRangeText('\n' + m[1] + next, pos, pos, 'end');
    }
    onInput();
    return true;
  }
  function onKey(e){
    if (slash && slashKey(e)) return;
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); e.stopPropagation(); ed.ta.blur(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {   // ⌘K: markierter Text wird zum Link
      e.preventDefault();
      const ta = ed.ta;
      linkPrompt(ta.selectionStart, ta.selectionEnd, ta.value.slice(ta.selectionStart, ta.selectionEnd));
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) continueList(e);
  }

  /* ---------- Links ---------- */
  /* [Text](www.x.de) → [Text](https://www.x.de). Dateipfade und Anker bleiben, wie sie sind. */
  function fixLinks(line){
    return line.replace(/(\]\()([^)\s]+)(\))/g, (m, a, h, z) => {
      if (/^[a-z][a-z0-9+.-]*:|^#|^\.|^\/|^~/i.test(h)) return m;
      const w = webURL(h);
      return w ? a + w + z : m;
    });
  }
  const linkLabel = u => u.replace(/^(https?:\/\/|mailto:)/i, '').replace(/\/$/, '');
  /* Adresse einfügen und ein markierter Text wird zum Link */
  function onPaste(e){
    const txt = (e.clipboardData && e.clipboardData.getData('text/plain') || '').trim();
    const w = webURL(txt);
    if (!w) return;
    const ta = ed.ta, a = ta.selectionStart, b = ta.selectionEnd;
    const sel = ta.value.slice(a, b);
    e.preventDefault();
    ta.setRangeText(sel.trim() ? `[${sel}](${w})` : `[${linkLabel(txt)}](${w})`, a, b, 'end');
    onInput();
  }
  /* Kleines Feld für die Adresse (wie in Notion): nur Link einfügen, ↩, fertig */
  function linkPrompt(from, to, label){
    const ta = ed.ta, cur = ed;
    cur.prompt = true;
    const box = document.createElement('div');
    box.className = 'menu linkbox';
    box.innerHTML = `<div class="lb-row">${icon('link')}<input type="text" spellcheck="false" placeholder="${esc(t('link.placeholder'))}"></div><div class="lb-hint">${esc(t('link.hint'))}</div>`;
    document.body.appendChild(box);
    const r = ta.getBoundingClientRect(), lines = ta.value.slice(0, from).split('\n').length;
    box.style.left = Math.max(8, Math.min(innerWidth - box.offsetWidth - 8, r.left)) + 'px';
    const top = r.top + 8 + lines * 22 + 6;
    box.style.top = (top + box.offsetHeight > innerHeight - 8 ? Math.max(8, r.top - box.offsetHeight - 6) : top) + 'px';
    const input = box.querySelector('input'), hint = box.querySelector('.lb-hint');
    let done = false;
    const close = back => {
      if (done) return; done = true;
      box.remove(); cur.prompt = false;
      if (ed !== cur) return;
      if (back) { ta.focus(); }
      else setTimeout(() => { if (ed === cur && document.activeElement !== ta) finish(); }, 0);
    };
    input.addEventListener('input', () => {
      const w = webURL(input.value);
      hint.textContent = !input.value.trim() ? t('link.hint') : w ? '→ ' + w : t('link.invalid');
      hint.classList.toggle('bad', !!input.value.trim() && !w);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); ta.setSelectionRange(to, to); return; }
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault(); e.stopPropagation();
      const w = webURL(input.value);
      if (!w) { hint.textContent = t('link.invalid'); hint.classList.add('bad'); return; }
      const text = `[${label.trim() ? label : linkLabel(input.value.trim())}](${w})`;
      close(true);
      ta.setRangeText(text, from, to, 'end');
      onInput();
    });
    input.addEventListener('blur', () => setTimeout(() => { if (!done && document.activeElement !== input) close(false); }, 0));
    input.focus();
  }

  /* ---------- Bausteine-Menü „/“ ---------- */
  let slash = null;   // { el, from, items, sel }
  function slashQuery(){
    const ta = ed.ta, pos = ta.selectionStart;
    if (pos !== ta.selectionEnd) return null;
    const ls = ta.value.lastIndexOf('\n', pos - 1) + 1;
    const m = ta.value.slice(ls, pos).match(/^\/([^\s/]{0,20})$/);
    return m ? { from:ls, q:m[1].toLowerCase() } : null;
  }
  function slashUpdate(){
    const sq = ed && slashQuery();
    if (!sq) { slashClose(); return; }
    const items = BLOCKS.filter(b => !sq.q || (t('slash.' + b.k).toLowerCase() + ' ' + b.a).includes(sq.q));
    if (!slash) {
      const el = document.createElement('div');
      el.className = 'menu slash';
      el.setAttribute('role', 'listbox');
      el.addEventListener('mousedown', e => e.preventDefault());   // Fokus bleibt im Textfeld
      el.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) slashApply(b.dataset.k); else if (e.target.closest('[data-close]')) slashClose(); });
      el.addEventListener('mousemove', e => { const b = e.target.closest('[data-i]'); if (b && +b.dataset.i !== slash.sel) { slash.sel = +b.dataset.i; slashMark(); } });
      document.body.appendChild(el);
      slash = { el, sel:0 };
    }
    slash.from = sq.from;
    if (slash.q !== sq.q) slash.sel = 0;
    slash.q = sq.q; slash.items = items;
    slash.el.innerHTML = `<div class="sl-head">${esc(t('slash.basic'))}</div>` + (items.length
      ? items.map((b, i) => `<button role="option" data-k="${b.k}" data-i="${i}">${blockIcon(b)}${esc(t('slash.' + b.k))}<small>${esc(b.hint || (b.s || '').split('\n')[0].replace('¦', '').trim())}</small></button>`).join('')
      : `<div class="sl-empty">${esc(t('edit.noMatch'))}</div>`)
      + `<hr><button data-close class="sl-close">${esc(t('slash.close'))}<small>esc</small></button>`;
    slashMark();
    slashPlace();
  }
  function slashMark(){
    slash.el.querySelectorAll('[data-i]').forEach(b => b.classList.toggle('on', +b.dataset.i === slash.sel));
    const on = slash.el.querySelector('.on');
    if (on) on.scrollIntoView({ block:'nearest' });
  }
  function slashPlace(){
    const r = ed.ta.getBoundingClientRect();
    const lineH = 22, lines = ed.ta.value.slice(0, ed.ta.selectionStart).split('\n').length;
    const top = Math.min(r.top + 8 + lines * lineH, r.bottom) + 6;
    const h = slash.el.offsetHeight;
    slash.el.style.left = Math.max(8, Math.min(innerWidth - slash.el.offsetWidth - 8, r.left)) + 'px';
    slash.el.style.top = (top + h > innerHeight - 8 ? Math.max(8, r.top + 8 + (lines - 1) * lineH - h - 6) : top) + 'px';
  }
  function slashClose(){ if (slash) { slash.el.remove(); slash = null; } }
  function slashKey(e){
    const n = slash.items.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (n) { slash.sel = (slash.sel + 1) % n; slashMark(); } return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); if (n) { slash.sel = (slash.sel - 1 + n) % n; slashMark(); } return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { if (!n) { slashClose(); return false; } e.preventDefault(); slashApply(slash.items[slash.sel].k); return true; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); slashClose(); return true; }
    return false;
  }
  function slashApply(k){
    const b = BLOCKS.find(x => x.k === k);
    if (!b || !slash) return;
    const ta = ed.ta, pos = ta.selectionStart;
    if (k === 'link') { const from = slash.from; slashClose(); ta.setRangeText('', from, pos, 'start'); onInput(); linkPrompt(from, from, ''); return; }
    const snip = b.s == null ? tableSnippet() : b.s;
    const at = snip.indexOf('¦');
    ta.setRangeText(snip.replace('¦', ''), slash.from, pos, 'start');
    const c = slash.from + at;
    ta.setSelectionRange(c, c);
    slashClose();
    ta.focus();
    onInput();
  }

  /* ---------- Leiste links: „+“ und Griff ⋮⋮ ---------- */
  /* Wie in Notion zählt die ganze Zeilenhöhe eines Blocks, von ganz links bis rechts.
     So bleibt die Leiste da, wenn man in derselben Höhe nach links zum „+“ fährt. */
  let gut = null, gutBlock = null, frozen = false;
  function makeGutter(){
    gut = document.createElement('div');
    gut.className = 'ed-gut';
    gut.innerHTML = `<button class="ed-plus" data-tip="plus">${icon('plus')}</button><button class="ed-grip" data-tip="grip">${icon('grip')}</button>`;
    gut.addEventListener('mousedown', e => e.preventDefault());
    gut.querySelector('.ed-plus').addEventListener('click', e => {
      e.stopPropagation();
      const f = curFile();
      if (!f || !gutBlock || !gutBlock.isConnected) return;
      const [a, b] = range(gutBlock);
      hideTip();
      if (e.altKey) startEdit(f, a, a - 1, gutBlock, true, true, true);
      else startEdit(f, b + 1, b, gutBlock, true, true);
    });
    gut.querySelector('.ed-grip').addEventListener('mousedown', gripDown);
    gut.addEventListener('mouseover', e => { const b = e.target.closest('[data-tip]'); if (b) showTip(b); });
    gut.addEventListener('mouseout', e => { const b = e.target.closest('[data-tip]'); if (b && !b.contains(e.relatedTarget)) hideTip(); });
  }
  function showGutter(block){
    const art = $('#article');
    if (!art) return;
    if (!gut) makeGutter();
    if (gut.parentElement !== art) art.appendChild(gut);
    gutBlock = block;
    const ar = art.getBoundingClientRect(), br = block.getBoundingClientRect();
    const first = block.matches('ul,ol,blockquote') ? block.firstElementChild || block : block;
    const lh = parseFloat(getComputedStyle(first).lineHeight) || 24;
    const fr = first.getBoundingClientRect();
    gut.style.top = (fr.top - ar.top + Math.min(lh, fr.height || br.height) / 2 - 12) + 'px';
    gut.hidden = false;
  }
  function hideGutter(force){
    if (frozen && !force) return;
    if (gut) gut.hidden = true;
    gutBlock = null;
    hideTip();
  }
  /* Block, in dessen Höhe die Maus steht (Abstände zwischen Blöcken werden halb-halb verteilt) */
  function blockAtY(y){
    const blocks = topBlocks();
    for (let i = 0; i < blocks.length; i++) {
      const r = blocks[i].getBoundingClientRect();
      const prev = i ? blocks[i - 1].getBoundingClientRect().bottom : r.top - 8;
      const next = i < blocks.length - 1 ? blocks[i + 1].getBoundingClientRect().top : r.bottom + 8;
      if (y >= (prev + r.top) / 2 && y < (r.bottom + next) / 2) return blocks[i];
    }
    return null;
  }
  function onHover(e){
    if (ed || drag || frozen) return;
    const art = $('#article');
    if (!art || !art.classList.contains('editable')) return;
    const ar = art.getBoundingClientRect();
    if (e.clientX < ar.left - 40 || e.clientX > ar.right) { hideGutter(); return; }
    const block = blockAtY(e.clientY);
    if (block) { if (block !== gutBlock || gut.hidden) showGutter(block); }
    else hideGutter();
  }

  /* Kleine Hinweise wie in Notion: „Klicken: darunter einfügen · ⌥-Klick: darüber“ */
  let tip = null, tipTimer = null;
  function showTip(btn){
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      if (!btn.isConnected || btn.closest('[hidden]') || drag) return;
      if (!tip) { tip = document.createElement('div'); tip.className = 'ed-tip'; document.body.appendChild(tip); }
      tip.innerHTML = btn.dataset.tip === 'plus'
        ? `<b>${esc(t('tip.click'))}</b> ${esc(t('tip.addBelow'))}<br><b>${esc(t('tip.optClick'))}</b> ${esc(t('tip.addAbove'))}`
        : `<b>${esc(t('tip.drag'))}</b> ${esc(t('tip.move'))}<br><b>${esc(t('tip.click'))}</b> ${esc(t('tip.openMenu'))}`;
      tip.hidden = false;
      const r = btn.getBoundingClientRect();
      tip.style.left = Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2) + 'px';
      tip.style.top = (r.bottom + 6) + 'px';
    }, 350);
  }
  function hideTip(){ clearTimeout(tipTimer); if (tip) tip.hidden = true; }

  /* ---------- Ziehen zum Verschieben ---------- */
  let drag = null;   // { block, x, y, on, line, target }
  function gripDown(e){
    if (e.button !== 0 || !gutBlock) return;
    e.preventDefault(); e.stopPropagation();
    hideTip();
    drag = { block:gutBlock, x:e.clientX, y:e.clientY, on:false };
    document.addEventListener('mousemove', gripMove);
    document.addEventListener('mouseup', gripUp, { once:true });
  }
  function gripMove(e){
    if (!drag) return;
    if (!drag.on) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
      drag.on = true;
      drag.block.classList.add('ed-dragging');
      document.body.classList.add('ed-grabbing');
      drag.line = document.createElement('div');
      drag.line.className = 'ed-drop';
      $('#article').appendChild(drag.line);
      drag.ghost = drag.block.cloneNode(true);
      drag.ghost.className = 'ed-ghost md';
      drag.ghost.removeAttribute('data-l');
      drag.ghost.style.width = drag.block.getBoundingClientRect().width + 'px';
      document.body.appendChild(drag.ghost);
    }
    drag.ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY - 10}px)`;
    // Ziel: vor dem ersten Block, dessen Mitte unter der Maus liegt
    const blocks = topBlocks(), art = $('#article'), ar = art.getBoundingClientRect();
    let k = blocks.findIndex(b => { const r = b.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (k < 0) k = blocks.length;
    drag.target = k;
    const i = blocks.indexOf(drag.block);
    const same = k === i || k === i + 1;
    let y;
    if (k < blocks.length) { const r = blocks[k].getBoundingClientRect(), p = k ? blocks[k - 1].getBoundingClientRect().bottom : r.top - 8; y = (p + r.top) / 2; }
    else { const last = blocks[blocks.length - 1].getBoundingClientRect(); y = last.bottom + 4; }
    drag.line.hidden = same;
    drag.line.style.top = (y - ar.top - 1.5) + 'px';
    // Am Rand automatisch scrollen
    const sc = $('#scroller'), sr = sc.getBoundingClientRect();
    if (e.clientY < sr.top + 40) sc.scrollTop -= 12; else if (e.clientY > sr.bottom - 40) sc.scrollTop += 12;
  }
  async function gripUp(){
    document.removeEventListener('mousemove', gripMove);
    const d = drag; drag = null;
    if (!d) return;
    if (!d.on) { openBlockMenu(d.block); return; }
    d.block.classList.remove('ed-dragging');
    document.body.classList.remove('ed-grabbing');
    d.line.remove(); d.ghost.remove();
    const f = curFile();
    const blocks = topBlocks(), i = blocks.indexOf(d.block);
    if (!f || i < 0 || d.target === i || d.target === i + 1) return;
    const [a, b] = range(d.block);
    let lines = linesOf(f);
    let to;
    if (d.target < blocks.length) to = range(blocks[d.target])[0];
    else { to = lines.length; while (to > 0 && blank(lines[to - 1])) to--; }
    const blk = lines.slice(a, b + 1);
    const r = removeRange(lines, a, b);
    if (to > b) to -= (b - a + 1) + r.extra;
    commit(f, insertAt(r.lines, to, blk));
  }

  /* ---------- Block-Menü (Klick auf ⋮⋮) ---------- */
  let bm = null;
  function closeBlockMenu(){
    if (!bm) return;
    bm.el.remove();
    if (bm.block) bm.block.classList.remove('ed-sel');
    bm = null; frozen = false;
  }
  function openBlockMenu(block){
    closeBlockMenu();
    const kind = block.tagName.toLowerCase();
    const canTurn = /^(p|h[1-6]|ul|ol|blockquote)$/.test(kind);
    const el = document.createElement('div');
    el.className = 'menu blockmenu';
    el.setAttribute('role', 'menu');
    el.innerHTML = (canTurn ? `<button role="menuitem" data-bm="turn">${icon('refresh')}${esc(t('bm.turn'))}<span class="bm-chev">${icon('chev-right')}</span></button>` : '')
      + `<button role="menuitem" data-bm="dup">${icon('copy')}${esc(t('bm.duplicate'))}<small>⌘D</small></button>`
      + `<button role="menuitem" data-bm="del">${icon('trash')}${esc(t('bm.delete'))}<small>⌫</small></button>`;
    document.body.appendChild(el);
    bm = { el, block, sub:null };
    frozen = true;
    block.classList.add('ed-sel');
    const r = gut.querySelector('.ed-grip').getBoundingClientRect();
    el.style.left = Math.max(8, r.left - el.offsetWidth - 6) + 'px';
    el.style.top = Math.min(innerHeight - el.offsetHeight - 8, r.top) + 'px';
    el.addEventListener('mousedown', e => e.preventDefault());
    el.addEventListener('mouseover', e => {
      const b = e.target.closest('[data-bm]');
      if (b && b.dataset.bm === 'turn') openTurn(b); else if (b && bm.sub && !e.target.closest('.turnmenu')) closeTurn();
    });
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-bm],[data-turn]');
      if (!b) return;
      if (b.dataset.turn) blockAction('turn', b.dataset.turn);
      else if (b.dataset.bm === 'turn') openTurn(b);
      else blockAction(b.dataset.bm);
    });
  }
  function openTurn(btn){
    if (bm.sub) return;
    const sub = document.createElement('div');
    sub.className = 'menu turnmenu';
    sub.innerHTML = `<div class="sl-head">${esc(t('bm.turn'))}</div>` + BLOCKS.filter(b => b.pre != null)
      .map(b => `<button role="menuitem" data-turn="${b.k}">${blockIcon(b)}${esc(t('slash.' + b.k))}</button>`).join('');
    bm.el.appendChild(sub);
    bm.sub = sub;
    const r = btn.getBoundingClientRect();
    const left = r.right + 4 + sub.offsetWidth > innerWidth - 8 ? r.left - sub.offsetWidth - 4 : r.right + 4;
    sub.style.left = left + 'px';
    sub.style.top = Math.min(innerHeight - sub.offsetHeight - 8, r.top - 6) + 'px';
  }
  function closeTurn(){ if (bm && bm.sub) { bm.sub.remove(); bm.sub = null; } }
  function turnLines(lines, k){
    const b = BLOCKS.find(x => x.k === k);
    const parts = lines.map(l => l.match(/^(\s*)(?:#{1,6}\s+|>\s?|[-*+]\s+\[([ xX])\]\s+|[-*+]\s+|\d+[.)]\s+)?(.*)$/))
      .map(m => ({ ind:m[1], done:m[2] && m[2] !== ' ', text:m[3] }))
      .filter(p => p.text.trim() && !/^\[!\w+\]$/.test(p.text.trim()));
    if (!parts.length) return lines;
    if (/^h\d$/.test(k)) return [b.pre + parts.map(p => p.text.trim()).join(' ')];
    if (k === 'text') return parts.map(p => p.text);
    let n = 0;
    return parts.map(p => {
      const ind = /^(todo|bullet|number)$/.test(k) ? p.ind : '';
      if (k === 'todo') return ind + `- [${p.done ? 'x' : ' '}] ` + p.text;
      if (k === 'number') return ind + (ind ? '1' : ++n) + '. ' + p.text;
      return ind + b.pre + p.text;
    });
  }
  function blockAction(act, arg){
    const block = bm && bm.block;
    closeBlockMenu();
    hideGutter(true);
    const f = curFile();
    if (!f || !block || !block.isConnected) return;
    const [a, b] = range(block);
    const lines = linesOf(f);
    if (act === 'del') commit(f, removeRange(lines, a, b).lines);
    else if (act === 'dup') commit(f, insertAt(lines, b + 1, lines.slice(a, b + 1)));
    else if (act === 'turn') { const rest = lines.slice(0, a).concat(lines.slice(b + 1)); commit(f, insertAt(rest, a, turnLines(lines.slice(a, b + 1), arg))); }
  }

  /* ---------- Neue Datei (⌘N) ---------- */
  const TRANS = { 'ä':'ae', 'ö':'oe', 'ü':'ue', 'ß':'ss', 'Ä':'Ae', 'Ö':'Oe', 'Ü':'Ue' };
  /* Dateiname wie die Nachbarn: klein-mit-bindestrichen, mit_unterstrichen oder so wie der Titel */
  function fileName(title, dir){
    const names = FILES.filter(f => f.absDir === dir).map(f => f.name.replace(/\.(md|markdown|mdown)$/i, ''))
      .filter(n => n !== n.toUpperCase());   // README, CLAUDE usw. sind keine Vorbilder
    const spaced = names.filter(n => / /.test(n) || /[A-ZÄÖÜ]/.test(n)).length;
    const under = names.filter(n => /_/.test(n) && !/-/.test(n)).length;
    let base;
    if (names.length && spaced > names.length / 2) base = title.replace(/[\/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    else {
      const sep = names.length && under > names.length / 2 ? '_' : '-';
      base = title.replace(/[äöüßÄÖÜ]/g, c => TRANS[c]).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, sep).replace(new RegExp(`^\\${sep}+|\\${sep}+$`, 'g'), '');
    }
    base = (base || t('new.untitled')).slice(0, 80).replace(/^\.+/, '');
    const taken = new Set(FILES.filter(f => f.absDir === dir).map(f => f.name.toLowerCase()));
    let name = base + '.md', n = 2;
    while (taken.has(name.toLowerCase())) name = `${base}${base.includes(' ') ? ' ' : '-'}${n++}.md`;
    return name;
  }
  function targetDir(){
    const f = curFile();
    if (f) return f.absDir;
    const key = curDir();
    return key ? dirAbs(key) : '';
  }
  let nf = null;
  function closeNewFile(){ if (nf) { nf.remove(); nf = null; } }
  function newFile(){
    if (nf) { nf.querySelector('input').focus(); return; }
    if (ed) finish();
    const dir = targetDir();
    if (!dir) { toast(t('new.noFolder')); return; }
    nf = document.createElement('div');
    nf.className = 'newfile';
    nf.innerHTML = `<div class="nf-box" role="dialog" aria-label="${esc(t('new.title'))}">
      <div class="nf-where">${icon('folder')}<span>${esc(tilde(dir))}</span></div>
      <input type="text" placeholder="${esc(t('new.placeholder'))}" spellcheck="true">
      <div class="nf-foot"><span class="nf-name"></span><span><kbd>↩</kbd> ${esc(t('new.create'))} · <kbd>esc</kbd></span></div></div>`;
    document.body.appendChild(nf);
    const input = nf.querySelector('input'), out = nf.querySelector('.nf-name');
    const preview = () => { out.innerHTML = icon('file') + esc(fileName(input.value.trim(), dir)); };
    preview();
    input.addEventListener('input', preview);
    input.addEventListener('keydown', async e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeNewFile(); return; }
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      const name = fileName(title, dir);
      let r;
      try { r = await native('create', JSON.stringify({ dir, name, text:`# ${title}\n` })); }
      catch(err) { r = 'error: ' + err.message; }
      if (r === 'exists') { toast(t('new.exists', { name })); return; }
      if (!r || !r.startsWith('{')) { toast(t('edit.failed', { msg:String(r).replace(/^error:\s*/, '') })); return; }
      closeNewFile();
      const { abs, info } = JSON.parse(r);
      if (info && info.src !== 'extern') { window.natively.apply({ upserts:[info] }); openFile(info.id, { newTab:false }); }
      else window.natively.openPath(abs, info);
      // Gleich unter dem Titel weiterschreiben
      setTimeout(() => { const f = curFile(); if (f && f.abs === abs) { const n = linesOf(f).filter(l => !blank(l)).length; startEdit(f, n, n - 1, null, true, false); } }, 60);
    });
    nf.addEventListener('mousedown', e => { if (e.target === nf) closeNewFile(); });
    input.focus();
  }

  /* ---------- Einbau in die Dokumentansicht ---------- */
  function afterDoc(f){
    gut = null; gutBlock = null; frozen = false;   // altes Dokument ist weg
    closeBlockMenu();
    const art = $('#article');
    if (!art || S.raw || f.content == null || f.content.length > 1000000) return;
    art.classList.add('editable');
    const tail = document.createElement('button');
    tail.className = 'ed-tail';
    tail.textContent = t('edit.hint');
    art.insertBefore(tail, art.querySelector('.backlinks') || art.querySelector('.docmeta'));
    tail.addEventListener('click', e => {
      e.stopPropagation();
      const cur = curFile();
      if (!cur) return;
      const lines = linesOf(cur);
      let n = lines.length; while (n > 0 && blank(lines[n - 1])) n--;
      startEdit(cur, n, n - 1, null, true, false);
    });
    const sc = $('#scroller');
    sc.addEventListener('mousemove', onHover);
    sc.addEventListener('mouseleave', () => hideGutter());
    sc.addEventListener('scroll', () => { if (gutBlock && !gut.hidden) showGutter(gutBlock); }, { passive:true });
    art.addEventListener('click', e => {
      const box = e.target.closest('li.task[data-ln] > .tbox');
      if (box) { e.stopPropagation(); toggleTask(box.parentElement); return; }
      if (ed || bm || e.target.closest('a,button,input,textarea,img,.mdlink,.tbl-expand,.backlinks,.docmeta,.ed-gut')) return;
      const sel = getSelection();
      if (sel && !sel.isCollapsed && String(sel).trim()) return;   // Text markieren bleibt möglich
      const block = e.target.closest('[data-l]');
      if (!block || block.parentElement !== art) return;
      const cur = curFile();
      if (!cur) return;
      const [a, b] = range(block);
      startEdit(cur, a, b, block, false, false);
    });
  }

  /* Tasten außerhalb der Textfelder: Block-Menü, ⌘Z */
  document.addEventListener('keydown', e => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (bm) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeBlockMenu(); hideGutter(true); return; }
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); blockAction('del'); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); blockAction('dup'); return; }
    }
    if (!typing && (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && undo.length) { e.preventDefault(); undoLast(); }
  }, true);
  document.addEventListener('mousedown', e => { if (bm && !e.target.closest('.blockmenu')) { closeBlockMenu(); hideGutter(true); } }, true);

  /* Während der Bearbeitung meldet die Mac-App die eigene Änderung zurück: dann das Dokument nicht neu zeichnen */
  const busy = () => !!((ed && ed.ta.isConnected) || drag || bm);

  window.nativelyEditor = { afterDoc, busy, finish, newFile, undoLast };
})();
