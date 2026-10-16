import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildIcs, computeSlots, holidays, isBookableDay, TIMES } from './booking.js';

test('knows the nationwide German public holidays including Easter-based ones', () => {
  const days = holidays(2027);
  for (const day of ['2027-01-01', '2027-03-26', '2027-03-29', '2027-05-01', '2027-05-06', '2027-05-17', '2027-10-03', '2027-12-25', '2027-12-26']) {
    assert.ok(days.has(day), day);
  }
  assert.ok(holidays(2026).has('2026-04-03')); // Karfreitag 2026
});

test('only working days that are not holidays can be booked', () => {
  assert.equal(isBookableDay('2027-01-04'), true); // Montag
  assert.equal(isBookableDay('2027-01-02'), false); // Samstag
  assert.equal(isBookableDay('2027-01-03'), false); // Sonntag
  assert.equal(isBookableDay('2027-03-29'), false); // Ostermontag
});

test('offers the next working days and hides requested times', () => {
  const now = new Date('2026-12-23T10:00:00Z');
  const days = computeSlots([{ date: '2026-12-28', time: '10:00' }], now);
  assert.equal(days.length, 15);
  assert.equal(days[0].date, '2026-12-24'); // morgen, nicht heute
  assert.ok(!days.some((day) => ['2026-12-25', '2026-12-26', '2026-12-27', '2027-01-01'].includes(day.date)));
  const monday = days.find((day) => day.date === '2026-12-28');
  assert.deepEqual(monday.times, TIMES.filter((time) => time !== '10:00'));
});

test('builds a calendar entry in German local time', () => {
  const ics = buildIcs({ id: 7, date: '2027-01-04', time: '09:00' });
  assert.ok(ics.includes('DTSTART;TZID=Europe/Berlin:20270104T090000'));
  assert.ok(ics.includes('DTEND;TZID=Europe/Berlin:20270104T093000'));
  assert.ok(ics.includes('UID:ae-consulting-7@'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});
