// Terminbuchung: zeigt echte freie Termine vom Server. Ist der Server nicht erreichbar,
// bleibt die freie Wunschtermin-Eingabe als Ausweg bestehen.
(() => {
  const form = document.getElementById('booking-form');
  if (!form) return;
  const config = window.AE_CONFIG || {};
  const API = config.api;
  const MAIL = config.email || '';
  const status = document.getElementById('booking-status');
  const dateInput = document.getElementById('booking-date');
  const timeInput = document.getElementById('booking-time');
  const manual = document.getElementById('manual-slot');
  const picker = document.getElementById('slot-picker');
  const topicField = document.getElementById('booking-topic');
  const chips = [...form.querySelectorAll('.topic-chip')];
  const button = form.querySelector('button[type="submit"]');
  const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const setStatus = (html, isError = false) => { status.innerHTML = html; status.classList.toggle('is-error', isError); };
  const today = new Date();
  const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  dateInput.min = localDate;
  const weekday = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
  const dayMonth = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
  const longDate = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  const asDate = (iso) => new Date(`${iso}T12:00:00`);

  chips.forEach((chip) => chip.addEventListener('click', () => chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'))));
  dateInput.addEventListener('change', () => {
    const day = asDate(dateInput.value).getDay();
    dateInput.setCustomValidity(day === 0 || day === 6 ? 'Bitte wählen Sie einen Wochentag.' : '');
  });

  // ===== Freie Termine =====
  let mode = 'loading'; // loading | slots | manual
  let days = [];
  let selected = { date: '', time: '' };

  function renderPicker() {
    const day = days.find((d) => d.date === selected.date) || days.find((d) => d.times.length) || days[0];
    if (!day) return;
    if (!selected.date) selected.date = day.date;
    picker.innerHTML = `<div class="slot-days" role="listbox" aria-label="Tag wählen">${days.map((d) => `
        <button type="button" class="slot-day" role="option" data-date="${d.date}" aria-selected="${d.date === day.date}" ${d.times.length ? '' : 'disabled'}>
          <span>${weekday.format(asDate(d.date))}</span><b>${dayMonth.format(asDate(d.date))}</b><small>${d.times.length ? `${d.times.length} frei` : 'belegt'}</small></button>`).join('')}</div>
      <p class="slot-label">${longDate.format(asDate(day.date))}</p>
      <div class="slot-times" role="listbox" aria-label="Uhrzeit wählen">${day.times.map((t) => `
        <button type="button" class="slot-time" role="option" data-time="${t}" aria-selected="${selected.date === day.date && selected.time === t}">${t} Uhr</button>`).join('') || '<span class="slot-none">An diesem Tag ist leider nichts mehr frei.</span>'}</div>`;
    picker.querySelectorAll('.slot-day').forEach((b) => b.addEventListener('click', () => { selected = { date: b.dataset.date, time: '' }; renderPicker(); }));
    picker.querySelectorAll('.slot-time').forEach((b) => b.addEventListener('click', () => {
      selected = { date: day.date, time: b.dataset.time };
      dateInput.value = selected.date;
      timeInput.value = selected.time;
      renderPicker();
      setStatus('');
    }));
  }

  function useManual() {
    if (mode === 'slots') return;
    mode = 'manual';
    picker.hidden = true;
    manual.hidden = false;
    document.getElementById('slot-hint').textContent = 'Wählen Sie Ihren Wunschtermin. Wir bestätigen ihn per E-Mail.';
  }

  async function loadSlots() {
    const fallback = setTimeout(useManual, 12000);
    try {
      const response = await fetch(`${API}/api/slots`, { cache: 'no-store' });
      if (!response.ok) throw new Error('slots');
      const data = await response.json();
      if (mode === 'manual' || !Array.isArray(data.days) || !data.days.length) return;
      days = data.days;
      if (selected.date && !days.some((d) => d.date === selected.date && d.times.includes(selected.time))) selected = { date: '', time: '' };
      mode = 'slots';
      manual.hidden = true;
      picker.hidden = false;
      document.getElementById('slot-hint').textContent = 'Wählen Sie einen freien Termin (Dauer ca. 30 Minuten).';
      renderPicker();
    } catch {
      useManual();
    } finally {
      clearTimeout(fallback);
    }
  }
  // Lädt die Termine, sobald der Buchungsbereich in Sicht kommt (weckt dabei auch den Server).
  const booking = document.getElementById('termin');
  if ('IntersectionObserver' in window && booking) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); loadSlots(); }
    }, { rootMargin: '600px 0px' });
    io.observe(booking);
  } else loadSlots();

  // ===== Absenden =====
  const mailFallback = (data) => {
    const body = `Name: ${data.get('name')}\nWunschtermin: ${data.get('date')} um ${data.get('time')} Uhr\n\n${data.get('topic') || ''}`;
    return `mailto:${MAIL}?subject=${encodeURIComponent('Anfrage für ein Erstgespräch')}&body=${encodeURIComponent(body)}`;
  };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (mode !== 'manual' && (!selected.date || !selected.time)) {
      if (mode === 'loading') useManual();
      else { setStatus('Bitte wählen Sie zuerst einen Tag und eine Uhrzeit.', true); picker.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    }
    if (!form.reportValidity()) return;
    const day = asDate(dateInput.value).getDay();
    if (day === 0 || day === 6) { dateInput.setCustomValidity('Bitte wählen Sie einen Wochentag.'); dateInput.reportValidity(); return; }
    const data = new FormData(form);
    const themes = chips.filter((chip) => chip.getAttribute('aria-pressed') === 'true').map((chip) => chip.textContent);
    data.set('topic', [themes.length ? `Themen: ${themes.join(', ')}` : '', topicField.value.trim()].filter(Boolean).join('\n'));
    const payload = { ...Object.fromEntries(data), consent: true };
    const dateLabel = new Intl.DateTimeFormat('de-DE', { dateStyle: 'long' }).format(asDate(data.get('date')));
    button.disabled = true;
    setStatus('Ihre Anfrage wird gesendet …');
    const slow = setTimeout(() => setStatus('Einen Moment bitte – der Server wird gerade gestartet. Das kann beim ersten Aufruf bis zu einer Minute dauern …'), 6000);
    try {
      const response = await fetch(`${API}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout ? AbortSignal.timeout(75000) : undefined,
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 409) { selected = { date: '', time: '' }; loadSlots(); }
      if (!response.ok) throw Object.assign(new Error(result.error || 'Die Anfrage konnte nicht gesendet werden.'), { known: Boolean(result.error) });
      setStatus(`Vielen Dank! Ihre Anfrage für den ${esc(dateLabel)} um ${esc(data.get('time'))} Uhr ist eingegangen. Wir bestätigen den Termin per E-Mail.`);
      form.reset();
      chips.forEach((chip) => chip.setAttribute('aria-pressed', 'false'));
      dateInput.min = localDate;
      selected = { date: '', time: '' };
      if (mode === 'slots') loadSlots();
    } catch (error) {
      const reason = esc(error.known ? error.message : 'Die Verbindung zum Server ist fehlgeschlagen.');
      setStatus(`${reason} Sie können uns Ihre Anfrage auch <a href="${mailFallback(data)}">direkt per E-Mail senden</a>.`, true);
    } finally {
      clearTimeout(slow);
      button.disabled = false;
    }
  });
})();
