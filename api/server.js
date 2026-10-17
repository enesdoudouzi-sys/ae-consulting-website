import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import pg from 'pg';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { buildIcs, computeSlots, isBookableDay, TIMES } from './booking.js';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
// Formularanfragen werden nach dieser Frist automatisch gelöscht (Datenschutz: Speicherbegrenzung).
const retentionDays = Math.min(Math.max(Number(process.env.RETENTION_DAYS) || 180, 7), 730);
const sendConfirmation = process.env.SEND_CONFIRMATION === 'true';
const allowedOrigins = new Set(
  (process.env.SITE_ORIGIN || 'http://localhost:8000')
    .split(',').map((origin) => origin.trim()).filter(Boolean),
);

app.disable('x-powered-by');
app.set('trust proxy', isProduction ? 1 : false);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 600,
}));
app.use(express.json({ limit: '10kb', strict: true }));
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen. Bitte versuchen Sie es später erneut.' },
}));

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen. Bitte versuchen Sie es später erneut.' },
});
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: isProduction ? { rejectUnauthorized: true } : undefined,
      max: 5,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
    })
  : null;

const contactSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  date: z.iso.date(),
  time: z.enum(TIMES),
  topic: z.string().trim().max(2000).optional().default(''),
  website: z.string().max(100).optional().default(''),
  consent: z.union([z.literal(true), z.literal('on'), z.literal('true')]).optional(),
}).strict().superRefine(({ date }, context) => {
  const requestedDate = new Date(`${date}T12:00:00Z`);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (requestedDate < today || !isBookableDay(date)) {
    context.addIssue({ code: 'custom', message: 'Choose a future working day.', path: ['date'] });
  }
});

const formatDate = (isoDate) => isoDate.split('-').reverse().join('.');
const ACTIVE = ['pending', 'confirmed'];
const adminToken = process.env.ADMIN_TOKEN || '';

// Baut die E-Mails als reinen Text. Nutzereingaben landen nie im Betreff,
// und die Bestätigung an den Kunden enthält keinen frei eingegebenen Text.
function buildMails({ id, name, email, date, time, topic }) {
  const from = process.env.RESEND_FROM_EMAIL || 'Doudouzi & Ergün <onboarding@resend.dev>';
  const notify = {
    from,
    to: [process.env.CONTACT_TO_EMAIL],
    reply_to: email,
    subject: `Neue Anfrage für ein Erstgespräch (#${id})`,
    text: [
      `Name: ${name}`, `E-Mail: ${email}`,
      `Wunschtermin: ${formatDate(date)} um ${time} Uhr`,
      `Anliegen: ${topic || 'Noch offen'}`, `Anfrage-ID: ${id}`,
      '', 'Bitte bestätigen Sie den Termin oder schlagen Sie eine Alternative vor (Antworten geht direkt an die anfragende Person).',
    ].join('\n'),
  };
  const confirmation = {
    from,
    to: [email],
    reply_to: process.env.CONTACT_TO_EMAIL,
    subject: 'Ihre Terminanfrage ist eingegangen',
    text: [
      'Guten Tag,', '',
      `vielen Dank für Ihre Anfrage für ein Erstgespräch am ${formatDate(date)} um ${time} Uhr.`,
      'Wir prüfen den Termin und melden uns in Kürze per E-Mail mit einer Bestätigung oder einem Alternativvorschlag.',
      'Der Termin ist erst nach unserer Bestätigung vereinbart.', '',
      'Freundliche Grüße', 'Enes Doudouzi & Ahmet Ergün', '',
      `Ihre Anfrage-Nummer: ${id}`,
      `Ihre Angaben werden nach spätestens ${retentionDays} Tagen gelöscht. Haben Sie diese Anfrage nicht gestellt, können Sie diese E-Mail ignorieren.`,
    ].join('\n'),
  };
  return { notify, confirmation };
}

// Antwort an den Kunden nach Bestätigung oder Absage im Admin-Bereich.
function buildDecisionMail({ id, email, date, time, status, note }) {
  const from = process.env.RESEND_FROM_EMAIL || 'Doudouzi & Ergün <onboarding@resend.dev>';
  const confirmed = status === 'confirmed';
  const message = {
    from,
    to: [email],
    reply_to: process.env.CONTACT_TO_EMAIL,
    subject: confirmed ? 'Ihr Erstgespräch ist bestätigt' : 'Ihre Terminanfrage',
    text: [
      'Guten Tag,', '',
      confirmed
        ? `wir freuen uns auf das Erstgespräch am ${formatDate(date)} um ${time} Uhr. Den Termin finden Sie im Anhang für Ihren Kalender.`
        : `leider können wir den Termin am ${formatDate(date)} um ${time} Uhr nicht wahrnehmen. Bitte wählen Sie auf unserer Website einen anderen Termin oder antworten Sie auf diese E-Mail.`,
      ...(note ? ['', note] : []),
      '', 'Freundliche Grüße', 'Enes Doudouzi & Ahmet Ergün', '', `Anfrage-Nummer: ${id}`,
    ].join('\n'),
  };
  if (confirmed) {
    message.attachments = [{ filename: 'erstgespraech.ics', content: Buffer.from(buildIcs({ id, date, time })).toString('base64') }];
  }
  return message;
}

async function sendMail(message) {
  const mailResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(8000),
  });
  if (!mailResponse.ok) throw new Error('Email provider rejected the request');
}

async function purgeExpiredRequests() {
  if (!pool) return;
  try {
    const result = await pool.query(
      'DELETE FROM contact_requests WHERE created_at < NOW() - make_interval(days => $1)',
      [retentionDays],
    );
    if (result.rowCount) console.log(`Retention: ${result.rowCount} expired request(s) deleted`);
    await pool.query("DELETE FROM page_views WHERE day < CURRENT_DATE - INTERVAL '13 months'");
  } catch {
    console.error('Retention cleanup failed');
  }
}

app.get('/healthz', async (_request, response) => {
  if (!pool) return response.status(503).json({ status: 'unavailable' });
  try {
    await pool.query('SELECT 1');
    return response.json({ status: 'ok' });
  } catch {
    return response.status(503).json({ status: 'unavailable' });
  }
});

app.post('/api/contact', contactLimiter, async (request, response, next) => {
  const parsed = contactSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: 'Bitte prüfen Sie Ihre Angaben.' });
  if (parsed.data.website) return response.status(202).json({ status: 'received' });
  if (!parsed.data.consent) return response.status(400).json({ error: 'Bitte bestätigen Sie die Datenschutzhinweise.' });
  if (!pool || !process.env.RESEND_API_KEY || !process.env.CONTACT_TO_EMAIL) {
    return response.status(503).json({ error: 'Der Versand ist derzeit nicht verfügbar.' });
  }

  const { name, email, date, time, topic } = parsed.data;
  try {
    const clash = await pool.query(
      'SELECT 1 FROM contact_requests WHERE requested_date = $1 AND requested_time = $2 AND status = ANY($3) LIMIT 1',
      [date, time, ACTIVE],
    );
    if (clash.rowCount) return response.status(409).json({ error: 'Dieser Termin ist leider schon vergeben. Bitte wählen Sie einen anderen.' });
    const result = await pool.query(
      `INSERT INTO contact_requests (name, email, requested_date, requested_time, topic, consent_at)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id`,
      [name, email, date, time, topic],
    );
    const { notify, confirmation } = buildMails({ id: result.rows[0].id, name, email, date, time, topic });
    await sendMail(notify);
    if (sendConfirmation) {
      // Die Anfrage ist gespeichert und gemeldet; eine fehlgeschlagene Bestätigung soll sie nicht scheitern lassen.
      await sendMail(confirmation).catch(() => console.error('Confirmation email failed'));
    }
    return response.status(201).json({ status: 'received' });
  } catch (error) {
    if (error?.code === '23505') return response.status(409).json({ error: 'Dieser Termin ist leider schon vergeben. Bitte wählen Sie einen anderen.' });
    return next(error);
  }
});

// Freie Termine für die Terminauswahl auf der Website
app.get('/api/slots', async (_request, response, next) => {
  if (!pool) return response.status(503).json({ error: 'Termine sind derzeit nicht verfügbar.' });
  try {
    const result = await pool.query(
      `SELECT to_char(requested_date, 'YYYY-MM-DD') AS date, requested_time AS time FROM contact_requests
       WHERE requested_date >= CURRENT_DATE AND status = ANY($1)`,
      [ACTIVE],
    );
    response.set('Cache-Control', 'no-store');
    return response.json({ days: computeSlots(result.rows) });
  } catch (error) {
    return next(error);
  }
});

// Anonyme Seitenaufrufe: nur Pfad und Tag, keine IP-Adresse, keine Cookies.
const pageViewSchema = z.object({ path: z.string().max(100).regex(/^\/[a-z0-9\-/.]*$/) }).strict();
app.post('/api/pv', async (request, response) => {
  const parsed = pageViewSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: 'Ungültige Anfrage.' });
  if (!pool) return response.status(204).end();
  try {
    await pool.query(
      `INSERT INTO page_views (day, path, views) VALUES (CURRENT_DATE, $1, 1)
       ON CONFLICT (day, path) DO UPDATE SET views = page_views.views + 1`,
      [parsed.data.path],
    );
  } catch {
    console.error('Page view not stored');
  }
  return response.status(204).end();
});

// ===== Admin-Bereich (geschützt durch ADMIN_TOKEN) =====
function requireAdmin(request, response, next) {
  const given = Buffer.from(String(request.get('authorization') || '').replace(/^Bearer /, ''));
  const expected = Buffer.from(adminToken);
  if (adminToken.length < 24 || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return response.status(401).json({ error: 'Nicht berechtigt.' });
  }
  if (!pool) return response.status(503).json({ error: 'Datenbank nicht verfügbar.' });
  return next();
}
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false });

app.get('/api/admin/requests', adminLimiter, requireAdmin, async (_request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, to_char(requested_date, 'YYYY-MM-DD') AS date, requested_time AS time, topic, status, created_at
       FROM contact_requests ORDER BY created_at DESC LIMIT 200`,
    );
    response.set('Cache-Control', 'no-store');
    return response.json({ requests: result.rows });
  } catch (error) {
    return next(error);
  }
});

const statusSchema = z.object({ status: z.enum(['confirmed', 'declined']), note: z.string().trim().max(500).optional().default('') }).strict();
app.post('/api/admin/requests/:id/status', adminLimiter, requireAdmin, async (request, response, next) => {
  const id = Number(request.params.id);
  const parsed = statusSchema.safeParse(request.body);
  if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) return response.status(400).json({ error: 'Ungültige Anfrage.' });
  try {
    const result = await pool.query(
      `UPDATE contact_requests SET status = $1 WHERE id = $2
       RETURNING id, email, to_char(requested_date, 'YYYY-MM-DD') AS date, requested_time AS time`,
      [parsed.data.status, id],
    );
    if (!result.rowCount) return response.status(404).json({ error: 'Anfrage nicht gefunden.' });
    let mailed = false;
    if (sendConfirmation && process.env.RESEND_API_KEY) {
      const mail = buildDecisionMail({ ...result.rows[0], status: parsed.data.status, note: parsed.data.note });
      mailed = await sendMail(mail).then(() => true, () => false);
    }
    return response.json({ status: parsed.data.status, mailed });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/admin/stats', adminLimiter, requireAdmin, async (_request, response, next) => {
  try {
    const [daily, pages] = await Promise.all([
      pool.query(`SELECT to_char(day, 'YYYY-MM-DD') AS day, SUM(views)::int AS views FROM page_views
                  WHERE day > CURRENT_DATE - 30 GROUP BY day ORDER BY day`),
      pool.query(`SELECT path, SUM(views)::int AS views FROM page_views
                  WHERE day > CURRENT_DATE - 30 GROUP BY path ORDER BY views DESC LIMIT 15`),
    ]);
    return response.json({ daily: daily.rows, pages: pages.rows });
  } catch (error) {
    return next(error);
  }
});

app.use((error, _request, response, _next) => {
  if (error?.type === 'entity.too.large') return response.status(413).json({ error: 'Die Anfrage ist zu groß.' });
  if (error?.type === 'entity.parse.failed') return response.status(400).json({ error: 'Ungültige Anfrage.' });
  if (error?.message === 'Origin not allowed') return response.status(403).json({ error: 'Anfrage nicht erlaubt.' });
  console.error('Request failed:', error?.name || 'Error');
  return response.status(500).json({ error: 'Die Anfrage konnte nicht verarbeitet werden.' });
});

async function start() {
  if (!pool && isProduction) throw new Error('DATABASE_URL is required');
  if (pool) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contact_requests (
        id BIGSERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(254) NOT NULL,
        requested_date DATE NOT NULL,
        requested_time VARCHAR(5) NOT NULL,
        topic VARCHAR(2000) NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query('ALTER TABLE contact_requests ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ');
    await pool.query("ALTER TABLE contact_requests ADD COLUMN IF NOT EXISTS status VARCHAR(12) NOT NULL DEFAULT 'pending'");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS page_views (
        day DATE NOT NULL,
        path VARCHAR(100) NOT NULL,
        views INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, path)
      )
    `);
    // Verhindert Doppelbuchungen auch bei gleichzeitigen Anfragen.
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS contact_requests_active_slot
      ON contact_requests (requested_date, requested_time) WHERE status IN ('pending', 'confirmed')`)
      .catch(() => console.error('Slot index not created (existing duplicate requests?)'));
    await purgeExpiredRequests();
    setInterval(purgeExpiredRequests, 24 * 60 * 60 * 1000).unref();
  }
  const server = app.listen(port, '0.0.0.0', () => console.log(`Contact API listening on port ${port}`));
  const shutdown = () => server.close(async () => {
    await pool?.end();
    process.exit(0);
  });
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((error) => {
    console.error('API startup failed:', error?.message || 'Error');
    process.exitCode = 1;
  });
}

export { app, buildDecisionMail, buildMails, contactSchema };
