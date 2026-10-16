import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

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
  allowedHeaders: ['Content-Type'],
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
  time: z.string().regex(/^(09|10|11|13|14|15|16):00$/),
  topic: z.string().trim().max(2000).optional().default(''),
  website: z.string().max(100).optional().default(''),
  consent: z.union([z.literal(true), z.literal('on'), z.literal('true')]).optional(),
}).strict().superRefine(({ date }, context) => {
  const requestedDate = new Date(`${date}T12:00:00Z`);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (requestedDate < today || [0, 6].includes(requestedDate.getUTCDay())) {
    context.addIssue({ code: 'custom', message: 'Choose a future weekday.', path: ['date'] });
  }
});

const formatDate = (isoDate) => isoDate.split('-').reverse().join('.');

// Baut die E-Mails als reinen Text. Nutzereingaben landen nie im Betreff,
// und die Bestätigung an den Kunden enthält keinen frei eingegebenen Text.
function buildMails({ id, name, email, date, time, topic }) {
  const from = process.env.RESEND_FROM_EMAIL || 'AE Consulting <onboarding@resend.dev>';
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
    subject: 'Ihre Anfrage bei AE Consulting ist eingegangen',
    text: [
      'Guten Tag,', '',
      `vielen Dank für Ihre Anfrage für ein Erstgespräch am ${formatDate(date)} um ${time} Uhr.`,
      'Wir prüfen den Termin und melden uns in Kürze per E-Mail mit einer Bestätigung oder einem Alternativvorschlag.',
      'Der Termin ist erst nach unserer Bestätigung vereinbart.', '',
      'Freundliche Grüße', 'Ahmet Ergün & Enes Doudouzi', 'AE Consulting', '',
      `Ihre Anfrage-Nummer: ${id}`,
      `Ihre Angaben werden nach spätestens ${retentionDays} Tagen gelöscht. Haben Sie diese Anfrage nicht gestellt, können Sie diese E-Mail ignorieren.`,
    ].join('\n'),
  };
  return { notify, confirmation };
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
    await purgeExpiredRequests();
    setInterval(purgeExpiredRequests, 24 * 60 * 60 * 1000).unref();
  }
  const server = app.listen(port, '0.0.0.0', () => console.log(`AE Consulting API listening on port ${port}`));
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

export { app, buildMails, contactSchema };
