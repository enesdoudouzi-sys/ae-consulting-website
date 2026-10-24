<div align="center">

# 🧩 Portfolio Doudouzi & Ergün — Website & Kontakt-API

**Portfolio-Website mit eigener Buchungs- & Kontakt-API — Prozesse, Logistik und KI für kleine und mittlere Unternehmen.**

[![Live](https://img.shields.io/badge/Live-Website-2563eb?style=for-the-badge&logo=github)](https://enesdoudouzi-sys.github.io/ae-consulting-website/)
&nbsp;
![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?style=for-the-badge&logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)

### 👉 [**Live ansehen**](https://enesdoudouzi-sys.github.io/ae-consulting-website/)

</div>

![Website Vorschau](screenshots/home.png)

---

## 📖 Über das Projekt

Eine komplette **Website mit eigenem Backend** — das gemeinsame Portfolio von **Enes Doudouzi & Ahmet Ergün** (Prozesse, Logistik & KI für KMU). Interessenten können Anfragen stellen und **Termine buchen** — verarbeitet von einer selbst gebauten REST-API mit Datenbank, E-Mail-Versand und einem geschützten Admin-Bereich.

Das Projekt zeigt **Full-Stack-Entwicklung von A bis Z**: statisches Frontend, sichere API, Datenbank, E-Mail-Automatisierung, Datenschutz und Deployment.

## ✨ Features

- 📅 **Termin-Buchung & Kontaktformular** mit Server-Validierung (Zod)
- 📧 **Automatische E-Mails** (Eingangs- & Terminbestätigung) via Resend
- 🔐 **Geschützter Admin-Bereich** (Token-Auth) zum Verwalten von Anfragen
- 🛡 **Security-Hardening:** Helmet (HTTP-Header), Rate-Limiting, CORS-Allowlist
- 🗑 **DSGVO-konform:** automatische Löschung alter Anfragen nach X Tagen
- 📈 **Anonyme Seitenaufruf-Statistik** (ohne Cookies/Tracking)
- 🔎 **SEO-optimiert:** Sitemap, robots.txt, Fachartikel-Bereich

## 🧰 Tech-Stack

| Teil | Technik | Hosting |
|---|---|---|
| **Frontend** | HTML · CSS · JavaScript (statisch, kein Build) | GitHub Pages |
| **Backend/API** | Node.js · Express 5 · Zod · Helmet · Rate-Limit | Render |
| **Datenbank** | PostgreSQL (Neon) | Neon |
| **E-Mail** | Resend | — |

## 🚀 Lokal starten

```bash
npm ci
npm test                              # Tests
npm run check                         # API-Syntaxprüfung
cp .env.example .env                  # Werte eintragen
node --env-file=.env api/server.js    # API starten
python3 -m http.server 8000 -d docs   # Website → http://localhost:8000
```

> Konfiguration & Betrieb (Umgebungsvariablen, Domain, Pflege der Inhalte, Admin-Bereich) sind in [`GESCHAEFT-CHECKLISTE.md`](GESCHAEFT-CHECKLISTE.md) dokumentiert.

---

<div align="center">

Entwickelt von **Enes Doudouzi** & **Ahmet Ergün**

</div>
