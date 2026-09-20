# COMCAVE Discord Bot

Ein Discord-Bot fuer eine private COMCAVE-Umschulungs-Lerngruppe.

Auf dem technischen Grundgeruest (Konfiguration, Logging, Datenpersistenz,
Berechtigungssystem, Command-/Event-Infrastruktur) sind drei Kernfunktionen umgesetzt:
**Verifizierung neuer Mitglieder**, **dynamisches Onboarding** und **Klassenzuweisung A/B/C**.
Weitere Fachfunktionen (private Klassenbereiche, Klassenleitung, Berichte, Moderation, ...)
werden darauf aufbauend schrittweise ergaenzt.
Details zu Architektur und Roadmap stehen in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Verifizierung

Ablauf:

1. Ein Admin richtet die Verifizierung einmalig ein: `/setup-verifizierung rolle:<@Rolle> kanal:<#Kanal>`.
   Das speichert die Verifiziert-Rolle und postet eine dauerhafte Verifizierungsnachricht mit
   Button im angegebenen Kanal.
2. Tritt ein neues Mitglied dem Server bei, legt der Bot automatisch einen Datenbank-Eintrag
   (Status `PENDING`) an und versucht, ihm dieselbe Verifizierungsnachricht per DM zu senden
   (schlaegt das fehl, z. B. weil DMs deaktiviert sind, bleibt der Kanal-Button nutzbar).
3. Das Mitglied klickt auf **"Ich bin verifiziert"** (oder nutzt `/verifizieren`) und erhaelt
   die konfigurierte Rolle; der Status wird auf `VERIFIED` gesetzt und ins Audit-Log geschrieben.
4. Admins koennen den Status jederzeit einsehen (`/verifizierung-status [nutzer]`) oder manuell
   korrigieren (`/mitglied-verifizieren nutzer:<@Mitglied> status:<...>`), z. B. um jemanden
   abzulehnen oder zurueckzusetzen.

Alle Zustandsaenderungen laufen zentral durch `src/services/verificationService.ts`, das sowohl
vom Button-Handler als auch von den Slash-Commands verwendet wird - keine doppelte Logik, ein
einheitliches Audit-Log (`member.verify` / `member.reject` / `member.reset`).

Verifizierung funktioniert sowohl im Server-Kanal als auch direkt in der Beitritts-DM (der Bot
sucht dazu ueber alle Server, auf denen er aktiv ist, nach dem passenden Mitglied).

## Onboarding

Direkt im Anschluss an eine erfolgreiche Selbst-Verifizierung (Button oder `/verifizieren`)
startet automatisch ein kurzer, dynamischer Fragebogen - in derselben Nachricht, per
Select-Menu, ganz ohne Freitext:

1. **IT-Vorerfahrung** (Einzelauswahl: Keine / Anfaenger:in / Fortgeschritten / Erfahren).
2. **Technische Kenntnisse** (Mehrfachauswahl) - wird **uebersprungen**, wenn bei 1. "Keine"
   gewaehlt wurde.
3. **Bisherige IT-bezogene Taetigkeit** (Einzelauswahl aus Kategorien, z. B. "Ausbildung/Studium",
   "Berufserfahrung") - ebenfalls uebersprungen bei "Keine IT-Erfahrung".
4. **Lern- und IT-Interessen** (Mehrfachauswahl) - immer gefragt, Grundlage fuer spaetere
   optionale Interessenrollen.

Jede Antwort schaltet die naechste Frage in derselben Nachricht frei (`interaction.update()`,
kein Nachrichten-Spam). Nach der letzten Frage erscheint eine Zusammenfassung mit einem
**"Onboarding erneut ausfuellen"**-Button - alte Antworten gehen dabei nie verloren, es zaehlt
immer die zuletzt gegebene Antwort pro Frage. Wer das Onboarding zwischendurch abbricht, holt es
jederzeit mit `/onboarding` nach; der Befehl setzt automatisch an der naechsten offenen Frage fort
bzw. zeigt die Zusammenfassung, falls bereits abgeschlossen.

Erfasst werden ausschliesslich kategoriale Angaben (keine Freitextfelder) - bewusst, um keine
unnoetigen personenbezogenen Daten zu erheben. `IT-Vorerfahrung` und `Interessen` werden zusaetzlich
auf `Member.itExperienceLevel`/`Member.interests` denormalisiert, damit kuenftige Rollen- und
Klassenlogik direkt darauf zugreifen kann, ohne den vollstaendigen Antwortverlauf durchsuchen zu
muessen; die vollstaendige Historie bleibt unabhaengig davon in `OnboardingAnswer` erhalten.

## Klassenzuweisung

Ablauf:

1. Ein Admin richtet die drei Klassen einmalig ein: `/setup-klassen klasse-a:<@Rolle> klasse-b:<@Rolle> klasse-c:<@Rolle> kanal:<#wo-bin-ich>`.
   Das speichert die drei Klassenrollen und postet eine dauerhafte **#wo-bin-ich**-Nachricht mit
   je einem Button pro Klasse in den angegebenen Kanal. Die Konfiguration wird abgelehnt, wenn
   zwei Klassen dieselbe Rolle nutzen wuerden oder eine der Rollen Administrator-Rechte hat.
2. Ein **verifiziertes** Mitglied klickt in #wo-bin-ich auf seine Klasse (oder nutzt `/wo-bin-ich`,
   das dieselbe Auswahl privat/ephemer zeigt und die aktuelle Klasse hervorhebt) und erhaelt die
   entsprechende Klassenrolle.
3. Bei einem **Wechsel** wird automatisch zuerst die alte Klassenrolle entfernt, dann die neue
   vergeben, `Member.classId` aktualisiert und ein Audit-Log-Eintrag geschrieben
   (`class.assign` bei Erstzuweisung, `class.change` bei einem Wechsel, jeweils mit `from`/`to`
   in den Metadaten). Ein Mitglied gehoert dadurch nie zwei Klassen gleichzeitig an.

Unverifizierte Mitglieder erhalten beim Klick bzw. bei `/wo-bin-ich` eine klare Fehlermeldung statt
einer Klassenzuweisung. Die dauerhafte #wo-bin-ich-Kanal-Nachricht bleibt fuer alle unveraendert
sichtbar (nur eine private Bestaetigung an den klickenden Nutzer) - `/wo-bin-ich` zeigt dagegen eine
persoenliche, ephemere Kopie, die sich beim Klick live aktualisiert.

Alle Zustandsaenderungen laufen zentral durch `src/services/classService.ts::assignClass()`,
verwendet sowohl vom Button-Handler als auch von `/wo-bin-ich` - keine doppelte Logik.

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

## Tests

`npm test` fuehrt sowohl reine Unit-Tests (Berechtigungslogik, Fehlerklassen) als auch
Integrationstests der Repository-/Service-Schicht gegen eine **echte** SQLite-Testdatenbank aus
(`prisma/test.db`, per `tests/globalSetup.ts` vor dem Testlauf frisch aus den Prisma-Migrationen
aufgebaut und danach wieder geloescht). Discord.js-Objekte (z. B. `GuildMember`) werden dabei
gezielt mit einfachen Fake-Objekten simuliert (siehe `tests/verificationService.test.ts`), damit
Tests ohne echte Discord-Verbindung laufen.

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
    events/                Discord-Event-Handler (inkl. guildMemberAdd, interactionCreate)
    handlers/               Command-/Event-Loader, Command-Deploy-Skript
    ui/                       Wiederverwendbare Discord-UI-Bausteine (Embeds/Buttons/Select-Menus)
    discordHelpers.ts          Kleine, gezielt testbare discord.js-Hilfsfunktionen
  config/                    Umgebungsvariablen-Validierung (Zod)
  db/                          Prisma-Client-Singleton
  permissions/                  Berechtigungsstufen & -pruefung
  repositories/                   Datenzugriffsschicht (kapselt Prisma)
  services/                         Fachlogik: verificationService.ts, onboardingService.ts,
                                     onboardingFlow.ts (reine Fragen-/Skip-Logik ohne I/O),
                                     classService.ts, discordRoleSync.ts (gemeinsame
                                     Rollenvergabe-Fehlerbehandlung)
  types/                              Gemeinsame TypeScript-Typen
  utils/                                Logger, Fehlerklassen
prisma/
  schema.prisma                         Datenmodell
  migrations/                            Migrationshistorie
tests/                                     Vitest-Tests (siehe Abschnitt "Tests")
```

## Sicherheit

- Es werden zu keinem Zeitpunkt echte Zugangsdaten in diesem Repository gespeichert.
  `.env` ist per `.gitignore` ausgeschlossen, `.env.example` enthaelt nur Platzhalter.
- Berechtigungen werden zentral in `src/permissions/` geprueft, nicht in einzelnen Commands
  verstreut, um Inkonsistenzen zu vermeiden.
- Der Bot benoetigt aktuell nur die Discord-Intents, die fuer die vorhandenen Funktionen
  noetig sind (`src/bot/client.ts`); weitere Intents werden erst bei Bedarf ergaenzt.
- `GuildMembers` ist ein **privilegierter Intent**: er muss im
  [Discord Developer Portal](https://discord.com/developers/applications) unter
  "Bot" > "Privileged Gateway Intents" explizit aktiviert werden, sonst schlaegt der Login fehl.
  Das ist erst relevant, sobald der Bot tatsaechlich mit einem echten Token verbunden wird.
- Rollenvergabe/-entzug wird zentral im Verification-Service behandelt: fehlt dem Bot die
  Berechtigung (z. B. weil seine Rolle in der Hierarchie zu niedrig steht), wird das als
  verstaendliche Fehlermeldung an den Nutzer zurueckgegeben statt eines stillen Fehlschlags.
- Onboarding erfasst bewusst nur kategoriale Auswahlantworten (feste Optionslisten), keine
  Freitextfelder - so koennen keine unbeabsichtigten personenbezogenen Details erfasst werden.
  Jede eingehende Antwort wird zusaetzlich serverseitig gegen die erlaubten Optionen validiert
  (`src/services/onboardingFlow.ts`), auch wenn sie technisch nur ueber die vom Bot selbst
  gesendeten Select-Menus zustande kommen sollte.
- Am Onboarding kann nur teilnehmen, wer laut Datenbank aktuell `VERIFIED` ist
  (`assertMemberVerified()`); das wird bei jedem Zugriff neu geprueft, nicht nur einmalig beim
  Start des Fragebogens.
- Ebenso kann nur ein verifiziertes Mitglied eine Klasse auswaehlen (`assignClass()`/
  `getCurrentClassName()` pruefen das jeweils selbst, nicht nur die aufrufende Command-Ebene).
- `/setup-klassen` verweigert Rollen mit Administrator-Berechtigung als Klassenrolle - eine
  Klassenzugehoerigkeit darf nie globale Admin-Rechte verleihen.
