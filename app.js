/* putztagebuch web app. Plain JS, no build step. Data: Supabase via backend.js. */
'use strict';

// ------------------------------------------------------------------ utilities

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

// ------------------------------------------------------------------ language

/** UI language: 'auto' follows the browser (German → de, else en). */
const LANG_PREF_KEY = 'pt.lang';
let langPref = store.get(LANG_PREF_KEY, 'auto'); // 'auto' | 'de' | 'en'
function resolveLang(pref) {
  if (pref === 'de' || pref === 'en') return pref;
  const nav = (navigator.languages && navigator.languages[0]) || navigator.language || '';
  return /^de\b/i.test(nav) ? 'de' : 'en';
}
let LANG = resolveLang(langPref);
/** Pick the text for the current language: L('Speichern', 'Save'). */
const L = (de, en) => (LANG === 'en' ? en : de);
const LOCALE = () => (LANG === 'en' ? 'en-GB' : 'de-DE');

/** Document language and the static tab bar labels from index.html. */
function applyLang() {
  document.documentElement.lang = LANG;
  const labels = {
    log: L('Putzen', 'Clean'),
    history: L('Verlauf', 'History'),
    shop: L('Einkauf', 'Shopping'),
    settings: L('Einstellungen', 'Settings'),
  };
  for (const a of document.querySelectorAll('#tabs a[data-tab]')) {
    const span = a.querySelector('span');
    if (span && labels[a.dataset.tab]) span.textContent = labels[a.dataset.tab];
  }
}

function setLang(pref) {
  langPref = pref;
  store.set(LANG_PREF_KEY, pref);
  LANG = resolveLang(pref);
  applyLang();
  render({ keepScroll: true });
}

/** Fallback task list when a household has none yet. */
const DEFAULT_TASKS = () => (LANG === 'en' ? [
  { name: 'Take back bottle deposit', desc: '' },
  { name: 'Take out glass', desc: '' },
  { name: 'Clean fridge', desc: 'All surfaces, walls and shelves' },
  { name: 'Clear out fridge', desc: 'Throw away spoiled food' },
  { name: 'Kitchen deep clean', desc: 'Wipe cupboards' },
  { name: 'Vacuum', desc: 'Everything' },
  { name: 'Clean bathroom', desc: '' },
  { name: 'Water plants', desc: '' },
] : [
  { name: 'Pfand wegbringen', desc: '' },
  { name: 'Glas wegbringen', desc: '' },
  { name: 'Kühlschrank putzen', desc: 'Alle Oberflächen, Wände und Fächer' },
  { name: 'Kühlschrank ausmisten', desc: 'Vergammelte Sachen wegwerfen' },
  { name: 'Küche Deep Clean', desc: 'Fächer wischen' },
  { name: 'Saugen', desc: 'Alles' },
  { name: 'Bad putzen', desc: '' },
  { name: 'Pflanzen gießen', desc: '' },
]);

/** "A, B und C" / "A, B and C" */
const listJoin = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${L('und', 'and')} ${xs[xs.length - 1]}`);

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
const fmtDate = (sec) => new Date(sec * 1000).toLocaleDateString(LOCALE(), { weekday: 'short', day: 'numeric', month: 'short' });
const fmtShortDate = (sec) => new Date(sec * 1000).toLocaleDateString(LOCALE(), { day: 'numeric', month: 'short' });
const fmtTime = (sec) => new Date(sec * 1000).toLocaleTimeString(LOCALE(), { hour: '2-digit', minute: '2-digit' });
const fmtMonth = (sec) => new Date(sec * 1000).toLocaleDateString(LOCALE(), { month: 'long', year: 'numeric' });
function dayKey(sec) {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const noonMs = (sec) => { const d = new Date(sec * 1000); d.setHours(12, 0, 0, 0); return d.getTime(); };
/** Calendar days from a to b (DST-safe). */
const daysBetween = (a, b) => Math.round((noonMs(b) - noonMs(a)) / (DAY * 1000));
/** "heute 14:30", "gestern", "vor 3 Tagen", "noch nie" (or the English forms) */
function fmtAgo(sec) {
  if (sec == null) return L('noch nie', 'never');
  const d = daysBetween(sec, nowSec());
  if (d <= 0) return `${L('heute', 'today')} ${fmtTime(sec)}`;
  if (d === 1) return L('gestern', 'yesterday');
  return L(`vor ${d} ${d === 1 ? 'Tag' : 'Tagen'}`, `${d} ${d === 1 ? 'day' : 'days'} ago`);
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
    L('Offline: gespeicherte Daten, nur lesen', 'Offline: saved data, read only') + (S.lastSync ? ` (${L('Stand', 'as of')} ${fmtDate(S.lastSync)} ${fmtTime(S.lastSync)})` : ''),
    h('button', { type: 'button', onclick: () => refresh().then(render) }, L('Neu laden', 'Reload')),
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
      toast(L('Abgemeldet. Bitte neu anmelden.', 'Signed out. Please sign in again.'));
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
const tasks = () => (homeTasks() && homeTasks().length ? homeTasks() : DEFAULT_TASKS());
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
  const email = h('input', { type: 'email', id: 'se', name: 'email', placeholder: L('du@example.com', 'you@example.com'), autocomplete: 'username', inputmode: 'email', autocapitalize: 'off', spellcheck: 'false', value: store.get('pt.email', '') });
  const pass = h('input', { type: 'password', id: 'sp', name: 'password', autocomplete: 'current-password' });
  const passField = h('div', { class: 'field' }, h('label', { for: 'sp' }, L('Passwort', 'Password')), pass);
  const code = h('input', { type: 'text', id: 'sc', placeholder: '123456', autocomplete: 'one-time-code', inputmode: 'numeric', maxlength: '10' });
  const codeField = h('div', { class: 'field', hidden: true }, h('label', { for: 'sc' }, L('Code aus der E-Mail (falls vorhanden)', 'Code from the email (if there is one)')), code);
  const err = h('div', { class: 'error', role: 'alert' });
  const status = h('div', { class: 'hint' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' });
  const intro = h('p', { class: 'muted' });
  const switchLink = h('button', { type: 'button', class: 'linkish', onclick: () => setMode(mode === 'password' ? 'code' : 'password') });
  let sent = false;

  if (!Backend.configured()) {
    return h('div', { class: 'signin' }, h('h1', {}, 'Putztagebuch'),
      h('p', { class: 'muted' }, L('Kein Backend eingestellt. Trage URL und Key in config.js ein.', 'No backend configured. Enter the URL and key in config.js.')));
  }

  function setMode(m) {
    mode = m;
    store.set('pt.loginMode', m);
    sent = false;
    err.textContent = ''; status.textContent = '';
    passField.hidden = m !== 'password';
    codeField.hidden = true;
    btn.textContent = m === 'password' ? L('Anmelden', 'Sign in') : L('E-Mail senden', 'Send email');
    intro.textContent = m === 'password'
      ? L('Melde dich mit E-Mail und Passwort an.', 'Sign in with your email and password.')
      : L('Wir schicken dir einen Anmeldelink per E-Mail. Für das erste Mal, oder wenn du das Passwort vergessen hast.',
        'We will email you a sign-in link. For the first time, or if you forgot your password.');
    switchLink.textContent = m === 'password'
      ? L('Noch kein Passwort oder vergessen? Per E-Mail anmelden', 'No password yet, or forgot it? Sign in by email')
      : L('Mit Passwort anmelden', 'Sign in with password');
  }

  async function signedIn() {
    status.textContent = '';
    await refresh();
    startLive();
    location.hash = mode === 'code' ? '#/settings' : '#/log';
    render();
    if (mode === 'code') toast(L('Angemeldet. Setz unter Konto ein Passwort, dann geht es auch in der installierten App.', 'Signed in. Set a password under Account, then it also works in the installed app.'));
  }

  async function submit(e) {
    e.preventDefault();
    err.textContent = '';
    const addr = email.value.trim();
    if (!/^\S+@\S+\.\S+$/.test(addr)) { err.textContent = L('Gib deine E-Mail-Adresse ein.', 'Enter your email address.'); return; }
    btn.disabled = true;
    try {
      if (mode === 'password') {
        if (!pass.value) { err.textContent = L('Gib dein Passwort ein.', 'Enter your password.'); return; }
        status.textContent = L('Prüfe…', 'Checking…');
        await Backend.signInPassword(addr, pass.value);
        store.set('pt.email', addr);
        await signedIn();
      } else if (!sent) {
        status.textContent = L('Sende…', 'Sending…');
        await Backend.sendCode(addr);
        store.set('pt.email', addr);
        sent = true;
        codeField.hidden = false;
        btn.textContent = L('Anmelden', 'Sign in');
        status.textContent = L(`E-Mail an ${addr} geschickt. Öffne den Link darin auf diesem Gerät, oder gib den Code ein, falls einer drinsteht.`,
          `Email sent to ${addr}. Open the link in it on this device, or enter the code if there is one.`);
        code.focus();
      } else {
        const c = code.value.replace(/\s/g, '');
        if (!c) { err.textContent = L('Gib den Code aus der E-Mail ein.', 'Enter the code from the email.'); return; }
        status.textContent = L('Prüfe…', 'Checking…');
        await Backend.verifyCode(addr, c);
        await signedIn();
      }
    } catch (ex) {
      status.textContent = '';
      if (!ex.status) err.textContent = L('Keine Verbindung. Versuch es wieder, wenn du online bist.', 'No connection. Try again when you are online.');
      else if (mode === 'password') err.textContent = ex.status === 400 ? L('E-Mail oder Passwort falsch. Noch kein Passwort? Per E-Mail anmelden.', 'Wrong email or password. No password yet? Sign in by email.') : ex.message;
      else if (ex.status === 429) err.textContent = L('Gerade zu viele E-Mails (der kostenlose Dienst schickt nur wenige pro Stunde). Versuch es später, oder nutze ein Passwort.', 'Too many emails right now (the free service only sends a few per hour). Try again later, or use a password.');
      else err.textContent = sent ? L('Der Code hat nicht funktioniert. Prüfe ihn oder fordere einen neuen an.', 'The code did not work. Check it or request a new one.') : ex.message;
    } finally {
      btn.disabled = false;
    }
  }

  setMode(mode);
  return h('div', { class: 'signin' },
    h('h1', {}, 'Putztagebuch'),
    intro,
    h('form', { onsubmit: submit, autocomplete: 'on' },
      h('div', { class: 'field' }, h('label', { for: 'se' }, L('E-Mail', 'Email')), email),
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
  const btn = h('button', { type: 'submit', class: 'btn block', disabled: ro }, L('Passwort speichern', 'Save password'));
  async function submit(e) {
    e.preventDefault();
    err.textContent = '';
    if (pw.value.length < 8) { err.textContent = L('Mindestens 8 Zeichen.', 'At least 8 characters.'); return; }
    if (pw.value !== pw2.value) { err.textContent = L('Die beiden Passwörter sind nicht gleich.', 'The two passwords do not match.'); return; }
    btn.disabled = true;
    try {
      await Backend.setPassword(pw.value);
      pw.value = ''; pw2.value = '';
      toast(L('Passwort gespeichert', 'Password saved'));
    } catch (ex) {
      err.textContent = ex.status ? ex.message : L('Braucht eine Verbindung', 'Needs a connection');
    } finally {
      btn.disabled = ro;
    }
  }
  // The hidden username field lets password managers save the pair.
  return h('form', { onsubmit: submit, autocomplete: 'on' },
    h('input', { type: 'email', name: 'email', autocomplete: 'username', value: Backend.email() || '', hidden: true, readonly: true }),
    h('div', { class: 'field' }, h('label', { for: 'np' }, L('Neues Passwort', 'New password')), pw),
    h('div', { class: 'field' }, h('label', { for: 'np2' }, L('Passwort wiederholen', 'Repeat password')), pw2),
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
  const code = h('input', { type: 'text', id: 'jc', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', placeholder: L('z. B. wg-goethestrasse', 'e.g. flat-baker-street') });
  const name = h('input', { type: 'text', id: 'jn', autocomplete: 'given-name', maxlength: '40', value: myName() });
  const codeLabel = h('label', { for: 'jc' });
  const hint = h('div', { class: 'hint' });
  const err = h('div', { class: 'error', role: 'alert' });
  const btn = h('button', { type: 'submit', class: 'btn primary block' });
  const seg = h('div', { class: 'seg' });
  function setMode(m) {
    mode = m;
    err.textContent = '';
    codeLabel.textContent = m === 'join' ? L('Code des Haushalts', 'Household code') : L('Code für den neuen Haushalt', 'Code for the new household');
    hint.textContent = m === 'join'
      ? L('Den Code bekommst du von jemandem aus dem Haushalt (Einstellungen → Haushalt).', 'Ask someone in the household for the code (Settings → Household).')
      : L('Kleinbuchstaben, Ziffern und Bindestriche, 3–40 Zeichen. Wer den Code kennt, kann beitreten.', 'Lowercase letters, digits and hyphens, 3–40 characters. Anyone who knows the code can join.');
    btn.textContent = m === 'join' ? L('Beitreten', 'Join') : L('Anlegen und beitreten', 'Create and join');
    seg.replaceChildren(
      h('a', { href: '#', class: m === 'join' ? 'on' : '', onclick: (e) => { e.preventDefault(); setMode('join'); } }, L('Beitreten', 'Join')),
      h('a', { href: '#', class: m === 'create' ? 'on' : '', onclick: (e) => { e.preventDefault(); setMode('create'); } }, L('Neu anlegen', 'Create new')));
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
    if (!slug) { err.textContent = L('Gib einen Code ein.', 'Enter a code.'); return; }
    if (mode === 'create' && !/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) {
      err.textContent = L('Nur a–z, 0–9 und Bindestriche, 3–40 Zeichen, nicht mit Bindestrich anfangen oder enden.', 'Only a–z, 0–9 and hyphens, 3–40 characters, not starting or ending with a hyphen.');
      return;
    }
    if (!name.value.trim()) { err.textContent = L('Gib deinen Namen ein.', 'Enter your name.'); return; }
    btn.disabled = true;
    try {
      if (mode === 'join') await Backend.joinHome(slug, name.value);
      else await Backend.createHome(slug, name.value);
      await refresh();
      location.hash = '#/log';
      render();
      toast(mode === 'join'
        ? L(`Willkommen im Haushalt ${S.home.home.name}`, `Welcome to the household ${S.home.home.name}`)
        : L(`Haushalt ${S.home.home.name} angelegt. Teile den Code zum Beitreten.`, `Household ${S.home.home.name} created. Share the code so others can join.`));
    } catch (ex) {
      err.textContent = !ex.status ? L('Keine Verbindung.', 'No connection.')
        : /unknown home/.test(ex.message) ? L('Diesen Haushalt gibt es nicht. Prüfe den Code.', 'This household does not exist. Check the code.')
        : /slug taken/.test(ex.message) ? L('Diesen Code gibt es schon. Wähle einen anderen, oder tritt bei.', 'This code is already taken. Choose another one, or join.')
        : /invalid slug/.test(ex.message) ? L('Ungültiger Code.', 'Invalid code.')
        : ex.message;
    } finally {
      btn.disabled = false;
    }
  }
  setMode('join');
  return h('div', { class: 'signin' },
    switching ? h('div', { class: 'topbar' },
      h('button', { type: 'button', class: 'back', 'aria-label': L('Zurück', 'Back'), onclick: () => history.back() }, '‹'),
      h('h1', {}, L('Haushalt wechseln', 'Switch household'))) : h('h1', {}, L('Dein Haushalt', 'Your household')),
    h('p', { class: 'muted' }, switching
      ? L(`Du bist gerade in ${S.home.home.name}. Deine bisherigen Einträge bleiben dort.`, `You are in ${S.home.home.name} right now. Your entries so far stay there.`)
      : L('Alle im Haushalt sehen dieselben Aufgaben und wer wann was geputzt hat.', 'Everyone in the household sees the same tasks and who cleaned what when.')),
    seg,
    h('form', { onsubmit: submit },
      h('div', { class: 'field' }, codeLabel, code, hint),
      h('div', { class: 'field' }, h('label', { for: 'jn' }, L('Dein Name', 'Your name')), name),
      btn, err),
    switching ? null : h('button', { type: 'button', class: 'linkish', onclick: async () => { await Backend.signOut(); render(); } }, L('Abmelden', 'Sign out')));
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
        toast(`${t.name}: ${L('erledigt', 'done')}`, { label: L('Rückgängig', 'Undo'), run: async () => {
          try {
            upsertLocal(await Backend.deleteEntry(saved));
            render();
          } catch (e) { toast(e.status ? e.message : L('Braucht eine Verbindung', 'Needs a connection')); }
        } });
      } catch (e) {
        toast(e.status ? e.message : L('Nicht gespeichert: Server nicht erreichbar', 'Not saved: server unreachable'));
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
  if (!recent.length) list.append(h('div', { class: 'empty' }, L('Noch nichts erledigt. Tipp auf eine Aufgabe.', 'Nothing done yet. Tap a task.')));

  return h('div', { class: 'log' },
    h('div', { class: 'pane' },
      h('div', { class: 'eyebrow' }, new Date().toLocaleDateString(LOCALE(), { weekday: 'long', day: 'numeric', month: 'long' })),
      h('h1', {}, L('Was hast du geputzt?', 'What did you clean?')),
      grid),
    h('div', { class: 'pane' },
      h('div', { class: 'row spread' }, h('h2', {}, L('Zuletzt', 'Recent')),
        h('a', { class: 'linkish', href: '#/new' }, L('Nachtragen', 'Add past entry'))),
      list,
      recent.length ? h('a', { class: 'linkish', href: '#/history' }, L('Ganzer Verlauf', 'Full history')) : null));
}

// ------------------------------------------------------------------ edit / add entry

function viewEdit(id, presetTask) {
  const ro = !S.online;
  const existing = id != null ? S.entries.find((e) => e.id === id && !e.deleted) : null;
  if (id != null && !existing) {
    return h('div', {}, h('h1', {}, L('Eintrag nicht gefunden', 'Entry not found')), h('a', { href: '#/log', class: 'linkish' }, L('Zurück', 'Back')));
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
    if (t == null) { err.textContent = L('Gib Datum und Uhrzeit ein.', 'Enter date and time.'); return; }
    try {
      if (existing) upsertLocal(await Backend.putEntry({ ...existing, task: task.value, at: t }));
      else await logTask(task.value, t);
      dirty = false;
      toast(L('Gespeichert', 'Saved'));
      history.back();
    } catch (ex) {
      err.textContent = ex.status ? ex.message : L('Nicht gespeichert: Server nicht erreichbar', 'Not saved: server unreachable');
    }
  }
  async function del() {
    if (!confirm(L(`${existing.task} vom ${fmtDate(existing.at)} löschen?`, `Delete ${existing.task} from ${fmtDate(existing.at)}?`))) return;
    try {
      upsertLocal(await Backend.deleteEntry(existing));
      dirty = false;
      toast(L('Gelöscht', 'Deleted'));
      history.back();
    } catch (ex) {
      err.textContent = ex.status ? ex.message : L('Nicht gelöscht: Server nicht erreichbar', 'Not deleted: server unreachable');
    }
  }

  return h('div', { class: 'narrow' },
    h('div', { class: 'topbar' },
      h('button', { type: 'button', class: 'back', 'aria-label': L('Zurück', 'Back'), onclick: () => history.back() }, '‹'),
      h('h1', {}, existing ? L('Eintrag bearbeiten', 'Edit entry') : L('Nachtragen', 'Add past entry'))),
    h('form', { onsubmit: save },
      h('div', { class: 'field' }, h('label', { for: 'et' }, L('Aufgabe', 'Task')), task),
      h('div', { class: 'field' }, h('label', { for: 'ea' }, L('Wann', 'When')), at),
      err,
      h('div', { class: 'actions' },
        existing ? h('button', { type: 'button', class: 'btn danger', disabled: ro, onclick: del }, L('Löschen', 'Delete')) : null,
        h('button', { type: 'submit', class: 'btn primary', disabled: ro }, L('Speichern', 'Save')))));
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
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': L(`Wie oft pro Woche, letzte ${WEEKS} Wochen`, `How often per week, last ${WEEKS} weeks`) });
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
        const times = n === 0 ? L('nicht', 'not done') : n === 1 ? L('einmal', 'once') : `${n}×`;
        tip.replaceChildren(`${t.name} · ${L('Woche ab', 'week of')} ${fmtShortDate(st)}: ${times}`);
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
    h('span', {}, h('i', { class: 'c0' }), L('nicht', 'none')),
    h('span', {}, h('i', { class: 'c1' }), '1×'),
    h('span', {}, h('i', { class: 'c2' }), '2×'),
    h('span', {}, h('i', { class: 'c3' }), L('3× oder mehr', '3× or more')));
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
  if (!list.length) all.append(h('div', { class: 'empty' }, L('Noch keine Einträge.', 'No entries yet.')));

  return h('div', { class: 'stats' },
    h('h1', {}, L('Verlauf', 'History')),
    boardSection(),
    h('h2', {}, L(`Letzte ${WEEKS} Wochen`, `Last ${WEEKS} weeks`)),
    weekGrid(list),
    h('h2', {}, L('Pro Aufgabe', 'Per task')),
    h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {},
        h('th', {}, L('Aufgabe', 'Task')), h('th', {}, L('Zuletzt', 'Last')), h('th', { class: 'r' }, L('90 Tage', '90 days')))),
      h('tbody', {}, rows))),
    h('h2', {}, L('Alle Einträge', 'All entries')),
    all);
}

// ------------------------------------------------------------------ leaderboard

/** A function, not a constant: the labels follow the current language. */
const PERIODS = () => [
  { key: 'week', label: L('Diese Woche', 'This week') },
  { key: 'month', label: L('Dieser Monat', 'This month') },
  { key: 'all', label: L('Gesamt', 'All time') },
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
  const draw = () => box.replaceChildren(...boardContent(boardPeriod, (k) => { boardPeriod = k; store.set('pt.boardPeriod', k); draw(); }).filter(Boolean));
  draw();
  return box;
}

/** Members ranked by tasks done in the period; members with none are listed too. */
function boardContent(period, choose) {
  const key = PERIODS().some((p) => p.key === period) ? period : 'week';
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
    h('h2', {}, L('Rangliste', 'Leaderboard')),
    h('div', { class: 'seg', role: 'tablist' }, PERIODS().map((p) =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(p.key === key), class: p.key === key ? 'on' : '', onclick: () => choose(p.key) }, p.label))),
    done.length ? list : h('div', { class: 'empty' }, L('In diesem Zeitraum hat noch niemand geputzt.', 'Nobody has cleaned in this period yet.')),
    done.length ? h('p', { class: 'hint' }, L(
      `${done.length} ${done.length === 1 ? 'erledigte Aufgabe' : 'erledigte Aufgaben'}. Jede Aufgabe zählt einmal.`,
      `${done.length} ${done.length === 1 ? 'task' : 'tasks'} done. Each task counts once.`)) : null,
  ];
}

// ------------------------------------------------------------------ shopping list

/** Einkaufszettel: the household's shared list. Tap to tick off; ticked items
 *  stay below until someone clears them. Changes show live for everyone. */
let shopDraw = null; // redraws the open shopping list in place

function viewShopping() {
  const ro = !S.online;
  const input = h('input', { type: 'text', id: 'si', placeholder: L('Was fehlt?', 'What\'s missing?'), autocomplete: 'off', enterkeyhint: 'done', maxlength: '200', disabled: ro });
  const save = () => store.set('pt.cache.shopping', S.shopping);
  const byId = (id) => S.shopping.find((x) => x.id === id);
  const fail = (e) => { toast(e.status ? e.message : L('Nicht gespeichert: Server nicht erreichbar', 'Not saved: server unreachable')); refresh().then(() => render({ keepScroll: true })); };

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
    h('button', { type: 'button', class: 'shop-del', 'aria-label': L(`${item.text} löschen`, `Delete ${item.text}`), disabled: ro, onclick: () => remove(item) }, '×'));

  const list = h('div');
  function draw() {
    const open = S.shopping.filter((x) => !x.done).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const done = S.shopping.filter((x) => x.done).sort((a, b) => (b.done_at || '').localeCompare(a.done_at || ''));
    // replaceChildren() would print null as text: drop the empty parts.
    list.replaceChildren(...[
      open.length ? h('ul', { class: 'shop' }, open.map(row)) : h('div', { class: 'empty' }, L('Alles da.', 'All there.')),
      done.length ? h('div', { class: 'row spread shop-done-head' },
        h('h2', {}, `${L('Im Wagen', 'In the cart')} (${done.length})`),
        h('button', { type: 'button', class: 'linkish', disabled: ro, onclick: clearDone }, L('Leeren', 'Clear'))) : null,
      done.length ? h('ul', { class: 'shop' }, done.map(row)) : null,
    ].filter(Boolean));
  }
  draw();
  shopDraw = draw;

  return h('div', { class: 'narrow' },
    h('h1', {}, L('Einkaufszettel', 'Shopping list')),
    h('form', { class: 'row shop-add', onsubmit: add },
      h('div', { class: 'grow' }, input),
      h('button', { type: 'submit', class: 'btn primary', disabled: ro }, L('Dazu', 'Add'))),
    list);
}

// ------------------------------------------------------------------ settings

/** Task list: name and optional description. */
function tasksEditor(draft, ro) {
  const wrap = h('div', { class: 'tasked' });
  function draw() {
    wrap.replaceChildren(...draft.map((t, i) => h('div', { class: 'tasked-row' },
      h('div', { class: 'grow' },
        h('input', { type: 'text', value: t.name, placeholder: L('Name', 'Name'), 'aria-label': L('Name', 'Name'), disabled: ro, oninput: (e) => { t.name = e.target.value; } }),
        h('input', { type: 'text', style: 'margin-top:6px', value: t.desc || '', placeholder: L('Beschreibung (optional)', 'Description (optional)'), 'aria-label': L('Beschreibung', 'Description'), disabled: ro, oninput: (e) => { t.desc = e.target.value; } })),
      h('div', { class: 'tasked-btns' },
        h('button', { type: 'button', 'aria-label': L(`${t.name} nach oben`, `Move ${t.name} up`), disabled: ro || i === 0, onclick: () => { draft.splice(i - 1, 0, draft.splice(i, 1)[0]); draw(); } }, '↑'),
        h('button', { type: 'button', 'aria-label': L(`${t.name} entfernen`, `Remove ${t.name}`), disabled: ro, onclick: () => { draft.splice(i, 1); draw(); } }, '×')))));
  }
  draw();
  return h('div', {}, wrap,
    h('button', { type: 'button', class: 'btn small', style: 'margin-top:10px', disabled: ro, onclick: () => { draft.push({ name: '', desc: '' }); draw(); wrap.lastChild.querySelector('input').focus(); } }, L('+ Aufgabe', '+ Task')));
}

const csvCell = (v) => (v == null ? '' : /[",\n;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** CSV of all entries, made in the browser from the loaded data. */
function exportCsv() {
  const rows = visibleEntries().slice().reverse().map((e) => [e.id, toLocalInput(e.at).replace('T', ' '), e.task, e.by]);
  const head = LANG === 'en' ? ['id', 'time', 'task', 'who'] : ['id', 'zeit', 'aufgabe', 'wer'];
  const text = [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = h('a', { href: url, download: `putztagebuch-${dayKey(nowSec())}.csv` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Connect a watch: the code is shown once; only its hash is stored. */
function devicesPanel(ro) {
  const list = h('ul', { class: 'editlist' }, h('li', {}, h('span', { class: 'muted' }, L('Lade…', 'Loading…'))));
  const out = h('div');
  async function load() {
    try {
      const devices = await Backend.listDevices();
      list.replaceChildren(...devices.map((d) => h('li', {},
        h('span', {}, d.label, h('span', { class: 'muted small' }, d.last_seen
          ? ` · ${L('synchronisiert', 'synced')} ${fmtDate(Date.parse(d.last_seen) / 1000)}`
          : ` · ${L('noch nicht synchronisiert', 'not synced yet')}`)),
        h('button', { type: 'button', 'aria-label': L(`${d.label} entfernen`, `Remove ${d.label}`), disabled: ro, onclick: async () => {
          if (!confirm(L(`${d.label} entfernen? Die Uhr kann dann nicht mehr synchronisieren.`, `Remove ${d.label}? The watch will no longer be able to sync.`))) return;
          await Backend.deleteDevice(d.id);
          load();
        } }, '×'))));
      if (!devices.length) list.replaceChildren(h('li', {}, h('span', { class: 'muted' }, L('Keine Uhr verbunden', 'No watch connected'))));
    } catch (e) {
      list.replaceChildren(h('li', {}, h('span', { class: 'muted' }, L('Geräte nicht geladen', 'Could not load devices'))));
    }
  }
  const btn = h('button', { type: 'button', class: 'btn block', disabled: ro, onclick: async () => {
    btn.disabled = true;
    try {
      const code = await Backend.createDeviceCode(L('Uhr', 'Watch'));
      const copy = h('button', { type: 'button', class: 'btn small', onclick: () => {
        navigator.clipboard.writeText(code).then(() => toast(L('Kopiert', 'Copied')), () => toast(L('Markiere den Code und kopiere ihn', 'Select the code and copy it')));
      } }, L('Kopieren', 'Copy'));
      out.replaceChildren(h('div', { class: 'panel' },
        h('div', { class: 'small muted' }, L('Gerätecode (wird nur jetzt angezeigt)', 'Device code (shown only now)')),
        h('div', { class: 'code' }, code),
        h('div', { class: 'row', style: 'margin-top:8px' }, copy),
        h('p', { class: 'small muted' }, L('Garmin Connect App → deine Uhr → Connect IQ Apps → Putztagebuch → Einstellungen → Gerätecode. Dort einfügen.',
          'Garmin Connect app → your watch → Connect IQ Apps → Putztagebuch → Settings → Device code. Paste it there.'))));
      load();
    } catch (e) {
      toast(e.status ? e.message : L('Braucht eine Verbindung', 'Needs a connection'));
    } finally {
      btn.disabled = ro;
    }
  } }, L('Uhr verbinden', 'Connect watch'));
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
      toast(L('Name gespeichert. Neue Einträge zeigen ihn.', 'Name saved. New entries will show it.'));
      render();
    } catch (e) {
      toast(e.status ? e.message : L('Braucht eine Verbindung', 'Needs a connection'));
      save.disabled = false;
    }
  } }, L('Speichern', 'Save'));
  return h('div', {},
    h('div', { class: 'panel' },
      h('div', { class: 'small muted' }, L('Haushalt · Code zum Beitreten', 'Household · code to join')),
      h('div', { class: 'row spread' }, h('span', { class: 'code' }, S.home.home.id),
        h('button', { type: 'button', class: 'btn small', onclick: () => share(S.home.home.id) }, L('Teilen', 'Share'))),
      h('div', { class: 'small muted', style: 'margin-top:8px' }, L('Mitglieder', 'Members')),
      h('div', {}, S.home.members.map((m) => m.name).join(', '))),
    h('div', { class: 'field' }, h('label', { for: 'hn' }, L('Dein Name im Haushalt', 'Your name in the household')),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, name), save)),
    h('a', { class: 'linkish', href: '#/join' }, L('Anderem Haushalt beitreten oder neuen anlegen', 'Join another household or create a new one')));
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
        ? L('Auf dem iPhone: erst „Zum Home-Bildschirm“ hinzufügen und die App von dort öffnen, dann geht es hier.', 'On iPhone: first tap “Add to Home Screen” and open the app from there, then it works here.')
        : L('Dieser Browser kann keine Push-Benachrichtigungen.', 'This browser does not support push notifications.')));
      return;
    }
    if (Notification.permission === 'denied') {
      box.replaceChildren(h('p', { class: 'muted small' }, L('Blockiert. Erlaube Benachrichtigungen in den Einstellungen des Browsers für diese Seite.', 'Blocked. Allow notifications for this site in your browser settings.')));
      return;
    }
    const sub = Notification.permission === 'granted' ? await current() : null;
    pushActive = !!sub;
    const btn = h('button', { type: 'button', class: sub ? 'btn block' : 'btn primary block', disabled: !S.online },
      sub ? L('Push auf diesem Gerät ausschalten', 'Turn off push on this device') : L('Push auf diesem Gerät einschalten', 'Turn on push on this device'));
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        if (sub) {
          await Backend.deletePushSubscription(sub.endpoint);
          await sub.unsubscribe();
          toast(L('Push ausgeschaltet', 'Push turned off'));
        } else {
          if (await Notification.requestPermission() !== 'granted') { draw(); return; }
          const reg = await navigator.serviceWorker.ready;
          const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(PT.vapidKey) });
          await Backend.savePushSubscription(s);
          toast(L('Push an', 'Push on'));
        }
      } catch (e) {
        toast(e.status ? e.message : `${L('Ging nicht', 'Did not work')}: ${e.message || e}`);
      }
      draw();
    };
    if (!sub) {
      box.replaceChildren(
        h('p', { class: 'muted small' }, L('Bekomm eine Nachricht, wenn jemand anderes im Haushalt etwas erledigt, beitritt oder den Einkaufszettel ändert, auch wenn die App zu ist.',
          'Get a message when someone else in the household does a task, joins or changes the shopping list, even when the app is closed.')),
        btn);
      return;
    }
    // Per device: which kinds of news, in groups. A group's main switch turns
    // all its items on or off; the arrow opens the group for single items.
    let prefs = { ...NEWS_DEFAULTS };
    try { prefs = { ...prefs, ...((await Backend.getPushPrefs(sub.endpoint)) || {}) }; setNewsPrefs(prefs); } catch (e) { /* offline: show defaults */ }
    async function save(changes) {
      const old = { ...prefs };
      Object.assign(prefs, changes);
      try {
        await Backend.setPushPrefs(sub.endpoint, changes);
        setNewsPrefs(changes);
      } catch (ex) {
        Object.assign(prefs, old);
        toast(ex.status ? ex.message : L('Braucht eine Verbindung', 'Needs a connection'));
      }
      drawGroups();
    }
    const sw = (checked, onchange, label) => h('input', { type: 'checkbox', class: 'switch', checked, disabled: !S.online, 'aria-label': label, onchange });
    const item = (key, label, hint) => h('label', { class: 'switch-row sub' },
      h('span', { class: 'grow' }, h('span', {}, label), hint ? h('span', { class: 'small muted block' }, hint) : null),
      sw(prefs[key], (e) => save({ [key]: e.target.checked }), label));
    const group = (id, label, hint, items) => {
      const keys = items.map((i) => i[0]);
      const on = keys.filter((k) => prefs[k]).length;
      const head = h('div', { class: 'switch-row' },
        h('button', { type: 'button', class: 'expand' + (openGroups.has(id) ? ' open' : ''), 'aria-expanded': String(openGroups.has(id)), 'aria-label': L('Einzeln einstellen', 'Choose individually'),
          onclick: () => { if (openGroups.has(id)) openGroups.delete(id); else openGroups.add(id); drawGroups(); } }, '›'),
        h('span', { class: 'grow' }, h('span', { class: 'who' }, label),
          h('span', { class: 'small muted block' }, items.length > 1 && on > 0 && on < keys.length ? L(`${on} von ${keys.length} an`, `${on} of ${keys.length} on`) : hint)),
        sw(on > 0, (e) => save(Object.fromEntries(keys.map((k) => [k, e.target.checked]))), label));
      if (on > 0 && on < keys.length) head.querySelector('.switch').classList.add('partial');
      return h('div', { class: 'switch-group' }, head,
        openGroups.has(id) ? h('div', { class: 'switch-subs' }, items.map(([k, l, hh]) => item(k, l, hh))) : null);
    };
    const groups = h('div', { class: 'panel switches' });
    function drawGroups() {
      groups.replaceChildren(
        group('general', L('Allgemein', 'General'), L('Wenn jemand dem Haushalt beitritt', 'When someone joins the household'), [
          ['notify_join', L('Neue Mitglieder', 'New members'), L('Wenn jemand dem Haushalt beitritt', 'When someone joins the household')],
        ]),
        group('tasks', L('Aufgaben', 'Tasks'), L('Erledigt, geänderte Aufgabenliste', 'Done, changed task list'), [
          ['notify_tasks', L('Erledigt', 'Done'), L('Wenn jemand eine Aufgabe abhakt', 'When someone ticks off a task')],
          ['notify_config', L('Aufgabenliste geändert', 'Task list changed'), L('Wenn jemand Aufgaben hinzufügt, umbenennt oder entfernt', 'When someone adds, renames or removes tasks')],
        ]),
        group('shop', L('Einkauf', 'Shopping'), L('Gesammelt nach 5 ruhigen Minuten', 'Bundled after 5 quiet minutes'), [
          ['notify_shop_add', L('Neue Sachen', 'New items'), L('Wenn jemand etwas auf den Einkaufszettel setzt', 'When someone adds something to the shopping list')],
          ['notify_shop_done', L('Eingekauft', 'Bought'), L('Wenn jemand etwas abhakt', 'When someone ticks something off')],
        ]));
    }
    drawGroups();
    box.replaceChildren(groups, btn);
  }
  draw();
  return box;
}

/** Share the join code: system share sheet on phones, else copy. */
function share(slug) {
  const url = location.origin + location.pathname;
  const text = L(`Tritt meinem Haushalt im Putztagebuch bei: Code „${slug}“. ${url}`, `Join my household on Putztagebuch: code “${slug}”. ${url}`);
  if (navigator.share) {
    navigator.share({ title: 'Putztagebuch', text }).catch(() => { /* cancelled */ });
    return;
  }
  navigator.clipboard.writeText(text).then(() => toast(L('Einladung kopiert', 'Invitation copied')), () => toast(`Code: ${slug}`));
}

/** "Version 1.0.0" (web/version.js; the commit stays internal). */
function appVersionLine() {
  const v = window.PT_VERSION || {};
  return h('p', { class: 'hint version' }, v.version ? `${L('Version', 'Version')} ${v.version}` : '');
}

function viewSettings() {
  const ro = !S.online;
  const draft = tasks().map((t) => ({ ...t }));
  const err = h('div', { class: 'error', role: 'alert' });
  const saveBtn = h('button', { type: 'button', class: 'btn primary block', disabled: ro, onclick: async () => {
    err.textContent = '';
    const clean = draft.map((t) => ({ name: t.name.trim(), desc: (t.desc || '').trim() })).filter((t) => t.name);
    const names = clean.map((t) => t.name);
    if (!clean.length) { err.textContent = L('Mindestens eine Aufgabe.', 'At least one task.'); return; }
    if (new Set(names).size !== names.length) { err.textContent = L('Jeder Name nur einmal.', 'Each name only once.'); return; }
    saveBtn.disabled = true;
    try {
      ownTasksSavedAt = Date.now();
      S.home.home = await Backend.putHomeData(S.home.home.id, { ...S.home.home.data, tasks: clean });
      store.set('pt.cache.home', S.home);
      toast(L('Aufgaben gespeichert', 'Tasks saved'));
      render();
    } catch (e) {
      err.textContent = e.status ? e.message : L('Nicht gespeichert: Server nicht erreichbar', 'Not saved: server unreachable');
      saveBtn.disabled = false;
    }
  } }, L('Aufgaben speichern', 'Save tasks'));

  const langBtn = (pref, label) => h('button', { type: 'button', class: langPref === pref ? 'on' : '', 'aria-pressed': String(langPref === pref), onclick: () => setLang(pref) }, label);

  return h('div', { class: 'narrow' },
    h('h1', {}, L('Einstellungen', 'Settings')),
    h('h2', {}, L('Aufgaben', 'Tasks')),
    h('p', { class: 'muted small' }, L('Gilt für den ganzen Haushalt. Die Uhren übernehmen die Liste beim nächsten Sync. Umbenennen ändert alte Einträge nicht.',
      'Applies to the whole household. Watches pick up the list on their next sync. Renaming does not change old entries.')),
    tasksEditor(draft, ro),
    h('div', { style: 'margin-top:16px' }, saveBtn), err,
    h('h2', {}, L('Benachrichtigungen', 'Notifications')),
    notifyPanel(),
    h('h2', {}, L('Uhr', 'Watch')),
    devicesPanel(ro),
    h('h2', {}, L('Daten', 'Data')),
    h('button', { type: 'button', class: 'btn block', onclick: exportCsv }, L('CSV exportieren', 'Export CSV')),
    h('div', { class: 'hint' }, S.lastSync ? L(`Zuletzt geladen ${fmtDate(S.lastSync)} ${fmtTime(S.lastSync)}.`, `Last loaded ${fmtDate(S.lastSync)} ${fmtTime(S.lastSync)}.`) : ''),
    h('h2', {}, L('Haushalt', 'Household')),
    homePanel(ro),
    h('h2', {}, L('Sprache', 'Language')),
    h('div', { class: 'seg' },
      langBtn('auto', L('Automatisch', 'Automatic')),
      langBtn('de', 'Deutsch'),
      langBtn('en', 'English')),
    h('h2', {}, L('Konto', 'Account')),
    h('div', { class: 'panel' }, h('div', { class: 'small muted' }, L('Angemeldet als', 'Signed in as')), h('div', {}, Backend.email() || '')),
    h('details', { class: 'pwbox' }, h('summary', {}, L('Passwort setzen oder ändern', 'Set or change password')), passwordPanel(ro)),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn danger', onclick: async () => {
        if (!confirm(L('Abmelden und die gespeicherten Daten von diesem Gerät entfernen? Deine Daten bleiben im Konto.', 'Sign out and remove the saved data from this device? Your data stays in your account.'))) return;
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
      } }, L('Abmelden', 'Sign out'))),
    appVersionLine()
  );
}

// ------------------------------------------------------------------ boot

let ownTasksSavedAt = 0; // our own task list save is no news
let pushActive = false; // this browser gets push, so no in-app cards

/** Per-device news choices (from the push settings; all on by default). */
const NEWS_DEFAULTS = { notify_join: true, notify_config: true, notify_tasks: true, notify_shop_add: true, notify_shop_done: true };
let newsPrefs = { ...NEWS_DEFAULTS, ...store.get('pt.newsPrefs', {}) };
const openGroups = new Set(); // expanded notification groups in settings
function setNewsPrefs(p) { newsPrefs = { ...newsPrefs, ...p }; store.set('pt.newsPrefs', newsPrefs); }

/** Same wording as the push: one title, details in the body when there is more. */
function newsMessage(events) {
  const groups = new Map();
  for (const e of events) {
    const key = `${e.kind}|${e.who}`;
    const g = groups.get(key) || { who: e.who, kind: e.kind, what: [] };
    if (e.what && !g.what.includes(e.what)) g.what.push(e.what);
    groups.set(key, g);
  }
  const sentence = (g, short) => {
    const n = g.what.length;
    const many = short && n > 1;
    const list = listJoin(g.what);
    if (g.kind === 'join') return L(`${g.who} ist dem Haushalt beigetreten`, `${g.who} joined the household`);
    if (g.kind === 'config') return g.who ? L(`${g.who} hat die Aufgabenliste geändert`, `${g.who} changed the task list`) : L('Die Aufgabenliste wurde geändert', 'The task list was changed');
    if (g.kind === 'entry') {
      return many ? L(`${g.who} hat ${n} Aufgaben erledigt`, `${g.who} did ${n} tasks`)
        : L(`${g.who} hat ${list} erledigt`, `${g.who} did ${list}`);
    }
    if (g.kind === 'shop_add') {
      return many ? L(`${g.who} hat ${n} Sachen auf den Einkaufszettel gesetzt`, `${g.who} added ${n} items to the shopping list`)
        : L(`${g.who} hat ${list} auf den Einkaufszettel gesetzt`, `${g.who} added ${list} to the shopping list`);
    }
    return many ? L(`${g.who} hat ${n} Sachen eingekauft`, `${g.who} bought ${n} items`)
      : L(`${g.who} hat ${list} eingekauft`, `${g.who} bought ${list}`);
  };
  const all = [...groups.values()];
  if (all.length === 1) {
    const g = all[0];
    return g.what.length <= 1 ? { title: sentence(g, false), body: '' } : { title: sentence(g, true), body: listJoin(g.what) };
  }
  const shopOnly = all.every((g) => g.kind.startsWith('shop'));
  return {
    title: shopOnly ? L('Neues auf dem Einkaufszettel', 'Shopping list updates') : L('Neues im Haushalt', 'News in the household'),
    body: all.map((g) => sentence(g, false)).join('\n'),
  };
}

/** In-app notification card at the top; tap opens the place, × or time closes it. */
function notice({ title, body }, href) {
  let box = document.getElementById('notices');
  if (!box) { box = h('div', { id: 'notices', class: 'notices', 'aria-live': 'polite' }); document.body.append(box); }
  const close = () => { card.classList.add('out'); setTimeout(() => card.remove(), 250); };
  const card = h('div', { class: 'notice', role: 'status' },
    h('img', { src: 'icons/icon-192.png', alt: '', class: 'notice-icon' }),
    h('button', { type: 'button', class: 'notice-text', onclick: () => { close(); if (href) location.hash = href; } },
      h('span', { class: 'notice-title' }, title),
      body ? h('span', { class: 'notice-body' }, body) : null),
    h('button', { type: 'button', class: 'notice-x', 'aria-label': L('Schließen', 'Close'), onclick: close }, '×'));
  box.prepend(card);
  while (box.children.length > 3) box.lastChild.remove();
  setTimeout(close, 7000);
}

/** What others did since `before`: in-app cards, filtered by the device's switches.
 *  (Push covers the closed app; iOS shows no push banner while the app is open.) */
function announce(before) {
  if (!S.home || S.home.home.id !== before.home) return;
  // With push on, the push is this device's notification (iOS shows it even
  // with the app open, and Safari requires a visible notification per push).
  if (pushActive) return;
  const me = Backend.userId();
  const nameOf = (uid) => (S.home.members.find((m) => m.user_id === uid) || {}).name || L('Jemand', 'Someone');
  const tasks = [];
  const shop = [];
  if (newsPrefs.notify_tasks) {
    for (const e of S.entries) {
      if (e.deleted || e.uid === me || before.entries.has(`${e.uid}/${e.id}`)) continue;
      if (nowSec() - e.at > 3600) continue; // back-dated entries are no news
      tasks.push({ kind: 'entry', who: e.by || L('Jemand', 'Someone'), what: e.task });
    }
  }
  if (newsPrefs.notify_join) {
    for (const m of S.home.members) {
      if (m.user_id !== me && !before.members.has(m.user_id)) tasks.push({ kind: 'join', who: m.name });
    }
  }
  // Who changed the list is not known here; skip our own save.
  if (newsPrefs.notify_config && JSON.stringify(homeTasks()) !== before.tasks && Date.now() - ownTasksSavedAt > 10000) {
    tasks.push({ kind: 'config', who: '' });
  }
  for (const it of S.shopping) {
    const was = before.shopping.get(it.id);
    if (!was && it.created_by && it.created_by !== me && newsPrefs.notify_shop_add) shop.push({ kind: 'shop_add', who: nameOf(it.created_by), what: it.text });
    if (it.done && was && !was.done && it.done_by && it.done_by !== me && newsPrefs.notify_shop_done) shop.push({ kind: 'shop_done', who: nameOf(it.done_by), what: it.text });
  }
  if (tasks.length) notice(newsMessage(tasks), '#/history');
  if (shop.length) notice(newsMessage(shop), '#/shop');
}

// Live updates: another member or a watch changed something. Refetch (small
// data) a moment later, so a burst of changes means one reload; keep forms.
/** A new web app version was deployed: fetch the service worker; if it is
 *  new, it takes over and the page reloads (controllerchange), unless a form
 *  is open — then it reloads once the form is done. */
function checkForUpdate() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.getRegistration().then((reg) => reg && reg.update()).catch(() => {});
}

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
  stopLive = Backend.live((what) => {
    if (what === 'version') { checkForUpdate(); return; }
    clearTimeout(liveTimer);
    liveTimer = setTimeout(async () => {
      const before = {
        entries: new Set(S.entries.map((e) => `${e.uid}/${e.id}`)),
        members: new Set(S.home ? S.home.members.map((m) => m.user_id) : []),
        shopping: new Map(S.shopping.map((x) => [x.id, { done: x.done }])),
        tasks: JSON.stringify(homeTasks()),
        home: S.home && S.home.home.id,
      };
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
  applyLang();
  Backend.takeSessionFromUrl();
  if ('serviceWorker' in navigator) {
    // A new version takes over (sw.js skipWaiting + claim): reload once to run it,
    // unless a form is open. Not on the first install, when nothing controlled the page.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      if (!dirty) { location.reload(); return; }
      // A form is open: reload as soon as it is saved or left.
      const wait = setInterval(() => { if (!dirty) { clearInterval(wait); location.reload(); } }, 2000);
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
    pushActive = !!sub;
    if (sub) {
      await Backend.savePushSubscription(sub);
      const p = await Backend.getPushPrefs(sub.endpoint);
      if (p) setNewsPrefs(p);
    }
  } catch (e) { /* offline: next start */ }
}

window.addEventListener('online', () => { if (Backend.signedIn()) refresh().then(rerender); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  // iOS resumes the old page instead of starting the app: look for a new
  // version (a new service worker reloads the page via controllerchange).
  if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistration().then((reg) => reg && reg.update()).catch(() => {});
  if (Backend.signedIn()) refresh().then(rerender);
});

boot();
