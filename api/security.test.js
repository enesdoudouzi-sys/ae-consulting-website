import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { app, buildDecisionMail, buildMails, contactSchema } from './server.js';

let server;
let baseUrl;

before(async () => {
  process.env.NODE_ENV = 'test';
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => new Promise((resolve) => server.close(resolve)));

test('sets security headers and hides the framework', async () => {
  const response = await fetch(`${baseUrl}/healthz`);
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.ok(response.headers.get('content-security-policy'));
  assert.ok(response.headers.get('x-content-type-options'));
});

test('rejects cross-origin browser requests', async () => {
  const response = await fetch(`${baseUrl}/api/contact`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://attacker.example', 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(response.status, 403);
});

test('rejects invalid input without echoing markup or SQL-like input', async () => {
  const response = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '<script>alert(1)</script>', email: 'invalid-email',
      date: '2027-01-04', time: '10:00', topic: 'DROP TABLE contact_requests;--',
    }),
  });
  const body = await response.text();
  assert.equal(response.status, 400);
  assert.equal(body.includes('<script>'), false);
  assert.equal(body.includes('DROP TABLE'), false);
});

test('rejects malformed JSON with a generic response', async () => {
  const response = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":',
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Ungültige Anfrage.' });
});

test('does not expose service configuration in health failures', async () => {
  const response = await fetch(`${baseUrl}/healthz`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: 'unavailable' });
});

test('silently drops bot submissions caught by the honeypot', async () => {
  const response = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Automated Visitor', email: 'bot@example.com', date: '2027-01-04',
      time: '10:00', topic: '', website: 'https://spam.example',
    }),
  });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { status: 'received' });
});

test('rejects past dates and weekend appointment requests', async () => {
  for (const date of ['2020-01-06', '2027-01-02']) {
    const response = await fetch(`${baseUrl}/api/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Person', email: 'person@example.com', date, time: '10:00', topic: '' }),
    });
    assert.equal(response.status, 400);
  }
});

test('enforces the JSON body size limit', async () => {
  const response = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: 'x'.repeat(12000) }),
  });
  assert.equal(response.status, 413);
});

const nextWeekday = () => {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + 7);
  while ([0, 6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
};

test('requires confirmation of the privacy notice', async () => {
  const response = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test Person', email: 'person@example.com', date: nextWeekday(), time: '10:00', topic: '' }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Bitte bestätigen Sie die Datenschutzhinweise.' });
});

test('accepts the consent values sent by the website form', () => {
  const base = { name: 'Test Person', email: 'person@example.com', date: nextWeekday(), time: '10:00', topic: '' };
  for (const consent of [true, 'on', 'true']) assert.equal(contactSchema.safeParse({ ...base, consent }).success, true);
  for (const consent of [false, 'yes', 1]) assert.equal(contactSchema.safeParse({ ...base, consent }).success, false);
});

test('builds plain-text mails without user input in subjects or the customer confirmation', () => {
  process.env.CONTACT_TO_EMAIL = 'team@example.com';
  const { notify, confirmation } = buildMails({
    id: 42, name: 'Eve <b>Spam</b>', email: 'eve@example.com', date: '2027-01-04', time: '10:00', topic: 'Buy now http://spam.example',
  });
  assert.deepEqual(notify.to, ['team@example.com']);
  assert.equal(notify.reply_to, 'eve@example.com');
  assert.equal(notify.subject, 'Neue Anfrage für ein Erstgespräch (#42)');
  assert.ok(notify.text.includes('Wunschtermin: 04.01.2027 um 10:00 Uhr'));
  assert.deepEqual(confirmation.to, ['eve@example.com']);
  assert.equal(confirmation.reply_to, 'team@example.com');
  assert.ok(confirmation.text.includes('am 04.01.2027 um 10:00 Uhr'));
  for (const text of [confirmation.subject, confirmation.text, notify.subject]) {
    assert.equal(text.includes('Spam'), false);
    assert.equal(text.includes('spam.example'), false);
  }
});

test('protects the admin area', async () => {
  for (const [method, path] of [['GET', '/api/admin/requests'], ['GET', '/api/admin/stats'], ['POST', '/api/admin/requests/1/status']]) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong-token-wrong-token-wrong' },
      body: method === 'POST' ? JSON.stringify({ status: 'confirmed' }) : undefined,
    });
    assert.equal(response.status, 401, path);
    assert.deepEqual(await response.json(), { error: 'Nicht berechtigt.' });
  }
});

test('page views accept only plain paths and store nothing personal', async () => {
  const bad = await fetch(`${baseUrl}/api/pv`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: '/?email=max@example.com' }),
  });
  assert.equal(bad.status, 400);
  const extra = await fetch(`${baseUrl}/api/pv`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: '/wissen/', ip: '1.2.3.4' }),
  });
  assert.equal(extra.status, 400);
  const ok = await fetch(`${baseUrl}/api/pv`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '/wissen/' }),
  });
  assert.equal(ok.status, 204);
});

test('decision mails attach a calendar entry only for confirmed appointments', () => {
  const confirmed = buildDecisionMail({ id: 3, email: 'kunde@example.com', date: '2027-01-04', time: '10:00', status: 'confirmed', note: '' });
  assert.deepEqual(confirmed.to, ['kunde@example.com']);
  assert.equal(confirmed.attachments[0].filename, 'erstgespraech.ics');
  assert.ok(Buffer.from(confirmed.attachments[0].content, 'base64').toString().includes('20270104T100000'));
  const declined = buildDecisionMail({ id: 3, email: 'kunde@example.com', date: '2027-01-04', time: '10:00', status: 'declined', note: 'Gerne am Dienstag.' });
  assert.equal(declined.attachments, undefined);
  assert.ok(declined.text.includes('Gerne am Dienstag.'));
});
