// Donori front end — a small hash-routed single-page app, no build step.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const view = $('#view');
  let lang = (() => { try { return localStorage.getItem('lang') || 'ka'; } catch { return 'ka'; } })();
  let me = null, config = { categories: [], provider: 'mock' };

  const t = (k, vars = {}) => (I18N[lang][k] || I18N.en[k] || k).replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const gel = tetri => new Intl.NumberFormat(lang === 'ka' ? 'ka-GE' : 'en-US', { maximumFractionDigits: 2 }).format(tetri / 100) + ' ₾';

  async function api(path, body) {
    const res = await fetch('/api' + path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'error'), { data, status: res.status });
    return data;
  }
  const errText = e => e.data && e.data.fields ? t('err_fields', { f: e.data.fields.join(', ') })
    : e.status === 401 ? t('login_required') : (I18N[lang][e.message] ? t(e.message) : t('err'));

  // ---------- chrome ----------
  function renderNav() {
    document.documentElement.lang = lang;
    $('#brand').textContent = t('brand');
    $('#nav').innerHTML = `
      <a href="#/">${t('nav_browse')}</a>
      <a href="#/start" class="btn small">${t('nav_start')}</a>
      ${me ? `<a href="#/mine">${t('nav_mine')}</a>` : ''}
      ${me && me.role === 'admin' ? `<a href="#/admin">${t('nav_admin')}</a>` : ''}
      ${me ? `<button class="link" id="logout">${t('nav_logout')}</button>` : `<a href="#/login">${t('nav_login')}</a>`}
      <button class="lang" id="lang">${lang === 'ka' ? 'EN' : 'ქა'}</button>`;
    $('#lang').onclick = () => { lang = lang === 'ka' ? 'en' : 'ka'; try { localStorage.setItem('lang', lang); } catch {} route(); };
    const lo = $('#logout');
    if (lo) lo.onclick = async () => { await api('/auth/logout', {}); me = null; location.hash = '#/'; route(); };
    $('#testbar').hidden = config.provider !== 'mock';
    $('#testbar').textContent = t('test_mode');
  }

  function card(c) {
    const pct = Math.min(100, Math.round(c.raised_tetri / c.goal_tetri * 100));
    return `<a class="card" href="#/campaign/${c.id}">
      <div class="thumb">${c.image_url ? `<img src="${esc(c.image_url)}" alt="" loading="lazy">` : ''}</div>
      <div class="card-body">
        <span class="tag">${t('cat_' + c.category)}</span>
        <h3>${esc(c.title)}</h3>
        <div class="bar"><span data-w="${pct}"></span></div>
        <p class="muted">${t('raised_of', { a: gel(c.raised_tetri), g: gel(c.goal_tetri) })} · ${t('donors', { n: c.donor_count })}</p>
      </div></a>`;
  }
  // Progress widths are set via CSSOM (CSP blocks inline style attributes).
  function applyBars() {
    document.querySelectorAll('.bar span[data-w]').forEach(s => { s.style.width = s.dataset.w + '%'; });
  }

  // ---------- pages ----------
  async function browse() {
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    const q = params.get('q') || '', cat = params.get('category') || '';
    view.innerHTML = `
      <section class="hero"><h1>${t('hero_title')}</h1><p>${t('hero_sub')}</p></section>
      <div class="filters">
        <input id="q" type="search" placeholder="${t('search')}" value="${esc(q)}">
        <div class="chips">${['', ...config.categories].map(c =>
          `<button class="chip ${c === cat ? 'on' : ''}" data-cat="${c}">${c ? t('cat_' + c) : t('all')}</button>`).join('')}</div>
      </div>
      <div class="grid" id="grid"><p class="muted">…</p></div>`;
    const go = (nq, nc) => { location.hash = `#/?q=${encodeURIComponent(nq)}&category=${nc}`; };
    $('#q').onchange = e => go(e.target.value, cat);
    view.querySelectorAll('.chip').forEach(b => b.onclick = () => go(q, b.dataset.cat));
    const rows = await api(`/campaigns?q=${encodeURIComponent(q)}&category=${cat}`);
    $('#grid').innerHTML = rows.length ? rows.map(card).join('') : `<p class="muted">${t('no_campaigns')}</p>`;
    applyBars();
  }

  async function campaign(id) {
    let c;
    try { c = await api('/campaigns/' + id); } catch { view.innerHTML = `<p>${t('nothing_here')}</p>`; return; }
    const pct = Math.min(100, Math.round(c.raised_tetri / c.goal_tetri * 100));
    const failed = location.hash.includes('payment=failed');
    view.innerHTML = `
      <a href="#/" class="muted">${t('back')}</a>
      <div class="detail">
        <article>
          ${c.image_url ? `<img class="hero-img" src="${esc(c.image_url)}" alt="">` : ''}
          <span class="tag">${t('cat_' + c.category)}</span>
          ${c.status !== 'approved' ? `<span class="tag status-${c.status}">${t('status_' + c.status)}</span>` : ''}
          <h1>${esc(c.title)}</h1>
          <p class="muted">${t('beneficiary')}: ${esc(c.beneficiary_name)}${c.payout_iban ? ` · ${t('iban')}: ${esc(c.payout_iban)}` : ''}</p>
          <div class="story">${esc(c.story).replace(/\n/g, '<br>')}</div>
        </article>
        <aside class="panel">
          <p class="big">${gel(c.raised_tetri)}</p>
          <p class="muted">${t('goal_of', { g: gel(c.goal_tetri) })} · ${t('donors', { n: c.donor_count })}</p>
          <div class="bar"><span data-w="${pct}"></span></div>
          ${failed ? `<p class="error">${t('failed_body')}</p>` : ''}
          ${c.status === 'approved' ? `
          <form id="donate" class="stack">
            <div class="presets">${[10, 25, 50, 100].map(v => `<button type="button" class="chip" data-v="${v}">${v} ₾</button>`).join('')}</div>
            <label>${t('amount')}<input name="amount" type="number" min="1" max="50000" step="0.01" required inputmode="decimal"></label>
            <label>${t('your_name')}<input name="name" maxlength="80"></label>
            <label class="check"><input type="checkbox" name="anonymous"> ${t('anonymous')}</label>
            <label>${t('message')}<textarea name="message" maxlength="280" rows="2"></textarea></label>
            <button class="btn">${t('donate_now')}</button>
            <p class="muted small">${t('pay_with')}. ${t('secure_note')}</p>
            <p class="error" id="derr"></p>
          </form>` : ''}
          <h3>${t('recent_donations')}</h3>
          <ul class="donations">${c.donations.map(d => `<li><b>${d.donor_name ? esc(d.donor_name) : t('anon')}</b> · ${gel(d.amount_tetri)}${d.message ? `<br><span class="muted">${esc(d.message)}</span>` : ''}</li>`).join('') || `<li class="muted">—</li>`}</ul>
        </aside>
      </div>`;
    applyBars();
    const f = $('#donate');
    if (!f) return;
    f.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { f.amount.value = b.dataset.v; });
    f.onsubmit = async e => {
      e.preventDefault();
      const btn = f.querySelector('.btn'); btn.disabled = true;
      try {
        const r = await api(`/campaigns/${id}/donate`, {
          amount: f.amount.value, name: f.name.value, anonymous: f.anonymous.checked, message: f.message.value, lang,
        });
        location.href = r.redirectUrl; // bank's hosted payment page (or the test checkout)
      } catch (err) { $('#derr').textContent = errText(err); btn.disabled = false; }
    };
  }

  function auth(mode) {
    const signup = mode === 'signup';
    view.innerHTML = `<form id="auth" class="narrow stack">
      <h1>${t(signup ? 'signup_title' : 'login_title')}</h1>
      ${signup ? `<label>${t('name')}<input name="name" required maxlength="80"></label>` : ''}
      <label>${t('email')}<input name="email" type="email" required autocomplete="email"></label>
      <label>${t('password')}<input name="password" type="password" required minlength="${signup ? 8 : 1}" autocomplete="${signup ? 'new-password' : 'current-password'}"></label>
      <button class="btn">${t(signup ? 'signup_title' : 'login_title')}</button>
      <a href="#/${signup ? 'login' : 'signup'}">${t(signup ? 'have_account' : 'no_account')}</a>
      <p class="error" id="aerr"></p></form>`;
    $('#auth').onsubmit = async e => {
      e.preventDefault();
      const f = e.target;
      try {
        await api('/auth/' + mode, { name: f.name && f.name.value, email: f.email.value, password: f.password.value });
        me = (await api('/me')).user;
        const next = sessionStorage.getItem('next') || '#/'; sessionStorage.removeItem('next');
        location.hash = next;
      } catch (err) { $('#aerr').textContent = errText(err); }
    };
  }

  function requireLogin() {
    if (me) return true;
    sessionStorage.setItem('next', location.hash); location.hash = '#/login'; return false;
  }

  function start() {
    if (!requireLogin()) return;
    view.innerHTML = `<form id="start" class="narrow stack">
      <h1>${t('start_title')}</h1>
      <label>${t('f_title')}<input name="title" required minlength="5" maxlength="120"></label>
      <label>${t('f_category')}<select name="category">${config.categories.map(c => `<option value="${c}">${t('cat_' + c)}</option>`).join('')}</select></label>
      <label>${t('f_goal')}<input name="goal" type="number" min="100" max="1000000" required></label>
      <label>${t('f_story')}<textarea name="story" rows="8" required minlength="50"></textarea></label>
      <label>${t('f_image')}<input name="image_url" type="url" placeholder="https://"></label>
      <label>${t('f_beneficiary')}<input name="beneficiary_name" required maxlength="120"></label>
      <label>${t('f_iban')}<input name="payout_iban" required placeholder="GE00XX0000000000000000" autocomplete="off"></label>
      <p class="muted small">${t('f_iban_note')}</p>
      <button class="btn">${t('submit_review')}</button>
      <p class="error" id="serr"></p></form>`;
    $('#start').onsubmit = async e => {
      e.preventDefault();
      const f = e.target, body = Object.fromEntries(new FormData(f));
      try { await api('/campaigns', body); view.innerHTML = `<div class="narrow"><h1>✓</h1><p>${t('submitted')}</p><a class="btn" href="#/mine">${t('nav_mine')}</a></div>`; }
      catch (err) { $('#serr').textContent = errText(err); }
    };
  }

  async function mine() {
    if (!requireLogin()) return;
    const rows = await api('/my/campaigns');
    view.innerHTML = `<h1>${t('nav_mine')}</h1><div class="list">${rows.map(c => `
      <a class="row" href="#/campaign/${c.id}"><b>${esc(c.title)}</b>
        <span class="tag status-${c.status}">${t('status_' + c.status)}</span>
        <span class="muted">${t('raised_of', { a: gel(c.raised_tetri), g: gel(c.goal_tetri) })}</span>
        ${c.reject_reason ? `<span class="error">${esc(c.reject_reason)}</span>` : ''}</a>`).join('') || `<p class="muted">${t('nothing_here')}</p>`}</div>`;
  }

  async function admin() {
    if (!me || me.role !== 'admin') { view.innerHTML = `<p>${t('nothing_here')}</p>`; return; }
    const status = new URLSearchParams(location.hash.split('?')[1] || '').get('status') || 'pending';
    const [rows, dons] = await Promise.all([api('/admin/campaigns?status=' + status), api('/admin/donations')]);
    view.innerHTML = `<h1>${t('nav_admin')}</h1>
      <div class="chips">${['pending', 'approved', 'rejected', 'closed'].map(s => `<a class="chip ${s === status ? 'on' : ''}" href="#/admin?status=${s}">${t('status_' + s)}</a>`).join('')}</div>
      <div class="list">${rows.map(c => `<div class="row" data-id="${c.id}">
        <a href="#/campaign/${c.id}"><b>${esc(c.title)}</b></a>
        <span class="muted">${t('owner')}: ${esc(c.owner_name)} (${esc(c.owner_email)}) · ${t('beneficiary')}: ${esc(c.beneficiary_name)} · ${t('iban')}: ${esc(c.payout_iban)} · ${gel(c.goal_tetri)}</span>
        <p class="clip">${esc(c.story)}</p>
        <div class="actions">
          ${status !== 'approved' ? `<button class="btn small" data-a="approve">${t('approve')}</button>` : ''}
          ${status === 'pending' ? `<button class="btn small ghost" data-a="reject">${t('reject')}</button>` : ''}
          ${status === 'approved' ? `<button class="btn small ghost" data-a="close">${t('close')}</button>` : ''}
        </div></div>`).join('') || `<p class="muted">${t('nothing_here')}</p>`}</div>
      <h2>${t('donations_admin')}</h2>
      <div class="table"><table><thead><tr><th>#</th><th>${t('nav_browse')}</th><th>₾</th><th>Status</th><th>Method</th><th>Order</th></tr></thead><tbody>
      ${dons.map(d => `<tr><td>${d.id}</td><td>${esc(d.title)}</td><td>${gel(d.amount_tetri)}</td><td>${esc(d.status)}</td><td>${esc(d.method || '')}</td><td class="mono">${esc(d.provider_order_id || '')}</td></tr>`).join('')}
      </tbody></table></div>`;
    view.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
      const id = b.closest('[data-id]').dataset.id, a = b.dataset.a;
      const reason = a === 'reject' ? prompt(t('reject_reason')) : null;
      if (a === 'reject' && reason === null) return;
      await api(`/admin/campaigns/${id}/${a}`, { reason }); admin();
    });
  }

  async function thanks(id) {
    view.innerHTML = `<div class="narrow center"><p>${t('pending_body')}</p></div>`;
    for (let i = 0; i < 10; i++) {
      const d = await api(`/donations/${id}/status`).catch(() => null);
      if (!d) break;
      if (d.status === 'completed') {
        view.innerHTML = `<div class="narrow center"><h1>${t('thanks_title')}</h1><p>${t('thanks_body', { a: gel(d.amount_tetri) })}</p>
          <a class="btn" href="#/campaign/${d.campaign_id}">${t('view_campaign')}</a></div>`; return;
      }
      if (d.status === 'rejected') {
        view.innerHTML = `<div class="narrow center"><p class="error">${t('failed_body')}</p><a class="btn" href="#/campaign/${d.campaign_id}">${t('try_again')}</a></div>`; return;
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // Imitation of the bank's hosted page — only reachable when PAYMENT_PROVIDER=mock.
  function mockPay(order, donationId, amount) {
    view.innerHTML = `<div class="narrow stack mock">
      <h1>${t('mock_title')}</h1><p class="big">${gel(+amount)}</p>
      <button class="paybtn apple" data-m="apple_pay"> Pay</button>
      <button class="paybtn gpay" data-m="google_pay">G Pay</button>
      <input placeholder="4111 1111 1111 1111" disabled><button class="btn" data-m="card">${t('mock_pay_card')}</button>
      <button class="link" data-fail>${t('mock_fail')}</button></div>`;
    const done = async (method, outcome) => {
      await api('/mock-pay/complete', { order, method, outcome });
      location.hash = '#/thanks/' + donationId;
    };
    view.querySelectorAll('[data-m]').forEach(b => b.onclick = () => done(b.dataset.m, 'ok'));
    $('[data-fail]').onclick = () => done('card', 'fail');
  }

  // ---------- router ----------
  async function route() {
    renderNav();
    const [p0, p1, p2, p3] = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
    window.scrollTo(0, 0);
    try {
      if (!p0) return await browse();
      if (p0 === 'campaign') return await campaign(p1);
      if (p0 === 'login' || p0 === 'signup') return auth(p0);
      if (p0 === 'start') return start();
      if (p0 === 'mine') return await mine();
      if (p0 === 'admin') return await admin();
      if (p0 === 'thanks') return await thanks(p1);
      if (p0 === 'mock-pay') return mockPay(p1, p2, p3);
      view.innerHTML = `<p>${t('nothing_here')}</p>`;
    } catch (e) { view.innerHTML = `<p class="error">${errText(e)}</p>`; }
  }

  (async () => {
    [config, { user: me }] = await Promise.all([api('/config'), api('/me')]);
    window.addEventListener('hashchange', route);
    route();
  })();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
