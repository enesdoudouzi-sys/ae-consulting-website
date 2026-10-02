# AE Consulting
Prozessberatung für den Mittelstand (Gründer: Ahmet Ergün, Enes Doudouzi).

## Struktur
- website/  statische Seite (index.html, kein Build-Schritt), Deployment: Render Static Site
- api/      Express-Backend (Kontaktformular, Neon-Postgres, Resend), Deployment: Render Web Service

## Regeln
- Sprache der Website-Texte: Deutsch, Sie-Form
- Keine Secrets committen, .env bleibt in .gitignore
- Kleine, thematisch getrennte Commits
- Vor jedem Commit prüfen: `node --check api/server.js`
