# COMCAVE Discord Bot

Ein Discord-Bot fuer eine private COMCAVE-Umschulungs-Lerngruppe.

Auf dem technischen Grundgeruest (Konfiguration, Logging, Datenpersistenz,
Berechtigungssystem, Command-/Event-Infrastruktur) sind sechs Kernfunktionen umgesetzt:
**Verifizierung neuer Mitglieder**, **dynamisches Onboarding**, **Klassenzuweisung A/B/C**,
**private Klassenbereiche**, **klassenbezogene Klassenleitung** sowie **Pruefungen und Termine**
als erste klassenbezogene Fachfunktionen. Weitere Fachfunktionen (Berichte, Lernmaterial,
weitergehende Moderation, ...) werden darauf aufbauend schrittweise ergaenzt.
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

## Private Klassenbereiche

Nachdem die Klassenrollen mit `/setup-klassen` stehen, richtet ein Admin mit
`/setup-klassenbereiche` (optional mit `klasse:<A|B|C>` fuer nur eine Klasse) pro Klasse eine
eigene, unsichtbare Kategorie mit sieben Kanaelen ein:

- 💬 **Klassenchat** - freie Diskussion
- 📢 **Ankuendigungen** - nur lesbar fuer die Klasse (Admins/Klassenleitung koennen posten)
- 📅 **Termine**
- 🎓 **Pruefungen**
- 📝 **Berichtsheft** - fuer Tages-/Wochenberichte der Mitglieder
- 📚 **Lernmaterial**
- 🔊 **Sprachkanal**

Die Kategorie ist fuer `@everyone` unsichtbar und nur fuer die jeweilige Klassenrolle (sowie die
konfigurierte Admin-Rolle) sichtbar - echte Discord-Permission-Overwrites, keine reine
Konvention. Der Befehl ist **pro Kanal idempotent**: ein erneuter Aufruf legt nichts doppelt an,
sondern ergaenzt nur fehlende Kanaele (z. B. wenn einer versehentlich geloescht wurde) und laesst
alle bestehenden unangetastet.

## Klassenleitung

Eine Klassenleitung ist **kein Discord-Administrator** - sie darf ausschliesslich ihre eigene
Klasse verwalten, ohne jede serverweite Berechtigung.

1. Ein Admin weist die Klassenleitung zu: `/setup-klassenleitung klasse:<A|B|C> mitglied:<@Person>`.
   Existiert noch keine Klassenleitungs-Rolle fuer diese Klasse, wird sie automatisch angelegt
   (immer **ohne jede Basis-Berechtigung** - alle Rechte kommen ausschliesslich aus den
   Kanal-Overwrites des privaten Klassenbereichs). Haelt die Person bereits die Klassenleitung
   einer anderen Klasse, wird diese automatisch sauber entfernt (eine Person leitet immer nur
   eine Klasse). Eine bestehende Klassenleitung derselben Klasse wird bei Neuzuweisung ersetzt.
2. Entfernen/Aendern: `/entferne-klassenleitung klasse:<A|B|C>` entzieht die Rolle und loescht
   die Zuweisung (die Rolle selbst bleibt fuer eine spaetere Neuzuweisung erhalten). Eine neue
   Zuweisung per `/setup-klassenleitung` ersetzt eine bestehende automatisch (kein separater
   "Entfernen"-Schritt noetig fuer einen reinen Wechsel).
3. Innerhalb der eigenen Klassenkanaele darf die Klassenleitung u. a. Nachrichten
   senden/bearbeiten/loeschen/anheften, Dateien hochladen, Threads erstellen/verwalten, die
   eigene Klassenrolle erwaehnen, den Klassen-Sprachkanal moderieren (Mute/Deafen/Move) und bei
   Bedarf Mitglieder der eigenen Klasse per Timeout moderieren.
4. **Ausdruecklich ausgeschlossen** - egal ob als Basis-Rollenberechtigung oder Kanal-Overwrite:
   Administrator, Server-/Rollen-/Kanal-/Webhook-Verwaltung, globale Ban-/Kick-Rechte sowie jede
   Verwaltung einer anderen Klasse.
5. `/setup-klassenbereiche` darf jetzt auch von einer Klassenleitung ausgefuehrt werden -
   **ausschliesslich fuer die eigene Klasse** (die Klasse muss explizit angegeben werden). Ein
   Versuch, eine fremde Klasse anzugeben, wird zentral ueber `assertClassManagementAccess()`
   (siehe `src/permissions/checkPermission.ts`) mit einer `PermissionError` abgelehnt - unabhaengig
   vom uebergebenen Command-Parameter ("Fail closed").

Alle Zuweisungen, Wechsel und Entfernungen werden im Audit-Log protokolliert
(`class.lead_assign` / `class.lead_change` / `class.lead_remove`).

## Pruefungen und Termine

Die erste klassenbezogene Fachfunktion auf Basis der Klassenleitung: Admin oder die
Klassenleitung der jeweiligen Klasse koennen Pruefungen und Termine verwalten, alle Mitglieder
der Klasse koennen sie einsehen.

**🎓 Pruefungen:**

- `/pruefung-erstellen klasse:<A|B|C> fach:<...> datum:<TT.MM.JJJJ> uhrzeit:<HH:MM> beschreibung:<...> [lernhinweise:<...>]`
- `/pruefung-bearbeiten pruefung-id:<...> [fach:<...>] [datum:<...>] [uhrzeit:<...>] [beschreibung:<...>] [lernhinweise:<...>]`
  (Datum und Uhrzeit muessen gemeinsam angegeben werden, wenn der Zeitpunkt geaendert werden soll)
- `/pruefung-loeschen pruefung-id:<...>`
- `/pruefungen-anzeigen [klasse:<A|B|C>]` - ohne Angabe wird die eigene Klasse angezeigt

**📅 Termine:** dieselben vier Befehle mit `termin-` statt `pruefung-` (`titel` statt `fach`,
keine Lernhinweise).

Zugriff:

- **Verwalten** (erstellen/bearbeiten/loeschen): nur Admin oder die Klassenleitung der
  betroffenen Klasse - zentral geprueft ueber `assertClassManagementAccess()`, dieselbe Funktion
  wie bei den privaten Klassenbereichen. Beim Bearbeiten/Loeschen wird die Klasse dabei **immer**
  aus dem gespeicherten Datensatz aufgeloest, nie aus einem vom Aufrufer angegebenen Parameter -
  eine Klassenleitung kann dadurch nicht durch Angabe einer fremden Pruefungs-/Termin-ID auf eine
  andere Klasse zugreifen.
- **Lesen** (`*-anzeigen`): jedes verifizierte Mitglied fuer die eigene Klasse, zusaetzlich Admin
  und die jeweilige Klassenleitung fuer jede Klasse (`assertClassReadAccess()`). Der Zugriff auf
  eine fremde Klasse wird auch bei expliziter Angabe verweigert.

Jede Erstellung/Aenderung/Loeschung wird im Audit-Log protokolliert (`exam.create`/`exam.update`/
`exam.delete` bzw. `appointment.create`/`appointment.update`/`appointment.delete`).

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
                                     classService.ts, classAreaService.ts (private
                                     Klassenbereiche), classLeadService.ts (Klassenleitung),
                                     examService.ts / appointmentService.ts (Pruefungen/Termine),
                                     discordRoleSync.ts (gemeinsame
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
- Private Klassenbereiche sind ueber echte Discord-Permission-Overwrites abgesichert
  (`@everyone` explizit ausgeschlossen), nicht nur durch Konvention oder Kanal-Anordnung.
- Die Klassenleitungs-Rolle wird beim Anlegen immer mit `permissions: []` erstellt (keine
  Basis-Berechtigung) - jedes Recht kommt ausschliesslich aus den Kanal-Overwrites der eigenen
  Klasse. Vor jeder Zuweisung prueft `classLeadService.ts` zusaetzlich fail-closed, ob eine
  bestehende Rolle nachtraeglich manuell mit Administrator-Rechten versehen wurde, und verweigert
  die Zuweisung in dem Fall.
- Klassenbezogene Verwaltungsaktionen laufen zentral ueber
  `assertClassManagementAccess()`/`isClassLeadOf()` (`src/permissions/checkPermission.ts`):
  erlaubt ist nur ein globaler Admin oder die Klassenleitung genau der betroffenen Klasse - eine
  manipulierte Klassen-ID/ein manipulierter Command-Parameter fuehrt nie zu Zugriff auf eine
  fremde Klasse. Kuenftige klassenbezogene Funktionen sollen dieselbe Pruefung verwenden.
- Pruefungen und Termine nutzen `assertClassManagementAccess()`/`assertClassReadAccess()` als
  einzige Berechtigungslogik - keine zweite, parallele Pruefung. Beim Bearbeiten/Loeschen wird
  die Klasse dabei immer aus dem gespeicherten Datensatz (`exam.classId`/`appointment.classId`)
  aufgeloest statt aus einem vom Aufrufer angegebenen Parameter, damit eine manipulierte
  Pruefungs-/Termin-ID niemals Zugriff auf eine fremde Klasse verschaffen kann.
