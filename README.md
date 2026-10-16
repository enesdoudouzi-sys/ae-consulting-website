# AE Consulting – Website und Kontakt-API

Prozess- und KI-Beratung für den Mittelstand · Ahmet Ergün & Enes Doudouzi

| Teil | Ort | Läuft auf |
|---|---|---|
| Website (statisch, ohne Build) | `docs/` | GitHub Pages |
| API (Termine, Anfragen, Statistik) | `api/` | Render Web Service + Neon Postgres + Resend |

Live: https://enesdoudouzi-sys.github.io/ae-consulting-website/

## Lokal entwickeln

```bash
npm ci
npm test                 # alle Tests
npm run check            # Syntaxprüfung der API
cp .env.example .env     # Werte eintragen, dann:
node --env-file=.env api/server.js
python3 -m http.server 8000 -d docs   # Website unter http://localhost:8000
```

Für lokale Tests in `docs/assets/config.js` vorübergehend `api: 'http://localhost:3000'` setzen.

## Umgebungsvariablen (Render → Environment)

| Variable | Bedeutung |
|---|---|
| `DATABASE_URL` | Neon-Verbindungs-URL |
| `RESEND_API_KEY` | API-Schlüssel von Resend |
| `RESEND_FROM_EMAIL` | Absender, z. B. `AE Consulting <kontakt@ae-consulting.de>` |
| `CONTACT_TO_EMAIL` | Wer neue Anfragen bekommt |
| `SEND_CONFIRMATION` | `true` = Kunden bekommen Eingangs- und Terminbestätigung (nur mit verifizierter Domain bei Resend) |
| `ADMIN_TOKEN` | Schlüssel für `admin.html` (mind. 24 Zeichen, `openssl rand -hex 24`) |
| `RETENTION_DAYS` | Anfragen werden nach so vielen Tagen gelöscht (Standard 180) |
| `SITE_ORIGIN` | Erlaubte Website-Adressen, kommagetrennt |

## So pflegt ihr die Website

- **Fotos der Gründer:** Bild (quadratisch, ca. 400×400 px) nach `docs/assets/team/` legen und den Pfad in `docs/assets/config.js` unter `photos` eintragen.
- **LinkedIn:** Profil-Adressen in `docs/assets/config.js` unter `linkedin` eintragen. Leere Felder werden nicht angezeigt.
- **Kundenstimmen:** in `docs/assets/config.js` unter `testimonials` eintragen – nur mit Zustimmung der Kunden. Der Abschnitt erscheint automatisch.
- **Neuer Fachartikel:** eine der Dateien in `docs/wissen/` kopieren, Titel, Beschreibung und Text anpassen, auf `docs/wissen/index.html` und auf der Startseite (Abschnitt `#wissen`) verlinken und in `docs/sitemap.xml` eintragen.
- **Termine verwalten:** `…/admin.html` öffnen, mit `ADMIN_TOKEN` anmelden, Anfragen bestätigen oder absagen. Dort seht ihr auch die anonymen Seitenaufrufe.
- **Uhrzeiten für Termine:** in `api/booking.js` (`TIMES`) und im Fallback-Auswahlfeld in `docs/index.html`.

## Eigene Domain (z. B. ae-consulting.de)

1. Domain bei einem Anbieter kaufen (z. B. INWX, Strato, IONOS).
2. GitHub → Repository → Settings → Pages → **Custom domain** eintragen; beim Domain-Anbieter die angezeigten DNS-Einträge setzen. „Enforce HTTPS“ aktivieren.
3. In Render `SITE_ORIGIN` um `https://ae-consulting.de` ergänzen.
4. In `docs/index.html`, `docs/wissen/*.html`, `docs/sitemap.xml`, `docs/robots.txt` die Adresse `enesdoudouzi-sys.github.io/ae-consulting-website` ersetzen; in `docs/404.html` `<base href="/">` setzen und in `docs/assets/site.js` das Entfernen des Präfixes prüfen.
5. Bei Resend die Domain verifizieren, `RESEND_FROM_EMAIL` auf die neue Adresse setzen und `SEND_CONFIRMATION=true`.

Siehe auch `GESCHAEFT-CHECKLISTE.md` für alles außerhalb des Codes.
