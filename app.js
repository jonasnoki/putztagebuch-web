/* putztagebuch web app. Plain JS, no build step. Data: Supabase via backend.js. */
'use strict';

// ------------------------------------------------------------------ utilities

const DEFAULT_TASKS = [
  { name: 'Pfand wegbringen', desc: '' },
  { name: 'Glas wegbringen', desc: '' },
  { name: 'Kühlschrank putzen', desc: 'Alle Oberflächen, Wände und Fächer' },
  { name: 'Kühlschrank ausmisten', desc: 'Vergammelte Sachen wegwerfen' },
  { name: 'Küche Deep Clean', desc: 'Fächer wischen' },
  { name: 'Saugen', desc: 'Alles' },
  { name: 'Bad putzen', desc: '' },
  { name: 'Pflanzen gießen', desc: '' },
];

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
  },
  del(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  },
};

/** Tiny DOM builder: h('div', {class: 'x', onclick: fn}, 'text', child). Never uses innerHTML. */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  appendAll(el, children);
  return el;
}
function appendAll(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}
const SVGNS = 'http://www.w3.org/2000/svg';
function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  appendAll(el, children);
  return el;
}

const DAY = 86400;
const nowSec = () => Math.floor(Date.now() / 1000);
const pad = (n) => String(n).padStart(2, '0');
function toLocalInput(sec) {
  if (sec == null) return '';
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(str) {
  if (!str) return null;
  const t = new Date(str).getTime(); // datetime-local strings parse as local time
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}
const fmtDate = (sec) => new Date(sec * 1000).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtShortDate = (sec) => new Date(sec * 1000).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
const fmtTime = (sec) => new Date(sec * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const fmtMonth = (sec) => new Date(sec * 1000).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
function dayKey(sec) {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const noonMs = (sec) => { const d = new Date(sec * 1000); d.setHours(12, 0, 0, 0); return d.getTime(); };
/** Calendar days from a to b (DST-safe). */
const daysBetween = (a, b) => Math.round((noonMs(b) - noonMs(a)) / (DAY * 1000));
const tage = (n) => `${n} ${n === 1 ? 'Tag' : 'Tagen'}`;

/** "heute 14:30", "gestern", "vor 3 Tagen", "noch nie" */
function fmtAgo(sec) {
  if (sec == null) return 'noch nie';
  const d = daysBetween(sec, nowSec());
  if (d <= 0) return `heute ${fmtTime(sec)}`;
  if (d === 1) return 'gestern';
  return `vor ${tage(d)}`;
}

let toastTimer;
/** Short message; with an action (e.g. undo) or { long: true } it stays longer. */
function toast(msg, action) {
  const el = document.getElementById('toast');
  el.replaceChildren(msg);
  if (action && action.label) {
    el.append(h('button', { type: 'button', onclick: () => { el.hidden = true; action.run(); } }, action.label));
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 5000 : 2600);
}

// ------------------------------------------------------------------ state + API

const S = {
  entries: store.get('pt.cache.entries', []), // includes tombstones
  shopping: store.get('pt.cache.shopping', []),
  home: store.get('pt.cache.home', null), // { home: {id, name, data}, members: [...] }; null = not joined
  online: true,
  loaded: false,
  lastSync: store.get('pt.cache.time', null),
};

function setOnline(on) {
  S.online = on;
  const b = document.getElementById('banner');
  if (on) { b.hidden = true; return; }
  b.replaceChildren(
    'Offline: gespeicherte Daten, nur lesen' + (S.lastSync ? ` (Stand ${fmtDate(S.lastSync)} ${fmtTime(S.lastSync)})` : ''),
    h('button', { type: 'button', onclick: () => refresh().then(render) }, 'Neu laden'),
  );
  b.hidden = false;
}

async function refresh() {
  if (!Backend.signedIn()) return;
  try {
    const [list, home, shopping] = await Promise.all([Backend.listEntries(), Backend.getHome(), Backend.listShopping()]);
    S.shopping = shopping || [];
    store.set('pt.cache.shopping', S.shopping);
    S.entries = list || [];
    S.home = home;
    S.lastSync = nowSec();
    store.set('pt.cache.entries', S.entries);
    store.set('pt.cache.home', S.home);
    store.set('pt.cache.time', S.lastSync);
    setOnline(true);
  } catch (e) {
    if (e.status === 401) {
      toast('Abgemeldet. Bitte neu anmelden.');
      setOnline(true);
    } else {
      setOnline(false);
    }
  } finally {
    S.loaded = true;
  }
}

function upsertLocal(e) {
  const i = S.entries.findIndex((x) => x.id === e.id);
  if (i >= 0) S.entries[i] = e; else S.entries.push(e);
  store.set('pt.cache.entries', S.entries);
}

const homeTasks = () => S.home && S.home.home.data && (S.home.home.data.tasks || []).filter((t) => t && t.name);
const tasks = () => (homeTasks() && homeTasks().length ? homeTasks() : DEFAULT_TASKS);
const myName = () => {
  const me = S.home && S.home.members.find((m) => m.user_id === Backend.userId());
  return me ? me.name : '';
};
const visibleEntries = () => S.entries.filter((e) => !e.deleted).sort((a, b) => (b.at - a.at) || (b.id - a.id));

/** Latest "at" per task name. */
function lastDone() {
  return Object.fromEntries(Object.entries(lastEntry()).map(([k, e]) => [k, e.at]));
}

/** Latest entry per task name. */
function lastEntry() {
  const out = {};
  for (const e of S.entries) {
    if (e.deleted) continue;
    if (out[e.task] == null || e.at > out[e.task].at) out[e.task] = e;
  }
  return out;
}

function newId() {
  let id = nowSec();
  while (S.entries.some((e) => e.id === id)) id++;
  return id;
}

async function logTask(name, at) {
  const entry = { id: newId(), at: at ?? nowSec(), task: name };
  const saved = await Backend.putEntry(entry);
  upsertLocal(saved);
  return saved;
}

// ------------------------------------------------------------------ router

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  return { name: parts[0] || 'log', arg: parts[1] };
}

let dirty = false; // unsaved edit form
/** Draws the current route. keepScroll: a live update, not a page change. */
function render({ keepScroll = false } = {}) {
  const view = document.getElementById('view');
  const tabs = document.getElementById('tabs');
  const r = route();
  const y = window.scrollY;
  if (!keepScroll) window.scrollTo(0, 0);
  dirty = false;
  if (!Backend.signedIn() || r.name === 'setup') {
    tabs.hidden = true;
    view.replaceChildren(viewSetup());
    return;
  }
  if (S.loaded && S.online && !S.home) {
    tabs.hidden = true;
    view.replaceChildren(viewJoin());
    return;
  }
  tabs.hidden = false;
  const tab = r.name === 'entry' || r.name === 'new' ? 'log' : r.name === 'board' ? 'history' : r.name;
  for (const a of tabs.querySelectorAll('a')) a.classList.toggle('active', a.dataset.tab === tab);
  let content;
  switch (r.name) {
    case 'entry': content = viewEdit(Number(r.arg)); break;
    case 'new': content = viewEdit(null, r.arg ? decodeURIComponent(r.arg) : null); break;
    case 'history': content = viewHistory(); break;
    case 'board': content = viewHistory(); break;
    case 'shop': content = viewShopping(); break;
    case 'join': tabs.hidden = true; content = viewJoin(); break;
    case 'settings': content = viewSettings(); break;
    default: content = viewLog();
  }
  if (keepScroll) {
    // Hold the old height while swapping, so the page does not shrink and jump
    // (on iOS that also misplaces the fixed tab bar).
    view.style.minHeight = `${view.offsetHeight}px`;
    view.replaceChildren(content);
    if (window.scrollY !== y) window.scrollTo(0, y);
    requestAnimationFrame(() => { view.style.minHeight = ''; });
  } else {
    view.replaceChildren(content);
  }
}

window.addEventListener('hashchange', render);
window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

// ------------------------------------------------------------------ sign in

/** Sign-in: email and password, or a code by email (first time, or a forgotten password).
 *  A code, not a link, so it works inside the installed app. */
function viewSetup() {
  let mode = store.get('pt.loginMode', 'password'); // 'password' | 'code'
  const email = h('input', { type: 'email', id: 'se', name: 'email', placeholder: 'du@example.com', autocomplete: 'username', inputmode: 'email', autocapitalize: 'off', spellcheck: 'false', value: store.get('pt.email', '') });
  const pass = h('input', { type: 'password', id: 'sp', name: 'password', autocomplete: 'current-password' });
  const passField = h('div', { class: 'field' }, h('label', { for: 'sp' }, 'Passwort'), pass);
  const code = h('input', { type: 'text', id: 'sc', placeholder: '123456', autocomplete: 'one-time-code', inputmode: 'numeric', maxlength: '10' });
  const codeField = h('div', { class: 'field', hidden: true }, h('label', { for: 'sc' }, 'Code aus der E-Mail (falls vorhanden)'), code);
  const err = h('div', { class: 'error', role: 'alert' });
  const status = h('div', { class: 'hint' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' });
  const intro = h('p', { class: 'muted' });
  const switchLink = h('button', { type: 'button', class: 'linkish', onclick: () => setMode(mode === 'password' ? 'code' : 'password') });
  let sent = false;

  if (!Backend.configured()) {
    return h('div', { class: 'signin' }, h('h1', {}, 'Putztagebuch'),
      h('p', { class: 'muted' }, 'Kein Backend eingestellt. Trage URL und Key in config.js ein.'));
  }

  function setMode(m) {
    mode = m;
    store.set('pt.loginMode', m);
    sent = false;
    err.textContent = ''; status.textContent = '';
    passField.hidden = m !== 'password';
    codeField.hidden = true;
    btn.textContent = m === 'password' ? 'Anmelden' : 'E-Mail senden';
    intro.textContent = m === 'password'
      ? 'Melde dich mit E-Mail und Passwort an.'
      : 'Wir schicken dir einen Anmeldelink per E-Mail. Für das erste Mal, oder wenn du das Passwort vergessen hast.';
    switchLink.textContent = m === 'password' ? 'Noch kein Passwort oder vergessen? Per E-Mail anmelden' : 'Mit Passwort anmelden';
  }

  async function signedIn() {
    status.textContent = '';
    await refresh();
    startLive();
    location.hash = mode === 'code' ? '#/settings' : '#/log';
    render();
    if (mode === 'code') toast('Angemeldet. Setz unter Konto ein Passwort, dann geht es auch in der installierten App.');
  }

  async function submit(e) {
    e.preventDefault();
    err.textContent = '';
    const addr = email.value.trim();
    if (!/^\S+@\S+\.\S+$/.test(addr)) { err.textContent = 'Gib deine E-Mail-Adresse ein.'; return; }
    btn.disabled = true;
    try {
      if (mode === 'password') {
        if (!pass.value) { err.textContent = 'Gib dein Passwort ein.'; return; }
        status.textContent = 'Prüfe…';
        await Backend.signInPassword(addr, pass.value);
        store.set('pt.email', addr);
        await signedIn();
      } else if (!sent) {
        status.textContent = 'Sende…';
        await Backend.sendCode(addr);
        store.set('pt.email', addr);
        sent = true;
        codeField.hidden = false;
        btn.textContent = 'Anmelden';
        status.textContent = `E-Mail an ${addr} geschickt. Öffne den Link darin auf diesem Gerät, oder gib den Code ein, falls einer drinsteht.`;
        code.focus();
      } else {
        const c = code.value.replace(/\s/g, '');
        if (!c) { err.textContent = 'Gib den Code aus der E-Mail ein.'; return; }
        status.textContent = 'Prüfe…';
        await Backend.verifyCode(addr, c);
        await signedIn();
      }
    } catch (ex) {
      status.textContent = '';
      if (!ex.status) err.textContent = 'Keine Verbindung. Versuch es wieder, wenn du online bist.';
      else if (mode === 'password') err.textContent = ex.status === 400 ? 'E-Mail oder Passwort falsch. Noch kein Passwort? Per E-Mail anmelden.' : ex.message;
      else if (ex.status === 429) err.textContent = 'Gerade zu viele E-Mails (der kostenlose Dienst schickt nur wenige pro Stunde). Versuch es später, oder nutze ein Passwort.';
      else err.textContent = sent ? 'Der Code hat nicht funktioniert. Prüfe ihn oder fordere einen neuen an.' : ex.message;
    } finally {
      btn.disabled = false;
    }
  }

  setMode(mode);
  return h('div', { class: 'signin' },
    h('h1', {}, 'Putztagebuch'),
    intro,
    h('form', { onsubmit: submit, autocomplete: 'on' },
      h('div', { class: 'field' }, h('label', { for: 'se' }, 'E-Mail'), email),
      passField, codeField, btn, err, status,
    ),
    h('div', { style: 'margin-top:16px' }, switchLink),
  );
}

/** Set or change the password, for the email and password sign-in. */
function passwordPanel(ro) {
  const pw = h('input', { type: 'password', id: 'np', autocomplete: 'new-password', minlength: '8', disabled: ro });
  const pw2 = h('input', { type: 'password', id: 'np2', autocomplete: 'new-password', disabled: ro });
  const err = h('div', { class: 'error', role: 'alert' });
  const btn = h('button', { type: 'submit', class: 'btn block', disabled: ro }, 'Passwort speichern');
  async function submit(e) {
    e.preventDefault();
    err.textContent = '';
    if (pw.value.length < 8) { err.textContent = 'Mindestens 8 Zeichen.'; return; }
    if (pw.value !== pw2.value) { err.textContent = 'Die beiden Passwörter sind nicht gleich.'; return; }
    btn.disabled = true;
    try {
      await Backend.setPassword(pw.value);
      pw.value = ''; pw2.value = '';
      toast('Passwort gespeichert');
    } catch (ex) {
      err.textContent = ex.status ? ex.message : 'Braucht eine Verbindung';
    } finally {
      btn.disabled = ro;
    }
  }
  // The hidden username field lets password managers save the pair.
  return h('form', { onsubmit: submit, autocomplete: 'on' },
    h('input', { type: 'email', name: 'email', autocomplete: 'username', value: Backend.email() || '', hidden: true, readonly: true }),
    h('div', { class: 'field' }, h('label', { for: 'np' }, 'Neues Passwort'), pw),
    h('div', { class: 'field' }, h('label', { for: 'np2' }, 'Passwort wiederholen'), pw2),
    btn, err);
}

// ------------------------------------------------------------------ log (start page)

function entryRow(e) {
  return h('a', { class: 'entry', href: `#/entry/${e.id}` },
    h('span', { class: 'grow' }, e.task, e.by ? h('span', { class: 'by' }, e.by) : null),
    h('span', { class: 'when num' }, `${fmtDate(e.at)} ${fmtTime(e.at)}`));
}

/** Join a household by its slug, or create one with a slug you choose. Also used to switch. */
function viewJoin() {
  const switching = !!S.home;
  let mode = 'join'; // 'join' | 'create'
  const code = h('input', { type: 'text', id: 'jc', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', placeholder: 'z. B. wg-goethestrasse' });
  const name = h('input', { type: 'text', id: 'jn', autocomplete: 'given-name', maxlength: '40', value: myName() });
  const codeLabel = h('label', { for: 'jc' });
  const hint = h('div', { class: 'hint' });
  const err = h('div', { class: 'error', role: 'alert' });
  const btn = h('button', { type: 'submit', class: 'btn primary block' });
  const seg = h('div', { class: 'seg' });
  function setMode(m) {
    mode = m;
    err.textContent = '';
    codeLabel.textContent = m === 'join' ? 'Code des Haushalts' : 'Code für den neuen Haushalt';
    hint.textContent = m === 'join'
      ? 'Den Code bekommst du von jemandem aus dem Haushalt (Einstellungen → Haushalt).'
      : 'Kleinbuchstaben, Ziffern und Bindestriche, 3–40 Zeichen. Wer den Code kennt, kann beitreten.';
    btn.textContent = m === 'join' ? 'Beitreten' : 'Anlegen und beitreten';
    seg.replaceChildren(
      h('a', { href: '#', class: m === 'join' ? 'on' : '', onclick: (e) => { e.preventDefault(); setMode('join'); } }, 'Beitreten'),
      h('a', { href: '#', class: m === 'create' ? 'on' : '', onclick: (e) => { e.preventDefault(); setMode('create'); } }, 'Neu anlegen'));
  }
  code.addEventListener('input', () => {
    if (mode === 'create') {
      code.value = code.value.toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    }
  });
  async function submit(e) {
    e.preventDefault();
    err.textContent = '';
    const slug = code.value.trim().toLowerCase();
    if (!slug) { err.textContent = 'Gib einen Code ein.'; return; }
    if (mode === 'create' && !/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) { err.textContent = 'Nur a–z, 0–9 und Bindestriche, 3–40 Zeichen, nicht mit Bindestrich anfangen oder enden.'; return; }
    if (!name.value.trim()) { err.textContent = 'Gib deinen Namen ein.'; return; }
    btn.disabled = true;
    try {
      if (mode === 'join') await Backend.joinHome(slug, name.value);
      else await Backend.createHome(slug, name.value);
      await refresh();
      location.hash = '#/log';
      render();
      toast(mode === 'join' ? `Willkommen im Haushalt ${S.home.home.name}` : `Haushalt ${S.home.home.name} angelegt. Teile den Code zum Beitreten.`);
    } catch (ex) {
      err.textContent = !ex.status ? 'Keine Verbindung.'
        : /unknown home/.test(ex.message) ? 'Diesen Haushalt gibt es nicht. Prüfe den Code.'
        : /slug taken/.test(ex.message) ? 'Diesen Code gibt es schon. Wähle einen anderen, oder tritt bei.'
        : /invalid slug/.test(ex.message) ? 'Ungültiger Code.'
        : ex.message;
    } finally {
      btn.disabled = false;
    }
  }
  setMode('join');
  return h('div', { class: 'signin' },
    switching ? h('div', { class: 'topbar' },
      h('button', { type: 'button', class: 'back', 'aria-label': 'Zurück', onclick: () => history.back() }, '‹'),
      h('h1', {}, 'Haushalt wechseln')) : h('h1', {}, 'Dein Haushalt'),
    h('p', { class: 'muted' }, switching
      ? `Du bist gerade in ${S.home.home.name}. Deine bisherigen Einträge bleiben dort.`
      : 'Alle im Haushalt sehen dieselben Aufgaben und wer wann was geputzt hat.'),
    seg,
    h('form', { onsubmit: submit },
      h('div', { class: 'field' }, codeLabel, code, hint),
      h('div', { class: 'field' }, h('label', { for: 'jn' }, 'Dein Name'), name),
      btn, err),
    switching ? null : h('button', { type: 'button', class: 'linkish', onclick: async () => { await Backend.signOut(); render(); } }, 'Abmelden'));
}

/** One tap per task logs it as done now. Recent entries below. */
function viewLog() {
  const ro = !S.online;
  const last = lastDone();
  const lastBy = Object.fromEntries(Object.entries(lastEntry()).map(([k, e]) => [k, e.by]));
  const grid = h('div', { class: 'tasks' });
  for (const t of tasks()) {
    const btn = h('button', { type: 'button', class: 'task', disabled: ro, onclick: async () => {
      btn.disabled = true;
      btn.classList.add('busy');
      try {
        const saved = await logTask(t.name);
        render();
        toast(`${t.name}: erledigt`, { label: 'Rückgängig', run: async () => {
          try {
            upsertLocal(await Backend.deleteEntry(saved));
            render();
          } catch (e) { toast(e.status ? e.message : 'Braucht eine Verbindung'); }
        } });
      } catch (e) {
        toast(e.status ? e.message : 'Nicht gespeichert: Server nicht erreichbar');
        btn.disabled = false;
        btn.classList.remove('busy');
      }
    } },
      h('span', { class: 'name' }, t.name),
      t.desc ? h('span', { class: 'desc' }, t.desc) : null,
      h('span', { class: 'last' }, fmtAgo(last[t.name]), lastBy[t.name] ? ` · ${lastBy[t.name]}` : ''));
    grid.append(btn);
  }

  const recent = visibleEntries().slice(0, 12);
  const list = h('div', { class: 'entries' }, recent.map(entryRow));
  if (!recent.length) list.append(h('div', { class: 'empty' }, 'Noch nichts erledigt. Tipp auf eine Aufgabe.'));

  return h('div', { class: 'log' },
    h('div', { class: 'pane' },
      h('div', { class: 'eyebrow' }, new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })),
      h('h1', {}, 'Was hast du geputzt?'),
      grid),
    h('div', { class: 'pane' },
      h('div', { class: 'row spread' }, h('h2', {}, 'Zuletzt'),
        h('a', { class: 'linkish', href: '#/new' }, 'Nachtragen')),
      list,
      recent.length ? h('a', { class: 'linkish', href: '#/history' }, 'Ganzer Verlauf') : null));
}

// ------------------------------------------------------------------ edit / add entry

function viewEdit(id, presetTask) {
  const ro = !S.online;
  const existing = id != null ? S.entries.find((e) => e.id === id && !e.deleted) : null;
  if (id != null && !existing) {
    return h('div', {}, h('h1', {}, 'Eintrag nicht gefunden'), h('a', { href: '#/log', class: 'linkish' }, 'Zurück'));
  }
  const names = tasks().map((t) => t.name);
  const current = existing ? existing.task : presetTask || names[0];
  if (current && !names.includes(current)) names.push(current); // renamed or removed task
  const task = h('select', { id: 'et', disabled: ro, onchange: () => { dirty = true; } },
    names.map((n) => h('option', { value: n, selected: n === current }, n)));
  const at = h('input', { type: 'datetime-local', id: 'ea', disabled: ro, value: toLocalInput(existing ? existing.at : nowSec()), oninput: () => { dirty = true; } });
  const err = h('div', { class: 'error', role: 'alert' });

  async function save(e) {
    e.preventDefault();
    const t = fromLocalInput(at.value);
    if (t == null) { err.textContent = 'Gib Datum und Uhrzeit ein.'; return; }
    try {
      if (existing) upsertLocal(await Backend.putEntry({ ...existing, task: task.value, at: t }));
      else await logTask(task.value, t);
      dirty = false;
      toast('Gespeichert');
      history.back();
    } catch (ex) {
      err.textContent = ex.status ? ex.message : 'Nicht gespeichert: Server nicht erreichbar';
    }
  }
  async function del() {
    if (!confirm(`${existing.task} vom ${fmtDate(existing.at)} löschen?`)) return;
    try {
      upsertLocal(await Backend.deleteEntry(existing));
      dirty = false;
      toast('Gelöscht');
      history.back();
    } catch (ex) {
      err.textContent = ex.status ? ex.message : 'Nicht gelöscht: Server nicht erreichbar';
    }
  }

  return h('div', { class: 'narrow' },
    h('div', { class: 'topbar' },
      h('button', { type: 'button', class: 'back', 'aria-label': 'Zurück', onclick: () => history.back() }, '‹'),
      h('h1', {}, existing ? 'Eintrag bearbeiten' : 'Nachtragen')),
    h('form', { onsubmit: save },
      h('div', { class: 'field' }, h('label', { for: 'et' }, 'Aufgabe'), task),
      h('div', { class: 'field' }, h('label', { for: 'ea' }, 'Wann'), at),
      err,
      h('div', { class: 'actions' },
        existing ? h('button', { type: 'button', class: 'btn danger', disabled: ro, onclick: del }, 'Löschen') : null,
        h('button', { type: 'submit', class: 'btn primary', disabled: ro }, 'Speichern'))));
}

// ------------------------------------------------------------------ history

const WEEKS = 12;

function weekStart(sec) {
  const d = new Date(sec * 1000);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return Math.floor(d.getTime() / 1000);
}

// A fixed tooltip would float away from its cell on scroll: hide it.
window.addEventListener('scroll', () => { for (const t of document.querySelectorAll('.tip')) t.hidden = true; }, { passive: true, capture: true });

/** Task × week grid: how often each task was done per week, last 12 weeks. */
function weekGrid(list) {
  const ts = tasks();
  const thisWeek = weekStart(nowSec());
  const starts = [];
  for (let i = WEEKS - 1; i >= 0; i--) {
    const d = new Date(thisWeek * 1000);
    d.setDate(d.getDate() - 7 * i);
    starts.push(Math.floor(d.getTime() / 1000));
  }
  const counts = {};
  for (const e of list) {
    if (e.at < starts[0]) continue;
    const w = starts.findLastIndex((st) => e.at >= st);
    const k = `${e.task}|${w}`;
    counts[k] = (counts[k] || 0) + 1;
  }

  const labelW = 150;
  const cell = 26;
  const gap = 2;
  const W = labelW + WEEKS * (cell + gap);
  const top = 22;
  const H = top + ts.length * (cell + gap);
  const box = h('div', { class: 'chart' });
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Wie oft pro Woche, letzte ${WEEKS} Wochen` });
  starts.forEach((st, i) => {
    // Every second week, counted back from this week, so labels never collide.
    if ((WEEKS - 1 - i) % 2 === 0) {
      svg.append(s('text', { x: labelW + i * (cell + gap) + cell / 2, y: 12, 'text-anchor': 'middle', class: 'mono' }, fmtShortDate(st).replace('.', '')));
    }
  });
  const tip = h('div', { class: 'tip', hidden: true });
  ts.forEach((t, r) => {
    const y = top + r * (cell + gap);
    svg.append(s('text', { x: labelW - 10, y: y + cell / 2 + 4, 'text-anchor': 'end', class: 'ink' }, t.name.length > 20 ? t.name.slice(0, 19) + '…' : t.name));
    starts.forEach((st, i) => {
      const n = counts[`${t.name}|${i}`] || 0;
      const x = labelW + i * (cell + gap);
      const rect = s('rect', { x, y, width: cell, height: cell, rx: 4, class: `cell c${Math.min(n, 3)}`, tabindex: '0' });
      const show = () => {
        tip.replaceChildren(`${t.name} · Woche ab ${fmtShortDate(st)}: ${n === 0 ? 'nicht' : n === 1 ? 'einmal' : `${n}×`}`);
        tip.hidden = false;
        // Fixed to the viewport: the scroll box does not clip it, and it stays on screen.
        const r = rect.getBoundingClientRect();
        const half = tip.offsetWidth / 2;
        const cx = Math.min(Math.max(r.left + r.width / 2, half + 8), window.innerWidth - half - 8);
        tip.style.left = `${cx}px`;
        tip.style.top = `${r.top}px`;
      };
      rect.addEventListener('pointerenter', show);
      rect.addEventListener('focus', show);
      rect.addEventListener('pointerleave', () => { tip.hidden = true; });
      rect.addEventListener('blur', () => { tip.hidden = true; });
      svg.append(rect);
    });
  });
  box.append(svg, tip);
  const legend = h('div', { class: 'legend' },
    h('span', {}, h('i', { class: 'c0' }), 'nicht'),
    h('span', {}, h('i', { class: 'c1' }), '1×'),
    h('span', {}, h('i', { class: 'c2' }), '2×'),
    h('span', {}, h('i', { class: 'c3' }), '3× oder mehr'));
  return h('div', { class: 'panel' }, h('div', { class: 'scroll' }, box), legend);
}

function viewHistory() {
  const list = visibleEntries();
  const last = lastDone();
  const since90 = nowSec() - 90 * DAY;

  const rows = tasks().map((t) => {
    const mine = list.filter((e) => e.task === t.name);
    return h('tr', {},
      h('td', {}, t.name),
      h('td', {}, fmtAgo(last[t.name])),
      h('td', { class: 'r num' }, mine.filter((e) => e.at >= since90).length));
  });

  const all = h('div', { class: 'entries' });
  let month = null;
  for (const e of list) {
    const m = fmtMonth(e.at);
    if (m !== month) { all.append(h('div', { class: 'month' }, m)); month = m; }
    all.append(entryRow(e));
  }
  if (!list.length) all.append(h('div', { class: 'empty' }, 'Noch keine Einträge.'));

  return h('div', { class: 'stats' },
    h('h1', {}, 'Verlauf'),
    boardSection(),
    h('h2', {}, `Letzte ${WEEKS} Wochen`),
    weekGrid(list),
    h('h2', {}, 'Pro Aufgabe'),
    h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {},
        h('th', {}, 'Aufgabe'), h('th', {}, 'Zuletzt'), h('th', { class: 'r' }, '90 Tage'))),
      h('tbody', {}, rows))),
    h('h2', {}, 'Alle Einträge'),
    all);
}

// ------------------------------------------------------------------ leaderboard

const PERIODS = [
  { key: 'week', label: 'Diese Woche' },
  { key: 'month', label: 'Dieser Monat' },
  { key: 'all', label: 'Gesamt' },
];

function periodStart(key) {
  if (key === 'week') return weekStart(nowSec());
  if (key === 'month') { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(1); return Math.floor(d.getTime() / 1000); }
  return 0;
}

let boardPeriod = store.get('pt.boardPeriod', 'week');

/** Rangliste section: members ranked by tasks done in the period (switches in place). */
function boardSection() {
  const box = h('section', { class: 'board-section' });
  const draw = () => box.replaceChildren(...boardContent(boardPeriod, (k) => { boardPeriod = k; store.set('pt.boardPeriod', k); draw(); }));
  draw();
  return box;
}

/** Members ranked by tasks done in the period; members with none are listed too. */
function boardContent(period, choose) {
  const key = PERIODS.some((p) => p.key === period) ? period : 'week';
  const since = periodStart(key);
  const done = visibleEntries().filter((e) => e.at >= since);
  const people = new Map();
  for (const m of (S.home ? S.home.members : [])) people.set(m.user_id, { name: m.name, n: 0, tasks: {} });
  for (const e of done) {
    const id = e.uid || e.by || '?';
    if (!people.has(id)) people.set(id, { name: e.by || '?', n: 0, tasks: {} });
    const p = people.get(id);
    p.n++;
    p.tasks[e.task] = (p.tasks[e.task] || 0) + 1;
  }
  const rows = [...people.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  const max = Math.max(1, ...rows.map((r) => r.n));
  const me = myName();

  let rank = 0, prev = null;
  const list = h('ol', { class: 'board' }, rows.map((r, i) => {
    if (r.n !== prev) { rank = i + 1; prev = r.n; }
    const top = Object.entries(r.tasks).sort((a, b) => b[1] - a[1]).slice(0, 3);
    return h('li', { class: 'board-row' + (r.name === me ? ' me' : '') },
      h('span', { class: 'rank num' + (rank === 1 && r.n > 0 ? ' first' : '') }, rank === 1 && r.n > 0 ? '🏆' : `${rank}.`),
      h('div', { class: 'grow' },
        h('div', { class: 'row spread' }, h('span', { class: 'who' }, r.name), h('span', { class: 'num count' }, r.n)),
        h('div', { class: 'track' }, h('span', { class: 'fill', style: `width:${(r.n / max) * 100}%` })),
        top.length ? h('div', { class: 'small muted' }, top.map(([t, n]) => `${t} ${n}×`).join(' · ')) : null));
  }));

  return [
    h('h2', {}, 'Rangliste'),
    h('div', { class: 'seg', role: 'tablist' }, PERIODS.map((p) =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(p.key === key), class: p.key === key ? 'on' : '', onclick: () => choose(p.key) }, p.label))),
    done.length ? list : h('div', { class: 'empty' }, 'In diesem Zeitraum hat noch niemand geputzt.'),
    done.length ? h('p', { class: 'hint' }, `${done.length} erledigte Aufgaben. Jede Aufgabe zählt einmal.`) : null,
  ];
}

// ------------------------------------------------------------------ shopping list

/** Einkaufszettel: the household's shared list. Tap to tick off; ticked items
 *  stay below until someone clears them. Changes show live for everyone. */
let shopDraw = null; // redraws the open shopping list in place

function viewShopping() {
  const ro = !S.online;
  const input = h('input', { type: 'text', id: 'si', placeholder: 'Was fehlt?', autocomplete: 'off', enterkeyhint: 'done', maxlength: '200', disabled: ro });
  const save = () => store.set('pt.cache.shopping', S.shopping);
  const byId = (id) => S.shopping.find((x) => x.id === id);
  const fail = (e) => { toast(e.status ? e.message : 'Nicht gespeichert: Server nicht erreichbar'); refresh().then(() => render({ keepScroll: true })); };

  async function add(e) {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const tmp = { id: `tmp-${Date.now()}`, text, done: false, created_at: new Date().toISOString() };
    S.shopping.push(tmp);
    draw();
    input.focus();
    try {
      const row = await Backend.addShopping(text);
      // A live refresh may already have brought the row; else swap the placeholder.
      S.shopping = S.shopping.filter((x) => x.id !== tmp.id);
      if (!byId(row.id)) S.shopping.push(row);
      draw();
      save();
    } catch (ex) { fail(ex); }
  }
  async function toggle(old) {
    const item = byId(old.id) || old;
    item.done = !item.done;
    item.done_at = item.done ? new Date().toISOString() : null;
    draw();
    try { await Backend.setShoppingDone(item.id, item.done); save(); } catch (ex) { fail(ex); }
  }
  async function remove(item) {
    S.shopping = S.shopping.filter((x) => x.id !== item.id);
    draw();
    try { await Backend.deleteShopping(item.id); save(); } catch (ex) { fail(ex); }
  }
  async function clearDone() {
    const ids = S.shopping.filter((x) => x.done).map((x) => x.id);
    S.shopping = S.shopping.filter((x) => !x.done);
    draw();
    try { await Backend.deleteShoppingItems(ids); save(); } catch (ex) { fail(ex); }
  }

  const row = (item) => h('li', { class: 'shop-item' + (item.done ? ' done' : '') },
    h('label', { class: 'grow' },
      h('input', { type: 'checkbox', checked: item.done, disabled: ro, onchange: () => toggle(item) }),
      h('span', {}, item.text)),
    h('button', { type: 'button', class: 'shop-del', 'aria-label': `${item.text} löschen`, disabled: ro, onclick: () => remove(item) }, '×'));

  const list = h('div');
  function draw() {
    const open = S.shopping.filter((x) => !x.done).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const done = S.shopping.filter((x) => x.done).sort((a, b) => (b.done_at || '').localeCompare(a.done_at || ''));
    list.replaceChildren(
      open.length ? h('ul', { class: 'shop' }, open.map(row)) : h('div', { class: 'empty' }, 'Alles da.'),
      done.length ? h('div', { class: 'row spread shop-done-head' },
        h('h2', {}, `Im Wagen (${done.length})`),
        h('button', { type: 'button', class: 'linkish', disabled: ro, onclick: clearDone }, 'Leeren')) : null,
      done.length ? h('ul', { class: 'shop' }, done.map(row)) : null);
  }
  draw();
  shopDraw = draw;

  return h('div', { class: 'narrow' },
    h('h1', {}, 'Einkaufszettel'),
    h('form', { class: 'row shop-add', onsubmit: add },
      h('div', { class: 'grow' }, input),
      h('button', { type: 'submit', class: 'btn primary', disabled: ro }, 'Dazu')),
    list);
}

// ------------------------------------------------------------------ settings

/** Task list: name and optional description. */
function tasksEditor(draft, ro) {
  const wrap = h('div', { class: 'tasked' });
  function draw() {
    wrap.replaceChildren(...draft.map((t, i) => h('div', { class: 'tasked-row' },
      h('div', { class: 'grow' },
        h('input', { type: 'text', value: t.name, placeholder: 'Name', 'aria-label': 'Name', disabled: ro, oninput: (e) => { t.name = e.target.value; } }),
        h('input', { type: 'text', style: 'margin-top:6px', value: t.desc || '', placeholder: 'Beschreibung (optional)', 'aria-label': 'Beschreibung', disabled: ro, oninput: (e) => { t.desc = e.target.value; } })),
      h('div', { class: 'tasked-btns' },
        h('button', { type: 'button', 'aria-label': `${t.name} nach oben`, disabled: ro || i === 0, onclick: () => { draft.splice(i - 1, 0, draft.splice(i, 1)[0]); draw(); } }, '↑'),
        h('button', { type: 'button', 'aria-label': `${t.name} entfernen`, disabled: ro, onclick: () => { draft.splice(i, 1); draw(); } }, '×')))));
  }
  draw();
  return h('div', {}, wrap,
    h('button', { type: 'button', class: 'btn small', style: 'margin-top:10px', disabled: ro, onclick: () => { draft.push({ name: '', desc: '' }); draw(); wrap.lastChild.querySelector('input').focus(); } }, '+ Aufgabe'));
}

const csvCell = (v) => (v == null ? '' : /[",\n;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** CSV of all entries, made in the browser from the loaded data. */
function exportCsv() {
  const rows = visibleEntries().slice().reverse().map((e) => [e.id, toLocalInput(e.at).replace('T', ' '), e.task, e.by]);
  const text = [['id', 'zeit', 'aufgabe', 'wer'], ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = h('a', { href: url, download: `putztagebuch-${dayKey(nowSec())}.csv` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Connect a watch: the code is shown once; only its hash is stored. */
function devicesPanel(ro) {
  const list = h('ul', { class: 'editlist' }, h('li', {}, h('span', { class: 'muted' }, 'Lade…')));
  const out = h('div');
  async function load() {
    try {
      const devices = await Backend.listDevices();
      list.replaceChildren(...devices.map((d) => h('li', {},
        h('span', {}, d.label, h('span', { class: 'muted small' }, d.last_seen ? ` · synchronisiert ${fmtDate(Date.parse(d.last_seen) / 1000)}` : ' · noch nicht synchronisiert')),
        h('button', { type: 'button', 'aria-label': `${d.label} entfernen`, disabled: ro, onclick: async () => {
          if (!confirm(`${d.label} entfernen? Die Uhr kann dann nicht mehr synchronisieren.`)) return;
          await Backend.deleteDevice(d.id);
          load();
        } }, '×'))));
      if (!devices.length) list.replaceChildren(h('li', {}, h('span', { class: 'muted' }, 'Keine Uhr verbunden')));
    } catch (e) {
      list.replaceChildren(h('li', {}, h('span', { class: 'muted' }, 'Geräte nicht geladen')));
    }
  }
  const btn = h('button', { type: 'button', class: 'btn block', disabled: ro, onclick: async () => {
    btn.disabled = true;
    try {
      const code = await Backend.createDeviceCode('Uhr');
      const copy = h('button', { type: 'button', class: 'btn small', onclick: () => {
        navigator.clipboard.writeText(code).then(() => toast('Kopiert'), () => toast('Markiere den Code und kopiere ihn'));
      } }, 'Kopieren');
      out.replaceChildren(h('div', { class: 'panel' },
        h('div', { class: 'small muted' }, 'Gerätecode (wird nur jetzt angezeigt)'),
        h('div', { class: 'code' }, code),
        h('div', { class: 'row', style: 'margin-top:8px' }, copy),
        h('p', { class: 'small muted' }, 'Garmin Connect App → deine Uhr → Connect IQ Apps → Putztagebuch → Einstellungen → Gerätecode. Dort einfügen.')));
      load();
    } catch (e) {
      toast(e.status ? e.message : 'Braucht eine Verbindung');
    } finally {
      btn.disabled = ro;
    }
  } }, 'Uhr verbinden');
  load();
  return h('div', {}, list, h('div', { style: 'margin-top:8px' }, btn), out);
}

/** Household name, members, and your own display name. */
function homePanel(ro) {
  const name = h('input', { type: 'text', id: 'hn', value: myName(), maxlength: '40', disabled: ro });
  const save = h('button', { type: 'button', class: 'btn small', disabled: ro, onclick: async () => {
    if (!name.value.trim()) return;
    save.disabled = true;
    try {
      await Backend.joinHome(S.home.home.id, name.value);
      await refresh();
      toast('Name gespeichert. Neue Einträge zeigen ihn.');
      render();
    } catch (e) {
      toast(e.status ? e.message : 'Braucht eine Verbindung');
      save.disabled = false;
    }
  } }, 'Speichern');
  return h('div', {},
    h('div', { class: 'panel' },
      h('div', { class: 'small muted' }, 'Haushalt · Code zum Beitreten'),
      h('div', { class: 'row spread' }, h('span', { class: 'code' }, S.home.home.id),
        h('button', { type: 'button', class: 'btn small', onclick: () => share(S.home.home.id) }, 'Teilen')),
      h('div', { class: 'small muted', style: 'margin-top:8px' }, 'Mitglieder'),
      h('div', {}, S.home.members.map((m) => m.name).join(', '))),
    h('div', { class: 'field' }, h('label', { for: 'hn' }, 'Dein Name im Haushalt'),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, name), save)),
    h('a', { class: 'linkish', href: '#/join' }, 'Anderem Haushalt beitreten oder neuen anlegen'));
}

const b64ToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

/** Push notifications: when someone in the household logs a task or joins,
 *  also with the app closed. One subscription per browser. */
function notifyPanel() {
  const box = h('div');
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && PT.vapidKey;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  async function current() {
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }
  async function draw() {
    if (!supported) {
      box.replaceChildren(h('p', { class: 'muted small' }, /iPhone|iPad/.test(navigator.userAgent) && !standalone
        ? 'Auf dem iPhone: erst „Zum Home-Bildschirm“ hinzufügen und die App von dort öffnen, dann geht es hier.'
        : 'Dieser Browser kann keine Push-Benachrichtigungen.'));
      return;
    }
    if (Notification.permission === 'denied') {
      box.replaceChildren(h('p', { class: 'muted small' }, 'Blockiert. Erlaube Benachrichtigungen in den Einstellungen des Browsers für diese Seite.'));
      return;
    }
    const sub = Notification.permission === 'granted' ? await current() : null;
    const btn = h('button', { type: 'button', class: sub ? 'btn block' : 'btn primary block', disabled: !S.online }, sub ? 'Push auf diesem Gerät ausschalten' : 'Push auf diesem Gerät einschalten');
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        if (sub) {
          await Backend.deletePushSubscription(sub.endpoint);
          await sub.unsubscribe();
          toast('Push ausgeschaltet');
        } else {
          if (await Notification.requestPermission() !== 'granted') { draw(); return; }
          const reg = await navigator.serviceWorker.ready;
          const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(PT.vapidKey) });
          await Backend.savePushSubscription(s);
          toast('Push an');
        }
      } catch (e) {
        toast(e.status ? e.message : `Ging nicht: ${e.message || e}`);
      }
      draw();
    };
    box.replaceChildren(
      h('p', { class: 'muted small' }, sub
        ? 'An. Du bekommst eine Nachricht, wenn jemand anderes im Haushalt etwas erledigt oder beitritt, auch wenn die App zu ist.'
        : 'Bekomm eine Nachricht, wenn jemand anderes im Haushalt etwas erledigt oder beitritt, auch wenn die App zu ist.'),
      btn);
  }
  draw();
  return box;
}

/** Share the join code: system share sheet on phones, else copy. */
function share(slug) {
  const url = location.origin + location.pathname;
  const text = `Tritt meinem Haushalt im Putztagebuch bei: Code „${slug}“. ${url}`;
  if (navigator.share) {
    navigator.share({ title: 'Putztagebuch', text }).catch(() => { /* cancelled */ });
    return;
  }
  navigator.clipboard.writeText(text).then(() => toast('Einladung kopiert'), () => toast(`Code: ${slug}`));
}

function viewSettings() {
  const ro = !S.online;
  const draft = tasks().map((t) => ({ ...t }));
  const err = h('div', { class: 'error', role: 'alert' });
  const saveBtn = h('button', { type: 'button', class: 'btn primary block', disabled: ro, onclick: async () => {
    err.textContent = '';
    const clean = draft.map((t) => ({ name: t.name.trim(), desc: (t.desc || '').trim() })).filter((t) => t.name);
    const names = clean.map((t) => t.name);
    if (!clean.length) { err.textContent = 'Mindestens eine Aufgabe.'; return; }
    if (new Set(names).size !== names.length) { err.textContent = 'Jeder Name nur einmal.'; return; }
    saveBtn.disabled = true;
    try {
      S.home.home = await Backend.putHomeData(S.home.home.id, { ...S.home.home.data, tasks: clean });
      store.set('pt.cache.home', S.home);
      toast('Aufgaben gespeichert');
      render();
    } catch (e) {
      err.textContent = e.status ? e.message : 'Nicht gespeichert: Server nicht erreichbar';
      saveBtn.disabled = false;
    }
  } }, 'Aufgaben speichern');

  return h('div', { class: 'narrow' },
    h('h1', {}, 'Einstellungen'),
    h('h2', {}, 'Aufgaben'),
    h('p', { class: 'muted small' }, 'Gilt für den ganzen Haushalt. Die Uhren übernehmen die Liste beim nächsten Sync. Umbenennen ändert alte Einträge nicht.'),
    tasksEditor(draft, ro),
    h('div', { style: 'margin-top:16px' }, saveBtn), err,
    h('h2', {}, 'Benachrichtigungen'),
    notifyPanel(),
    h('h2', {}, 'Uhr'),
    devicesPanel(ro),
    h('h2', {}, 'Daten'),
    h('button', { type: 'button', class: 'btn block', onclick: exportCsv }, 'CSV exportieren'),
    h('div', { class: 'hint' }, S.lastSync ? `Zuletzt geladen ${fmtDate(S.lastSync)} ${fmtTime(S.lastSync)}.` : ''),
    h('h2', {}, 'Haushalt'),
    homePanel(ro),
    h('h2', {}, 'Konto'),
    h('div', { class: 'panel' }, h('div', { class: 'small muted' }, 'Angemeldet als'), h('div', {}, Backend.email() || '')),
    h('details', { class: 'pwbox' }, h('summary', {}, 'Passwort setzen oder ändern'), passwordPanel(ro)),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn danger', onclick: async () => {
        if (!confirm('Abmelden und die gespeicherten Daten von diesem Gerät entfernen? Deine Daten bleiben im Konto.')) return;
        stopLiveUpdates();
        try {
          const sub = 'serviceWorker' in navigator && await (await navigator.serviceWorker.ready).pushManager.getSubscription();
          if (sub) { await Backend.deletePushSubscription(sub.endpoint); await sub.unsubscribe(); }
        } catch (e) { /* not supported or offline */ }
        await Backend.signOut();
        for (const k of ['pt.cache.entries', 'pt.cache.home', 'pt.cache.shopping', 'pt.cache.time']) store.del(k);
        S.entries = []; S.home = null; S.shopping = []; S.lastSync = null;
        setOnline(true);
        location.hash = '#/setup';
        render();
      } }, 'Abmelden')),
  );
}

// ------------------------------------------------------------------ boot

/** Tell about what others did since `before`, as a toast in the open app.
 *  System notifications come only as push (no duplicates). */
function announce(before) {
  if (!S.home || S.home.home.id !== before.home) return;
  const me = Backend.userId();
  // Same sentences as the push: one per person, tasks listed together.
  const done = new Map();
  const msgs = [];
  for (const e of S.entries) {
    if (e.deleted || e.uid === me || before.entries.has(`${e.uid}/${e.id}`)) continue;
    if (nowSec() - e.at > 3600) continue; // back-dated entries are no news
    const who = e.by || 'Jemand';
    const tasks = done.get(who) || [];
    if (!tasks.includes(e.task)) tasks.push(e.task);
    done.set(who, tasks);
  }
  const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} und ${xs[xs.length - 1]}`);
  for (const [who, tasks] of done) msgs.push(`${who} hat ${list(tasks)} erledigt`);
  for (const m of S.home.members) {
    if (m.user_id !== me && !before.members.has(m.user_id)) msgs.push(`${m.name} ist dem Haushalt beigetreten`);
  }
  if (!msgs.length) return;
  toast(msgs.join(' · '), { long: true });
}

// Live updates: another member or a watch changed something. Refetch (small
// data) a moment later, so a burst of changes means one reload; keep forms.
/** Redraw after new data (not a page change). The shopping list redraws
 *  only its items, so typing there is never interrupted; forms wait (dirty). */
function rerender() {
  if (route().name === 'shop' && shopDraw && document.getElementById('si')) shopDraw();
  else if (!dirty) render({ keepScroll: true });
}

let stopLive = null;
let liveTimer = null;
function startLive() {
  if (stopLive || !Backend.signedIn()) return;
  stopLive = Backend.live(() => {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(async () => {
      const before = { entries: new Set(S.entries.map((e) => `${e.uid}/${e.id}`)), members: new Set(S.home ? S.home.members.map((m) => m.user_id) : []), home: S.home && S.home.home.id };
      await refresh();
      rerender();
      announce(before);
    }, 400);
  });
}
function stopLiveUpdates() {
  if (stopLive) { stopLive(); stopLive = null; }
}

async function boot() {
  Backend.takeSessionFromUrl();
  if ('serviceWorker' in navigator) {
    // A new version takes over (sw.js skipWaiting + claim): reload once to run it,
    // unless a form is open. Not on the first install, when nothing controlled the page.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !dirty) location.reload();
    });
    navigator.serviceWorker.register('sw.js')
      .then((reg) => reg.update())
      .catch(() => { /* e.g. file:// or private mode */ });
  }
  render();
  if (Backend.signedIn()) {
    await refresh();
    rerender();
    startLive();
    resavePush();
  }
}

/** Re-register this browser's push subscription for the signed-in user. */
async function resavePush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || Notification.permission !== 'granted') return;
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (sub) await Backend.savePushSubscription(sub);
  } catch (e) { /* offline: next start */ }
}

window.addEventListener('online', () => { if (Backend.signedIn()) refresh().then(rerender); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Backend.signedIn()) refresh().then(rerender);
});

boot();
