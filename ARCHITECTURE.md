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
- `OnboardingAnswer`: Freie Frage/Antwort-Paare fuer dynamische Onboarding-Folgefragen.
- `Class`: Klasse (A/B/C) mit zugehoeriger Rolle, privatem Kategorie-Channel und
  Klassenleitungs-Rolle.
- `AuditLogEntry`: Generisches Audit-Log fuer administrative Aktionen/Moderation.

SQLite unterstuetzt in Prisma keine nativen Enums; Statuswerte (z. B. Verifizierungsstatus) werden
daher als String-Spalten mit Validierung in `src/types/domain.ts` (Zod) gefuehrt.

## Sicherheitsueberlegungen

- Keine Zugangsdaten im Repository (`.env` ignoriert, nur `.env.example` mit Platzhaltern).
- Minimal noetige Discord-Intents (Principle of Least Privilege), Erweiterung erst bei Bedarf.
- Berechtigungsprüfung serverseitig zentral, nicht clientseitig/optimistisch.
- Docker-Image laeuft als Non-Root-User.
- Alle Nutzereingaben, die spaeter in Business-Logik einfliessen (Onboarding-Antworten,
  Interessen), werden ueber Zod-Schemas validiert, bevor sie persistiert werden.

## Roadmap der Kernfunktionen

Die folgenden Funktionen sind der naechste Ausbauschritt auf Basis dieses Grundgeruests
(Reihenfolge orientiert sich an fachlichen Abhaengigkeiten):

1. **Verifizierung neuer Mitglieder** - Grundlage fuer alles Weitere (Rollenvergabe erst nach
   Verifizierung).
2. **Intelligentes Onboarding mit dynamischen Folgefragen** - nutzt `OnboardingAnswer`.
3. **Erfassung IT-Erfahrung und Interessen** - Teil des Onboarding-Flows.
4. **Optionale Interessenrollen** - Rollenvergabe basierend auf erfassten Interessen.
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
