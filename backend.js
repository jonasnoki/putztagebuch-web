/* putztagebuch backend client: Supabase Auth (email code) and the REST API of
 * the tables in supabase/migrations. Plain fetch, no library. */
'use strict';

const PT = window.PT_CONFIG || {};

class ApiError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

const SESSION_KEY = 'pt.session';

const Backend = {
  session: (() => { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; } })(),

  configured() { return !!(PT.url && PT.key); },
  signedIn() { return !!(this.session && this.session.refresh_token); },
  userId() { return this.session && this.session.user && this.session.user.id; },
  email() { return this.session && this.session.user && this.session.user.email; },

  saveSession(s) {
    this.session = s;
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* storage blocked: session lasts for this page only */ }
  },

  async request(path, { method = 'GET', body, auth = true, headers = {}, timeout = 12000 } = {}) {
    if (auth) await this.freshToken();
    const h = { apikey: PT.key, ...headers };
    if (auth && this.session) h.Authorization = 'Bearer ' + this.session.access_token;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res;
    try {
      res = await fetch(PT.url + path, {
        method, headers: h, signal: ctrl.signal, cache: 'no-store',
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new ApiError('Server nicht erreichbar', 0);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = j.msg || j.message || j.error_description || j.error || ''; } catch (e) { /* not JSON */ }
      if (res.status === 401 && auth) this.saveSession(null);
      throw new ApiError(detail || `Serverfehler ${res.status}`, res.status);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  },

  // ---- auth: email and password, or a 6-digit code by email (stays inside the installed PWA)

  async sendCode(email) {
    // If the email has a link instead of a code, it leads back here.
    const back = encodeURIComponent(location.origin + location.pathname);
    await this.request('/auth/v1/otp?redirect_to=' + back, { method: 'POST', auth: false, body: { email, create_user: true } });
  },

  /** Sign-in links return with the session in the URL fragment. */
  takeSessionFromUrl() {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (!p.get('access_token') || !p.get('refresh_token')) return false;
    const expiresIn = Number(p.get('expires_in')) || 3600;
    let user = null;
    try { user = JSON.parse(atob(p.get('access_token').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { /* not a JWT */ }
    this.saveSession({
      access_token: p.get('access_token'),
      refresh_token: p.get('refresh_token'),
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
      user: user ? { id: user.sub, email: user.email } : null,
    });
    history.replaceState(null, '', location.pathname + '#/log');
    return true;
  },

  async verifyCode(email, token) {
    const s = await this.request('/auth/v1/verify', { method: 'POST', auth: false, body: { type: 'email', email, token } });
    s.expires_at = Math.floor(Date.now() / 1000) + (s.expires_in || 3600);
    this.saveSession(s);
  },

  async signInPassword(email, password) {
    const s = await this.request('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email, password } });
    s.expires_at = Math.floor(Date.now() / 1000) + (s.expires_in || 3600);
    this.saveSession(s);
  },

  /** Set or change the password of the signed-in user. */
  async setPassword(password) {
    await this.request('/auth/v1/user', { method: 'PUT', body: { password } });
  },

  async freshToken() {
    const s = this.session;
    if (!s) throw new ApiError('Nicht angemeldet', 401);
    if (s.expires_at - 60 > Date.now() / 1000) return;
    const n = await this.request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', auth: false, body: { refresh_token: s.refresh_token },
    });
    n.expires_at = Math.floor(Date.now() / 1000) + (n.expires_in || 3600);
    this.saveSession(n);
  },

  async signOut() {
    try { await this.request('/auth/v1/logout', { method: 'POST' }); } catch (e) { /* already gone */ }
    this.saveSession(null);
  },

  // ---- entries: rows hold the full object in `data`; deletes are tombstones

  async listEntries() {
    const rows = await this.request('/rest/v1/entries?select=data&order=at.desc');
    return rows.map((r) => r.data);
  },

  /** New entries and own entries upsert; another member's entry is patched in place. */
  async putEntry(e) {
    const data = { ...e, updatedAt: Math.max(e.updatedAt || 0, Math.floor(Date.now() / 1000)) };
    if (e.uid && e.uid !== this.userId()) {
      const rows = await this.request(`/rest/v1/entries?user_id=eq.${encodeURIComponent(e.uid)}&id=eq.${e.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: { data, updated_at: data.updatedAt },
      });
      if (!rows.length) throw new ApiError('Eintrag nicht gefunden', 404);
      return rows[0].data;
    }
    const rows = await this.request('/rest/v1/entries?on_conflict=user_id,id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: [{ user_id: this.userId(), id: e.id, at: e.at, updated_at: data.updatedAt, data }],
    });
    return rows[0].data;
  },

  async deleteEntry(e) {
    return this.putEntry({ ...e, deleted: true });
  },

  // ---- home (household): shared entries and task list

  /** { home: {id, name, data}, members: [{user_id, name}] }, or null before joining. */
  async getHome() {
    const [homes, members] = await Promise.all([
      this.request('/rest/v1/homes?select=id,name,data'),
      this.request('/rest/v1/home_members?select=user_id,name&order=joined_at'),
    ]);
    return homes.length ? { home: homes[0], members } : null;
  },

  async joinHome(code, name) {
    return this.request('/rest/v1/rpc/join_home', { method: 'POST', body: { p_code: code, p_name: name } });
  },

  async createHome(slug, name) {
    return this.request('/rest/v1/rpc/create_home', { method: 'POST', body: { p_slug: slug, p_name: name } });
  },

  async putHomeData(id, data) {
    const rows = await this.request('/rest/v1/homes?id=eq.' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: { data },
    });
    return rows[0];
  },

  // ---- shopping list (household)

  async listShopping() {
    return this.request('/rest/v1/shopping_items?select=id,text,done,created_at,done_at,created_by,done_by&order=created_at');
  },

  async addShopping(text) {
    const rows = await this.request('/rest/v1/shopping_items', {
      method: 'POST', headers: { Prefer: 'return=representation' }, body: { text },
    });
    return rows[0];
  },

  async setShoppingDone(id, done) {
    await this.request('/rest/v1/shopping_items?id=eq.' + encodeURIComponent(id), {
      method: 'PATCH', body: { done, done_at: done ? new Date().toISOString() : null },
    });
  },

  async deleteShopping(id) {
    await this.request('/rest/v1/shopping_items?id=eq.' + encodeURIComponent(id), { method: 'DELETE' });
  },

  async deleteShoppingItems(ids) {
    if (!ids.length) return;
    await this.request('/rest/v1/shopping_items?id=in.(' + ids.map(encodeURIComponent).join(',') + ')', { method: 'DELETE' });
  },

  // ---- web push subscriptions (one per browser)

  async savePushSubscription(sub) {
    const j = sub.toJSON();
    await this.request('/rest/v1/push_subscriptions?on_conflict=endpoint', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: [{ endpoint: j.endpoint, user_id: this.userId(), p256dh: j.keys.p256dh, auth: j.keys.auth }],
    });
  },

  /** What this device wants to hear about: { notify_tasks, notify_shop_add, notify_shop_done }. */
  async getPushPrefs(endpoint) {
    const rows = await this.request('/rest/v1/push_subscriptions?select=notify_tasks,notify_shop_add,notify_shop_done&endpoint=eq.' + encodeURIComponent(endpoint));
    return rows[0] || null;
  },

  async setPushPrefs(endpoint, prefs) {
    await this.request('/rest/v1/push_subscriptions?endpoint=eq.' + encodeURIComponent(endpoint), { method: 'PATCH', body: prefs });
  },

  async deletePushSubscription(endpoint) {
    await this.request('/rest/v1/push_subscriptions?endpoint=eq.' + encodeURIComponent(endpoint), { method: 'DELETE' });
  },

  // ---- live updates: Supabase Realtime over a WebSocket (Phoenix protocol, vsn 1.0.0)

  /** Calls onChange() whenever a readable row of entries/homes/home_members changes,
   *  and once after each (re)connect. Reconnects with backoff. Returns stop(). */
  live(onChange) {
    let ws = null, ref = 0, beat = null, retry = 1000, stopped = false, topic = 'realtime:putz';
    const send = (msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ ...msg, ref: String(++ref) })); };
    const connect = async () => {
      if (stopped || !this.signedIn()) return;
      try { await this.freshToken(); } catch (e) { setTimeout(connect, retry); return; }
      const url = PT.url.replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(PT.key) + '&vsn=1.0.0';
      ws = new WebSocket(url);
      ws.onopen = () => {
        retry = 1000;
        send({ topic, event: 'phx_join', payload: {
          config: { broadcast: { self: false }, presence: { key: '' }, postgres_changes: ['entries', 'homes', 'home_members', 'shopping_items'].map((table) => ({ event: '*', schema: 'public', table })) },
          access_token: this.session.access_token,
        } });
        beat = setInterval(async () => {
          send({ topic: 'phoenix', event: 'heartbeat', payload: {} });
          // Keep the socket's token fresh; RLS checks run with it.
          try {
            const before = this.session.access_token;
            await this.freshToken();
            if (this.session.access_token !== before) send({ topic, event: 'access_token', payload: { access_token: this.session.access_token } });
          } catch (e) { /* signed out: the close handler stops */ }
        }, 25000);
      };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.topic !== topic) return;
        if (m.event === 'phx_reply' && m.payload && m.payload.status === 'ok' && m.payload.response && m.payload.response.postgres_changes) onChange('joined');
        else if (m.event === 'postgres_changes') onChange('change');
      };
      ws.onclose = () => {
        clearInterval(beat);
        ws = null;
        if (stopped) return;
        setTimeout(connect, retry);
        retry = Math.min(retry * 2, 30000);
      };
    };
    connect();
    return () => { stopped = true; clearInterval(beat); if (ws) ws.close(); };
  },

  // ---- devices (watches): the code is shown once, only its hash is stored

  async createDeviceCode(label) {
    return this.request('/rest/v1/rpc/create_device_token', { method: 'POST', body: { p_label: label } });
  },

  async listDevices() {
    return this.request('/rest/v1/devices?select=id,label,created_at,last_seen&order=created_at.desc');
  },

  async deleteDevice(id) {
    await this.request('/rest/v1/devices?id=eq.' + encodeURIComponent(id), { method: 'DELETE' });
  },
};
