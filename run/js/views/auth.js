import * as api from '../api.js';
import { t, setLang, lang } from '../i18n.js';
import { esc, on } from '../ui.js';

let mode = 'signin';
export function render(view) {
  view.innerHTML = `<section class="auth">
    <div>
      <div class="row between"><div class="wordmark">HITFAT <b>RUN</b> CLUB</div>
        <div class="seg" style="width:120px" role="group" aria-label="${esc(t('settings.language'))}">
          <button data-lang="ms" aria-pressed="${lang() === 'ms'}">BM</button><button data-lang="en" aria-pressed="${lang() === 'en'}">EN</button></div></div>
      <p class="tag">Run together.<br><b>Train smarter.</b></p>
      <p class="muted" style="font-size:17px;max-width:30em">${esc(t('auth.pitch'))}</p>
    </div>
    <div style="margin-top:32px">
      <button class="btn dark block" data-google>${googleMark} ${esc(t('auth.google'))}</button>
      <div class="muted small" style="text-align:center;margin:18px 0 4px">${esc(t('auth.orEmail'))}</div>
      <form id="auth-form" novalidate>
        ${mode === 'signup' ? `<label for="au-name">${esc(t('auth.name'))}</label><input id="au-name" autocomplete="name" maxlength="40" required>` : ''}
        <label for="au-email">${esc(t('auth.email'))}</label><input id="au-email" type="email" autocomplete="email" inputmode="email" required>
        ${mode !== 'reset' ? `<label for="au-pass">${esc(t('auth.password'))}</label><input id="au-pass" type="password" minlength="8" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" required>` : ''}
        <div class="error" id="au-msg" role="alert"></div>
        <button class="btn primary block" type="submit" style="margin-top:8px">${esc(t('auth.' + mode))}</button>
      </form>
      <div class="row between small" style="margin-top:16px">
        ${mode === 'signin' ? `<button class="link" data-mode="reset">${esc(t('auth.forgot'))}</button><button class="link" data-mode="signup">${esc(t('auth.toSignup'))}</button>`
          : `<span></span><button class="link" data-mode="signin">${esc(t('auth.toSignin'))}</button>`}
      </div>
      <p class="faint tiny" style="margin-top:22px;text-align:center">${esc(t('auth.shared'))} · <a href="/privacy">${esc(t('auth.privacy'))}</a> · <a href="/terms">${esc(t('auth.terms'))}</a></p>
    </div></section>`;

  view = view.firstElementChild;   // listeners bind to this render only
  const msg = (s, ok) => { const m = view.querySelector('#au-msg'); m.textContent = s; m.style.color = ok ? 'var(--ok)' : ''; };
  const host = view.parentElement;
  on(view, '[data-lang]', 'click', (e, b) => { setLang(b.dataset.lang); render(host); });
  on(view, '[data-mode]', 'click', (e, b) => { mode = b.dataset.mode; render(host); });
  on(view, '[data-google]', 'click', async () => { msg(''); const { error } = await api.signInGoogle(); if (error) msg(error.message); });
  view.querySelector('#auth-form').addEventListener('submit', async e => {
    e.preventDefault();
    const email = view.querySelector('#au-email').value.trim(), pass = view.querySelector('#au-pass')?.value || '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return msg(t('auth.badEmail'));
    if (mode !== 'reset' && pass.length < 8) return msg(t('auth.shortPass'));
    const btn = e.submitter || view.querySelector('[type=submit]'); btn.disabled = true; msg(t('common.wait'), true);
    try {
      if (mode === 'reset') { const { error } = await api.resetPassword(email); if (error) throw error; msg(t('auth.resetSent'), true); }
      else if (mode === 'signup') {
        const name = view.querySelector('#au-name').value.trim();
        const { data, error } = await api.signUpEmail(email, pass, name); if (error) throw error;
        if (!data.session) msg(t('auth.confirm'), true);
      } else { const { error } = await api.signInEmail(email, pass); if (error) throw error; }
    } catch (err) { msg(/invalid login/i.test(err.message) ? t('auth.wrong') : err.message); }
    finally { btn.disabled = false; }
  });
}
const googleMark = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.7 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.3.8-4.7l-7.8-6C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.2-8.5 2.2-6.3 0-11.6-4.2-13.5-9.9l-7.8 6C6.6 42.6 14.6 48 24 48z"/></svg>`;
