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
}).strict().superRefine(({ date }, context) => {
  const requestedDate = new Date(`${date}T12:00:00Z`);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (requestedDate < today || [0, 6].includes(requestedDate.getUTCDay())) {
    context.addIssue({ code: 'custom', message: 'Choose a future weekday.', path: ['date'] });
  }
});

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
  if (!pool || !process.env.RESEND_API_KEY || !process.env.CONTACT_TO_EMAIL) {
    return response.status(503).json({ error: 'Der Versand ist derzeit nicht verfügbar.' });
  }

  const { name, email, date, time, topic } = parsed.data;
  try {
    const result = await pool.query(
      `INSERT INTO contact_requests (name, email, requested_date, requested_time, topic)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [name, email, date, time, topic],
    );
    const mailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'AE Consulting <onboarding@resend.dev>',
        to: [process.env.CONTACT_TO_EMAIL],
        reply_to: email,
        subject: 'Anfrage für ein Erstgespräch',
        text: [
          `Name: ${name}`, `E-Mail: ${email}`,
          `Wunschtermin: ${date} um ${time} Uhr`,
          `Anliegen: ${topic || 'Noch offen'}`, `Anfrage-ID: ${result.rows[0].id}`,
        ].join('\n'),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!mailResponse.ok) throw new Error('Email provider rejected the request');
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

export { app };
