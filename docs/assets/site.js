// Gemeinsame Funktionen für alle Seiten: Menü, Jahr, Einblenden, Inhalte aus config.js
// und eine anonyme Seitenaufruf-Zählung ohne Cookies.
(() => {
  const config = window.AE_CONFIG || {};
  document.documentElement.classList.add('has-js');
  const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const safeUrl = (url) => /^https:\/\//.test(url || '') ? url : '';

  // Menü (Mobil)
  const menuButton = document.querySelector('.menu-toggle');
  const navLinks = document.querySelector('.nav-links');
  if (menuButton && navLinks) {
    const setOpen = (open) => {
      navLinks.classList.toggle('open', open);
      menuButton.setAttribute('aria-expanded', String(open));
      menuButton.setAttribute('aria-label', open ? 'Menü schließen' : 'Menü öffnen');
      menuButton.textContent = open ? '×' : '☰';
    };
    menuButton.addEventListener('click', () => setOpen(!navLinks.classList.contains('open')));
    navLinks.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setOpen(false)));
  }
  document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });

  // Fotos und LinkedIn der Gründer
  document.querySelectorAll('[data-founder]').forEach((card) => {
    const key = card.dataset.founder;
    const photo = (config.photos || {})[key];
    const avatar = card.querySelector('.founder-avatar');
    if (photo && avatar) avatar.outerHTML = `<img class="founder-photo" src="${esc(photo)}" alt="Porträt ${esc(card.querySelector('h3').textContent)}" width="64" height="64" loading="lazy">`;
    const profile = safeUrl((config.linkedin || {})[key]);
    if (profile) card.querySelector('.founder-card-head div').insertAdjacentHTML('beforeend', `<a class="founder-link" href="${esc(profile)}" target="_blank" rel="noopener">LinkedIn-Profil ↗</a>`);
  });
  const company = safeUrl((config.linkedin || {}).company);
  if (company) document.querySelectorAll('.footer-links').forEach((links) => links.insertAdjacentHTML('afterbegin', `<a href="${esc(company)}" target="_blank" rel="noopener">LinkedIn</a>`));

  // Kundenstimmen
  const voices = (config.testimonials || []).filter((t) => t && t.quote && t.name);
  const voiceSection = document.getElementById('stimmen');
  if (voiceSection && voices.length) {
    voiceSection.querySelector('.voice-grid').innerHTML = voices.map((t) => `<figure class="voice reveal"><blockquote>„${esc(t.quote)}“</blockquote>
      <figcaption><strong>${esc(t.name)}</strong>${t.role || t.company ? `<span>${esc([t.role, t.company].filter(Boolean).join(', '))}</span>` : ''}</figcaption></figure>`).join('');
    voiceSection.hidden = false;
  }

  // Einblenden beim Scrollen
  const reveal = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); }
    }), { threshold: 0.12 });
    reveal.forEach((element) => observer.observe(element));
  } else reveal.forEach((element) => element.classList.add('visible'));

  // Anonyme Reichweitenmessung: nur der Seitenpfad, keine Cookies, kein Fingerprinting.
  const path = location.pathname.replace(/^\/ae-consulting-website/, '').toLowerCase() || '/';
  const local = /^(localhost|127\.)/.test(location.hostname);
  if (config.api && !local && navigator.doNotTrack !== '1' && /^\/[a-z0-9\-/.]*$/.test(path) && path.length <= 100 && !path.includes('admin')) {
    fetch(`${config.api}/api/pv`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }), keepalive: true,
    }).catch(() => {});
  }
})();
