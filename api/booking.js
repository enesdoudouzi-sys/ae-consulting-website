// Terminlogik ohne Datenbank- oder Netzwerkzugriff, damit sie einfach testbar ist.

export const TIMES = ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'];
export const BOOKING_DAYS = 15; // so viele Werktage werden zur Auswahl angeboten

const iso = (date) => date.toISOString().slice(0, 10);
const addDays = (date, days) => new Date(date.getTime() + days * 864e5);

// Ostersonntag nach der Gaußschen Osterformel (Anonymer Gregorianischer Algorithmus).
function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

// Bundesweite gesetzliche Feiertage in Deutschland.
export function holidays(year) {
  const easter = easterSunday(year);
  return new Set([
    `${year}-01-01`, `${year}-05-01`, `${year}-10-03`, `${year}-12-25`, `${year}-12-26`,
    iso(addDays(easter, -2)), iso(addDays(easter, 1)), iso(addDays(easter, 39)), iso(addDays(easter, 50)),
  ]);
}

export function isBookableDay(isoDate) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  return ![0, 6].includes(date.getUTCDay()) && !holidays(date.getUTCFullYear()).has(isoDate);
}

// Freie Termine: ab dem nächsten Werktag, ohne Wochenenden, Feiertage und bereits angefragte Zeiten.
export function computeSlots(taken, now = new Date()) {
  const takenSet = new Set(taken.map(({ date, time }) => `${date} ${time}`));
  const days = [];
  let cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
  while (days.length < BOOKING_DAYS) {
    cursor = addDays(cursor, 1);
    const date = iso(cursor);
    if (!isBookableDay(date)) continue;
    days.push({ date, times: TIMES.filter((time) => !takenSet.has(`${date} ${time}`)) });
  }
  return days;
}

const icsDate = (date, time, offsetMinutes = 0) => {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + offsetMinutes;
  return `${date.replaceAll('-', '')}T${String(Math.floor(total / 60)).padStart(2, '0')}${String(total % 60).padStart(2, '0')}00`;
};

// Kalendereintrag (.ics) für einen bestätigten Termin, Zeit in deutscher Ortszeit.
export function buildIcs({ id, date, time }) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AE Consulting//Erstgespraech//DE', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:ae-consulting-${id}@enesdoudouzi-sys.github.io`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Europe/Berlin:${icsDate(date, time)}`,
    `DTEND;TZID=Europe/Berlin:${icsDate(date, time, 30)}`,
    'SUMMARY:Erstgespräch mit AE Consulting',
    'DESCRIPTION:Unverbindliches Erstgespräch (ca. 30 Minuten). Die Einwahldaten erhalten Sie per E-Mail.',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}
