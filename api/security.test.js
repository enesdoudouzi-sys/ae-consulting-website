import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { app } from './server.js';

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
