# Architektur

## Tech-Stack und Begruendung

| Bereich         | Wahl                            | Begruendung                                                                                                                                                                   |
| --------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sprache         | TypeScript (strict)             | Typsicherheit bei komplexem Berechtigungs-/Rollenmodell reduziert Laufzeitfehler deutlich; wichtig, da administrative Befehle Klassenleitung falsch/richtig zuordnen muessen. |
| Discord-Library | discord.js v14                  | Ausgereifteste, aktiv gewartete Node.js-Bibliothek fuer die Discord-API, gute Slash-Command- und Permission-Unterstuetzung.                                                   |
| Datenbank       | SQLite                          | Fuer eine einzelne private Lerngruppe voellig ausreichend, keine externe Infrastruktur (kein separater DB-Server) noetig, einfaches Backup (eine Datei).                      |
| ORM             | Prisma                          | Typsichere Queries, deklaratives Schema, Migrationsverwaltung. Bei Bedarf spaeter per `datasource provider` auf Postgres wechselbar, ohne die Anwendungslogik anzufassen.     |
| Validierung     | Zod                             | Fail-fast bei fehlerhafter Konfiguration (Env-Variablen); spaeter auch fuer Onboarding-Eingaben.                                                                              |
| Logging         | Pino                            | Strukturiertes JSON-Logging (produktionstauglich, maschinenlesbar fuer spaeteres Audit-Log), im Dev-Modus lesbar formatiert (`pino-pretty`).                                  |
| Tests           | Vitest                          | Schnell, ESM-nativ, gute TypeScript-Unterstuetzung ohne zusaetzliche Transpile-Konfiguration.                                                                                 |
| Lint/Format     | ESLint (flat config) + Prettier | Einheitlicher Code-Stil bei mehreren Beitragenden ueber die Projektlaufzeit.                                                                                                  |
| Deployment      | Docker (Multi-Stage-Build)      | Reproduzierbarer Betrieb, unabhaengig vom Host-System.                                                                                                                        |

## Architekturprinzipien

1. **Schichtentrennung.** Discord-spezifischer Code (`bot/`) ist von der Datenzugriffsschicht
   (`repositories/`) und zukuenftiger Fachlogik (`services/`) getrennt. Commands rufen idealerweise
   Services/Repositories auf statt direkt Prisma-Queries zu schreiben - das haelt Business-Logik
   testbar und unabhaengig von Discord.js.
2. **Zentrales Berechtigungssystem.** Jeder Slash-Command deklariert eine minimale
   `PermissionLevel` (`EVERYONE` / `VERIFIED` / `KLASSENLEITUNG` / `ADMIN`). Die Pruefung erfolgt
   an **einer** Stelle (`src/bot/events/interactionCreate.ts` + `src/permissions/checkPermission.ts`),
   nicht verstreut in einzelnen Commands. Das ist entscheidend fuer die spaetere Anforderung
   "Klassenleitung nur fuer die eigene Klasse": die globale Stufe `KLASSENLEITUNG` prueft nur, _dass_
   jemand irgendeine Klassenleitung ist; die Einschraenkung auf die _eigene_ Klasse erfolgt
   zusaetzlich in der jeweiligen Command-Logik ueber `isClassLeadOf()`, da dort erst bekannt ist,
   welche Klasse betroffen ist (z. B. bei `/klasse ankuendigung <klasse>`).
3. **Konfiguration statt Hardcoding.** Rollen-IDs, Kanal-IDs und Klassenzuordnungen werden in der
   Datenbank (`GuildConfig`, `Class`) gespeichert, nicht im Code. Das erlaubt Mehrfach-Einsatz und
   macht Rollenaenderungen auf Serverseite ohne Redeploy moeglich.
4. **Fail-fast-Konfiguration.** Der Bot startet nicht mit fehlerhafter/fehlender Konfiguration
   (`src/config/env.ts`), um Fehlkonfiguration in Produktion so frueh wie moeglich sichtbar zu machen.
5. **Erweiterbarkeit durch Konvention.** Neue Commands/Events werden einfach als Datei in
   `src/bot/commands/<kategorie>/` bzw. `src/bot/events/` abgelegt und automatisch beim Start geladen
   (`commandLoader.ts` / `eventLoader.ts`) - kein manuelles Registrieren in einer zentralen Liste noetig.
6. **Zentrale Fehlerbehandlung.** Fachliche Fehler werden als `AppError`-Subklassen
   (`PermissionError`, `NotFoundError`, `ValidationError`, siehe `src/utils/errors.ts`) geworfen und
   im `interactionCreate`-Handler einheitlich in eine nutzerfreundliche, ephemere Discord-Antwort
   uebersetzt; unerwartete Fehler werden geloggt, aber nicht mit internen Details an Nutzer
   durchgereicht.

## Datenmodell (aktueller Stand)

- `GuildConfig`: Konfiguration pro Server (Rollen-IDs, Kanal-IDs). Wird lazy per
  `getOrCreateGuildConfig()` angelegt, keine manuelle Ersteinrichtung noetig.
- `Member`: Verknuepfung Discord-Nutzer <-> Verifizierungsstatus, IT-Erfahrung, Interessen,
  Klassenzuordnung.
- `OnboardingAnswer`: Frage/Antwort-Paare fuer die dynamischen Onboarding-Folgefragen
  (append-only Historie, siehe Onboarding-Abschnitt unten).
- `Class`: Klasse (A/B/C) mit zugehoeriger Rolle, privatem Kategorie-Channel und
  Klassenleitungs-Rolle.
- `AuditLogEntry`: Generisches Audit-Log fuer administrative Aktionen/Moderation.

SQLite unterstuetzt in Prisma keine nativen Enums; Statuswerte (z. B. Verifizierungsstatus) werden
daher als String-Spalten mit Validierung in `src/types/domain.ts` (Zod) gefuehrt.

## Implementierte Kernfunktionen

### Verifizierung neuer Mitglieder

Beteiligte Bausteine (von unten nach oben):

- `src/repositories/memberRepository.ts` - reine Datenzugriffe auf `Member` (anlegen, lesen,
  Status setzen). Kennt weder Discord.js noch Geschaeftsregeln.
- `src/repositories/auditLogRepository.ts` - schreibt/liest `AuditLogEntry`-Eintraege.
- `src/services/verificationService.ts` - die eigentliche Geschaeftslogik:
  `ensureMemberTracked()` (Datensatz beim Beitritt anlegen) und `setMemberVerification()`
  (Statuswechsel inkl. Rollenvergabe/-entzug auf Discord + Audit-Log). Diese eine Funktion wird
  von **allen** Einstiegspunkten verwendet (Button-Klick, `/verifizieren`,
  `/mitglied-verifizieren`) - es gibt keine zweite Stelle, an der Rollen vergeben werden, damit
  Status in der DB und Rolle auf Discord nicht auseinanderlaufen koennen.
- `src/bot/ui/verificationMessage.ts` - baut das wiederverwendbare Embed+Button-Paar; die
  Button-`customId` (`verification:self-verify`) ist die einzige Kopplung zwischen UI und
  Event-Handler.
- `src/bot/events/guildMemberAdd.ts` - legt beim Beitritt den `Member`-Datensatz an und versucht
  eine Verifizierungs-DM. Ein DM-Fehlschlag (deaktivierte DMs) ist ein erwarteter Fall und wird
  nur mit `logger.info` protokolliert, nicht als Fehler behandelt - der Kanal-Button bleibt der
  garantierte Fallback.
- `src/bot/events/interactionCreate.ts` - wertet Button-Klicks mit der bekannten `customId` aus
  und ruft denselben Service wie die Slash-Commands auf. Die Fehlerbehandlung wurde dafuer von
  `ChatInputCommandInteraction`-spezifisch auf den generischen discord.js-Typ
  `RepliableInteraction` verallgemeinert, damit Buttons und Commands dieselbe Fehlerausgabe
  nutzen.
- Commands: `/setup-verifizierung` (ADMIN, konfiguriert Rolle + Kanal und postet die
  Verifizierungsnachricht), `/verifizieren` (EVERYONE, Selbst-Verifizierung),
  `/mitglied-verifizieren` (ADMIN, beliebigen Status fuer ein Mitglied setzen),
  `/verifizierung-status` (EVERYONE fuer den eigenen Status; fuer fremde Status wird `isServerAdmin()`
  direkt in der Command-Logik geprueft, da `PermissionLevel` nur eine globale Mindeststufe pro
  Command kennt, hier aber je nach Parameter unterschiedliche Stufen noetig sind).

Design-Entscheidungen:

- **Kein Schema-Update noetig.** `Member.verificationStatus`/`verifiedAt` waren bereits im
  Grundgeruest angelegt; die Verifizierung ist der erste Verbraucher dieser Felder.
- **Idempotenz.** `setMemberVerification()` vergleicht den Zielstatus zuerst mit dem
  gespeicherten Status; ist er identisch, passiert nichts (kein doppelter Rollen-Aufruf, kein
  doppelter Audit-Log-Eintrag). Dadurch ist z. B. ein zweiter Klick auf den Verifizierungs-Button
  gefahrlos.
- **Fehlerbehandlung an der Quelle uebersetzt.** Schlaegt `roles.add()`/`roles.remove()` mit dem
  Discord-Fehlercode `50013` (Missing Permissions) fehl - typischerweise weil die Bot-Rolle in der
  Rollenhierarchie zu niedrig steht -, wird das zentral im Service in eine verstaendliche
  `ValidationError` uebersetzt, statt als kryptischer `DiscordAPIError` bis zum Nutzer
  durchzureichen.
- **DM als Komfort, Kanal-Button als Garantie.** Da nicht jedes Mitglied DMs von Bots erlaubt,
  ist der persistente Button im konfigurierten Kanal der verlaessliche Weg; die DM ist eine
  zusaetzliche Erleichterung.

> **Bugfix bei dieser Gelegenheit gefunden:** `interactionCreate.ts` brach bei Button-Interaktionen
> bisher frueh ab, wenn `interaction.guild` fehlte (`if (!interaction.inGuild()) return;`). Das traf
> unbemerkt auch auf Klicks auf den Verifizierungs-Button **innerhalb der Beitritts-DM** zu - dort
> gibt es keinen Guild-Kontext, der Klick wurde also bisher stillschweigend ignoriert. Da das
> Onboarding direkt an eine erfolgreiche Verifizierung anknuepfen soll und unabhaengig vom Kanal
> (DM oder Server) zuverlaessig funktionieren muss, wurde das im Zuge dieser Arbeit behoben: Bei
> einer Interaktion ohne Guild-Kontext wird das `GuildMember` jetzt ueber
> `findGuildMemberAcrossGuilds()` (`src/bot/discordHelpers.ts`) durch Absuchen aller Server
> ermittelt, auf denen der Bot aktiv ist. Verifizierung und der komplette Onboarding-Fragebogen
> funktionieren dadurch jetzt korrekt auch vollstaendig innerhalb der DM.

### Dynamisches Onboarding

Startet automatisch nach erfolgreicher Selbst-Verifizierung und ist zusaetzlich jederzeit ueber
`/onboarding` erreichbar. Beteiligte Bausteine:

- `src/services/onboardingFlow.ts` - **reine, I/O-freie** Zustandsmaschine: Fragenreihenfolge,
  welche Frage als naechstes drankommt (`getNextQuestion()`), Ueberspring-Regel (IT_SKILLS und
  IT_BACKGROUND entfallen, wenn IT_EXPERIENCE = `KEINE` beantwortet wurde) und Validierung der
  eingehenden Werte gegen die pro Frage erlaubten Optionen (`validateAnswer()`, ueber Zod-Schemas
  aus `src/types/domain.ts`). Weil diese Datei kein Prisma und kein discord.js importiert, ist die
  komplette Verzweigungslogik ohne Datenbank oder Discord-Verbindung unit-testbar
  (`tests/onboardingFlow.test.ts`).
- `src/repositories/onboardingRepository.ts` - reiner Datenzugriff auf `OnboardingAnswer`.
  `recordAnswer()` haengt neue Antworten an (nichts wird geloescht oder ueberschrieben);
  `getLatestAnswers()` faltet die Historie zu "eine Antwort pro Frage, die zuletzt gegebene
  gewinnt" zusammen. Dadurch ist ein erneutes Ausfuellen (Redo) verlustfrei moeglich, ohne
  Loeschlogik oder einen zusaetzlichen Unique-Constraint zu brauchen.
- `src/services/onboardingService.ts` - Orchestrierung: `assertMemberVerified()` (Teilnahme nur
  fuer Mitglieder mit Status `VERIFIED`, bei jedem Aufruf neu geprueft statt einmalig),
  `getOnboardingState()` (Fortschritt lesen) und `submitAnswer()` (Antwort validieren, speichern,
  bei `IT_EXPERIENCE`/`INTERESTS` zusaetzlich auf `Member.itExperienceLevel`/`Member.interests`
  denormalisieren, bei Abschluss einen `member.onboarding_complete`-Audit-Log-Eintrag schreiben).
- `src/bot/ui/onboardingMessage.ts` - baut aus der reinen Flow-Konfiguration die discord.js-
  Select-Menus/Embeds/Buttons. `buildOnboardingMessageForState()` entscheidet rein anhand des
  Zustands, ob die naechste Frage oder die Abschluss-Zusammenfassung (mit "Erneut ausfuellen"-
  Button) gezeigt wird - ein einziger Rendering-Pfad fuer Fortsetzen, Neustart und die initiale
  Frage nach der Verifizierung.
- `src/bot/events/interactionCreate.ts` - neuer Zweig fuer `isStringSelectMenu()`-Interaktionen
  sowie fuer den Restart-Button; jede Antwort ruft `interaction.update()` auf dieselbe Nachricht
  auf (kein Nachrichten-Spam, ein durchgehendes Wizard-Erlebnis).
- `/onboarding` (EVERYONE, aber `assertMemberVerified()` weist unverifizierte Mitglieder mit einer
  klaren `PermissionError`-Meldung ab) - zeigt/setzt den Fragebogen fort.

Design-Entscheidungen:

- **Kein Schema-Update noetig.** `Member.itExperienceLevel`, `Member.interests` und
  `OnboardingAnswer` waren bereits im Grundgeruest fuer genau diesen Zweck angelegt.
- **Nur zwei Antworten werden denormalisiert.** `IT_SKILLS` (technische Kenntnisse) und
  `IT_BACKGROUND` (bisherige Taetigkeit) bekommen bewusst **keine** eigene Member-Spalte, da fuer
  sie aktuell keine konkrete Rollen-/Klassenlogik geplant ist, die einen eigenen Index braucht -
  sie bleiben vollstaendig ueber `OnboardingAnswer`/`getLatestAnswers()` verfuegbar. Sollte sich
  das aendern, ist eine zusaetzliche Spalte trivial nachruestbar, ohne die Erfassung selbst
  anzufassen.
- **Kategoriale Auswahl statt Freitext.** Alle vier Fragen sind Select-Menus mit fester
  Optionsliste - keine Freitextfelder, damit keine unnoetigen personenbezogenen Details (z. B.
  Namen von Arbeitgebern) erfasst werden koennen.
- **Serverseitige Validierung trotz kontrolliertem Client.** Obwohl die Select-Menu-Werte vom Bot
  selbst vorgegeben werden, validiert `validateAnswer()` trotzdem jede eingehende Antwort gegen
  die erlaubte Optionsmenge (Anzahl, bekannte Werte, keine Duplikate) - schuetzt vor manipulierten
  oder veralteten Interaktionen und wirft andernfalls eine `ValidationError`.
- **Abbruch- und Wiederholungssicherheit ohne eigenes Session-State.** Der Zustand ergibt sich
  jederzeit rein aus den gespeicherten Antworten (`getNextQuestion(getLatestAnswers(member))`).
  Ein Abbruch mitten im Fragebogen hinterlaesst keine Inkonsistenz - `/onboarding` setzt beim
  naechsten Aufruf einfach an der ersten noch unbeantworteten Frage fort. Ein bewusster Neustart
  (Button auf der Abschluss-Zusammenfassung) beantwortet die Fragen einfach erneut, ohne alte
  Antworten zu loeschen.
- **Fehler beim Onboarding-Rendering duerfen die Verifizierungsbestaetigung nicht gefaehrden.**
  `buildSafeOnboardingReplyPart()` faengt Fehler beim Laden des Onboarding-Zustands isoliert ab
  und loggt sie, statt die gesamte Antwort (inklusive der bereits erfolgreichen
  Verifizierungsbestaetigung) scheitern zu lassen.

## Sicherheitsueberlegungen

- Keine Zugangsdaten im Repository (`.env` ignoriert, nur `.env.example` mit Platzhaltern).
- Minimal noetige Discord-Intents (Principle of Least Privilege), Erweiterung erst bei Bedarf.
  `GuildMembers` (fuer `guildMemberAdd`) ist ein privilegierter Intent und muss im Discord
  Developer Portal separat aktiviert werden.
- Berechtigungsprüfung serverseitig zentral, nicht clientseitig/optimistisch.
- Docker-Image laeuft als Non-Root-User.
- Alle Nutzereingaben, die spaeter in Business-Logik einfliessen (Onboarding-Antworten,
  Interessen), werden ueber Zod-Schemas validiert, bevor sie persistiert werden.
- Rollenvergabe erfolgt ausschliesslich serverseitig ueber den Verification-Service; ein Nutzer
  kann sich nur die konkret konfigurierte Verifiziert-Rolle selbst zuweisen (Button/`/verifizieren`),
  nie eine beliebige Rolle.
- Onboarding erhebt bewusst **keine Freitextfelder** und keine sensiblen persoenlichen Daten -
  ausschliesslich Auswahl aus festen, kategorialen Optionslisten (siehe Onboarding-Abschnitt oben).
- Onboarding ist an den Verifizierungsstatus gekoppelt (`assertMemberVerified()`), nicht an eine
  einmalige Pruefung beim Start - ein zwischenzeitlicher Statuswechsel (z. B. Admin setzt ein
  Mitglied zurueck) sperrt den weiteren Fragebogen sofort beim naechsten Zugriff.

## Roadmap der Kernfunktionen

Die folgenden Funktionen sind der naechste Ausbauschritt auf Basis dieses Grundgeruests
(Reihenfolge orientiert sich an fachlichen Abhaengigkeiten):

1. ~~**Verifizierung neuer Mitglieder**~~ - **umgesetzt.** Siehe Abschnitt
   ["Verifizierung" im README](./README.md#verifizierung) fuer den Ablauf und
   "Implementierte Kernfunktionen" oben fuer die technischen Details.
2. ~~**Intelligentes Onboarding mit dynamischen Folgefragen**~~ - **umgesetzt.** Siehe Abschnitt
   ["Onboarding" im README](./README.md#onboarding) sowie "Dynamisches Onboarding" oben.
3. ~~**Erfassung IT-Erfahrung und Interessen**~~ - **umgesetzt**, Teil des Onboarding-Flows
   (`Member.itExperienceLevel`/`Member.interests`).
4. **Optionale Interessenrollen** - naechster logischer Schritt: Rollenvergabe basierend auf den
   jetzt erfassten `Member.interests`.
5. **Klassenzuweisung A/B/C** - nutzt `Class`/`Member.classId`.
6. **`#wo-bin-ich` mit Auswahl A/B/C** - Self-Service-Variante der Klassenzuweisung.
7. **Private Klassenbereiche** - Discord-Kategorien/Kanaele je `Class.categoryId`.
8. **Klassenleitung mit administrativen Rechten nur fuer die eigene Klasse** - baut auf dem
   bestehenden Berechtigungssystem auf (`isClassLeadOf`).
9. **Klausuren und Termine**
10. **Tages-/Wochenberichte**
11. **Berichtsheft**
12. **Lernmaterial**
13. **Voice-Lerngruppen** - benoetigt zusaetzlichen Intent (`GuildVoiceStates` ist bereits aktiviert).
14. **Moderation**
15. **Logging** - baut auf `AuditLogEntry` auf.
16. **Weitere Admin-Befehle**

Jede dieser Funktionen wird als eigener, in sich getesteter Arbeitsschritt umgesetzt, um das
Projekt durchgehend in einem lauffaehigen Zustand zu halten.
