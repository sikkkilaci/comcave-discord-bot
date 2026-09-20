# COMCAVE Discord Bot

Ein Discord-Bot fuer eine private COMCAVE-Umschulungs-Lerngruppe.

Dieses Repository enthaelt aktuell das **technische Grundgeruest** des Projekts:
Konfiguration, Logging, Datenpersistenz, Berechtigungssystem, Command-/Event-Infrastruktur
sowie zwei Beispiel-Commands. Die eigentlichen Fachfunktionen (Verifizierung, Onboarding,
Klassenverwaltung, Berichte, Moderation, ...) werden darauf aufbauend schrittweise ergaenzt.
Details zu Architektur und Roadmap stehen in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Voraussetzungen

- Node.js 22+
- npm 10+
- Ein Discord-Bot-Application/Token (siehe unten) - **wird fuer die lokale Entwicklung
  des Grundgeruests nicht zwingend benoetigt**, nur zum tatsaechlichen Verbinden mit Discord.

## Setup

```bash
npm install
cp .env.example .env
# .env mit echten Werten befuellen (siehe Abschnitt "Umgebungsvariablen")

npm run db:generate   # Prisma Client generieren
npm run db:migrate    # Datenbank-Schema anlegen (SQLite-Datei unter prisma/dev.db)
```

## Umgebungsvariablen

Siehe [`.env.example`](./.env.example) fuer die vollstaendige Liste. Wichtig:

- `DISCORD_TOKEN` / `DISCORD_CLIENT_ID`: Zugangsdaten der Discord-Bot-Application aus dem
  [Discord Developer Portal](https://discord.com/developers/applications). **Niemals committen.**
- `DISCORD_DEV_GUILD_ID`: Optional. Wenn gesetzt, werden Slash-Commands nur auf diesem Server
  registriert (sofort aktiv, ideal fuer Entwicklung). Ohne diese Variable erfolgt eine globale
  Registrierung (kann bis zu einer Stunde dauern, bis Discord die Befehle ausrollt).
- `DATABASE_URL`: Pfad zur SQLite-Datenbankdatei im Prisma-Connection-String-Format.

## Entwicklung

```bash
npm run dev              # Bot im Watch-Modus starten (benoetigt gueltigen DISCORD_TOKEN)
npm run deploy-commands   # Slash-Commands bei Discord registrieren
npm run lint              # ESLint
npm run format            # Prettier (schreibend)
npm run typecheck          # TypeScript ohne Emit
npm test                   # Vitest
npm run build               # Kompiliert nach dist/
npm start                    # Startet die kompilierte Version (dist/index.js)
```

Der Bot startet **ohne** gueltigen `DISCORD_TOKEN` nicht (Env-Validierung schlaegt fehl,
siehe `src/config/env.ts`). Alle uebrigen Bausteine (Command-/Event-Loader, Datenbank,
Berechtigungslogik) lassen sich unabhaengig davon per `npm test` und `npm run build` pruefen.

## Datenbank

SQLite via [Prisma ORM](https://www.prisma.io/). Schema unter `prisma/schema.prisma`,
Migrationen unter `prisma/migrations/`.

```bash
npm run db:migrate          # neue Migration erstellen + anwenden (Entwicklung)
npm run db:migrate:deploy    # bestehende Migrationen anwenden (Produktion)
npm run db:studio             # Prisma Studio (grafischer DB-Browser)
```

## Docker

```bash
docker compose up --build
```

Die Datenbank wird in einem benannten Docker-Volume (`bot-data`) persistiert, damit sie
Container-Neustarts uebersteht. `docker-compose.yml` erwartet eine `.env`-Datei mit
`DISCORD_TOKEN` und `DISCORD_CLIENT_ID`.

## Projektstruktur

```
src/
  bot/
    client.ts            Discord-Client-Erstellung & Bootstrap
    commands/             Slash-Commands, nach Kategorie gruppiert
    events/                Discord-Event-Handler
    handlers/               Command-/Event-Loader, Command-Deploy-Skript
  config/                    Umgebungsvariablen-Validierung (Zod)
  db/                          Prisma-Client-Singleton
  permissions/                  Berechtigungsstufen & -pruefung
  repositories/                   Datenzugriffsschicht (kapselt Prisma)
  services/                         Fachlogik (aktuell leer, fuer kommende Features)
  types/                              Gemeinsame TypeScript-Typen
  utils/                                Logger, Fehlerklassen
prisma/
  schema.prisma                         Datenmodell
  migrations/                            Migrationshistorie
tests/                                     Vitest-Tests
```

## Sicherheit

- Es werden zu keinem Zeitpunkt echte Zugangsdaten in diesem Repository gespeichert.
  `.env` ist per `.gitignore` ausgeschlossen, `.env.example` enthaelt nur Platzhalter.
- Berechtigungen werden zentral in `src/permissions/` geprueft, nicht in einzelnen Commands
  verstreut, um Inkonsistenzen zu vermeiden.
- Der Bot benoetigt aktuell nur die Discord-Intents, die fuer die vorhandenen Funktionen
  noetig sind (`src/bot/client.ts`); weitere Intents werden erst bei Bedarf ergaenzt.
