# PROJECT_HANDOVER.md — COMCAVE Discord Bot

Vollständige technische und fachliche Übergabe. Stand: 2026-09-22, Branch `claude/great-albattani-q7cy9o`, Commit `b4f6b72`. Diese Datei ist so geschrieben, dass sie ohne vorherigen Chatverlauf verständlich ist.

**Methodik-Hinweis:** Alle Aussagen zu Repository-Code sind aus dem tatsächlichen Quellcode verifiziert (Stand dieses Commits). Aussagen zum **Discord-Live-Zustand** stammen ausschließlich aus vom Auftraggeber bereitgestellten Screenshots — Repo-Code ist **kein** Beweis für den tatsächlichen Discord-Zustand, das wird durchgehend unterschieden.

---

## 1. Projektziel & 2. Produktvision

Keine reine Discord-Bot-Spielerei, sondern eine digitale Lern-/Unterstützungsplattform für die COMCAVE-Umschulung zum/zur Fachinformatiker/in (Fachrichtungen Systemintegration/FISI und Anwendungsentwicklung/FIAE). Fachliches Zielmodell:

```
Ausbildungsplan → aktuelles Thema → Kursinhalt → Lernmaterial → Selbsttest
→ erkannte Schwäche → Wiederholung → historische Prüfungsrelevanz → individueller Lernfokus
```

Historische IHK-Prüfungen dienen als **Evidenz für Themenrelevanz**, nicht als Vorhersage künftiger Prüfungen. Weitere Produktbestandteile: Q&A, Lerngruppen, Projekte, Prüfungsvorbereitung, Lernfortschritt, Berichtsheft, organisatorische Unterstützung, wiederkehrende Lernimpulse.

**Aktueller Umsetzungsstand der Vision:** Der Onboarding-/Klassen-/Verwaltungsteil ist vollständig fachlich umgesetzt. Die eigentliche Lern-Pipeline (Kursinhalt → Lernmaterial → Selbsttest → Schwäche → Wiederholung → IHK-Relevanz → Lernfokus) existiert bisher nur in Teilen (Kursinhalte-Katalog, Lernmaterial, IHK-Analyse) — die **Verknüpfung** dieser Teile zu einem zusammenhängenden Lernfokus-Feature ist **noch nicht gebaut**.

---

## 3. Architektur & 4. Technische Komponenten

- **Sprache/Runtime:** TypeScript, Node.js, discord.js v14.
- **Datenhaltung:** Prisma ORM + SQLite (`prisma/schema.prisma`, 20 Modelle, 13 Migrationen).
- **Struktur:** `src/bot/commands/{admin,allgemein,klasse}` (Slash-Commands), `src/bot/events` (Discord-Events), `src/bot/ui` (Embed/Button/Modal-Baukästen), `src/services` (Fachlogik, 28 Dateien), `src/repositories` (DB-Zugriff), `src/permissions` (zentrale Berechtigungsprüfung), `src/utils` (Logger, Fehlerklassen).
- **customId-Konvention:** `domain:action:param` für Button-/Select-Routing in `interactionCreate.ts`.
- **Command-/Event-Loader:** dynamisch, liest alle `.ts`-Dateien aus den jeweiligen Ordnern zur Laufzeit ein (kein manuelles Registrieren nötig).
- **Konfiguration/Fail-Fast:** zentrale `GuildConfig` pro Discord-Server, alle sicherheitsrelevanten Guards werfen früh (`assert*`-Funktionen) statt später inkonsistente Zustände zuzulassen.
- **Fehlerbehandlung:** zentrale `AppError`-Hierarchie (`ValidationError`, `PermissionError`, …) mit einheitlichem `handleInteractionError()` in `interactionCreate.ts` (nutzerfreundliche Meldung, keine internen Details nach außen).
- **Logging:** `pino`-basierter Logger (`src/utils/logger.ts`), Child-Logger pro Service/Modul.
- **Tests:** `vitest`, echte SQLite-Testdatenbank pro Lauf (Integrationstests, keine reinen Mocks für DB-Zugriffe), 632 Tests zuletzt grün (Stand `b4f6b72`).
- **CI:** GitHub Actions (Lint, Format-Check, Typecheck, Test, Build).
- **Docker:** `Dockerfile` + `docker-compose` für produktiven Betrieb vorhanden.
- **Graceful Shutdown / Ready-Event:** `src/bot/events/ready.ts`, `error.ts` für unerwartete Client-Fehler.

---

## 5. Rollen

Alle Rollen werden zentral über `serverBootstrapService.ts` (`/setup-server`) angelegt und ihre IDs in `GuildConfig`/`Class` persistiert (keine hartkodierten IDs im Code).

| Rolle                                             | Zweck                                                    | Vergabe                                                                                           | Entzug                                                              | Berechtigungen (Discord)                                                                                                                                | Ausdrücklich NICHT                                                                                                                                  | Status                                               |
| ------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **@everyone**                                     | Basis                                                    | automatisch                                                                                       | nie                                                                 | nur `🔐-verifizierung` (PUBLIC) sichtbar/schreibbar                                                                                                     | kein Zugriff auf alle anderen Kategorien/Kanäle                                                                                                     | ✅                                                   |
| **Verifiziert**                                   | Schritt 1 abgeschlossen (Identität bestätigt)            | `verificationService.setMemberVerification()` nach Klick auf Verifizierungs-Button                | nicht vorgesehen (kein Entzugspfad im Code)                         | zusätzlich: `🏫 Schulhof` (lesen+schreiben)                                                                                                             | **nicht** die globale Serverstruktur (01–08); die ist an `onboardedRoleId` gebunden                                                                 | ✅ Code, ❓ Discord (s. Abschn. 6)                   |
| **Mitglied** (`onboardedRoleId`)                  | Gesamter Eintrittsflow abgeschlossen                     | `memberJourneyService.grantOnboardedRoleIfComplete()`, ausgelöst einzig nach Regelwerk-Zustimmung | kein automatischer Entzugspfad                                      | schaltet Kategorien 01 (außer Verifizierung)–07 frei (VERIFIED-Access, s. Abschn. 6/7)                                                                  | keine Administrator-Rechte                                                                                                                          | ✅ Code, ❓ Discord                                  |
| **Admin**                                         | Serververwaltung                                         | `/setup-admin-rollen` bzw. Bootstrap                                                              | manuell in Discord                                                  | voller Zugriff auf 08·INTERN, alle Klassenbereiche, alle Admin-Commands                                                                                 | Rolle darf laut Fail-Closed-Check **keine** Discord-„Administrator"-Berechtigung tragen (`roleHasAdministrator()`-Guard verhindert Bootstrap sonst) | ✅                                                   |
| **Moderator**                                     | Eingeschränkte Verwaltung                                | `/setup-admin-rollen` bzw. Bootstrap                                                              | manuell                                                             | Zugriff auf 08·INTERN (außer bestimmte Voice-Mod-Rechte in Klassenbereichen), Schreibrecht in globalen VERIFIED-Kanälen                                 | keine Administrator-Rechte                                                                                                                          | ✅                                                   |
| **Klasse A / B / C**                              | Zugehörigkeit zu einer Klasse                            | `classService.assignClass()` nach expliziter Klassenbestätigung                                   | nur Admin-Override `/mitglied-klasse-aendern` (`allowChange: true`) | Sichtbarkeit + Schreibrecht im jeweils **eigenen** privaten Klassenbereich (Kategorie „Klasse X"), inkl. Voice-Kanal                                    | **kein** Zugriff auf andere Klassenbereiche (separate Rolle pro Klasse, `Member.classId` ist Einzelwert)                                            | ✅ Code, ⚠️ **wird zu früh vergeben** (s. Abschn. 6) |
| **Klassenleitung A / B / C** (`Class.leadRoleId`) | klassenbezogene Administration ohne globale Admin-Rechte | `/setup-klassenleitung`                                                                           | `/entferne-klassenleitung`                                          | zusätzliche Schreib-/Verwaltungsrechte NUR im eigenen Klassenbereich (Prüfungen/Termine/Lernmaterial/Berichte anlegen, `assertClassManagementAccess()`) | keine Rechte in fremden Klassenbereichen, keine globalen Admin-Rechte                                                                               | ✅                                                   |
| **Bot-eigene Rolle**                              | technischer Träger für Bot-Permissions                   | automatisch von Discord bei Einladung                                                             | —                                                                   | eigener Allow-Overwrite in jeder verwalteten Kategorie/jedem Kanal (sonst würde `@everyone`-Deny den Bot selbst aussperren)                             | —                                                                                                                                                   | ✅                                                   |

Selbstständig identifiziert, keine weiteren Rollen im Code gefunden (Suche über `guildConfigRepository`, `classRepository`, `serverBootstrapService`).

---

## 6. Access-Gate / User Journey

**SOLL:**

```
Verifizierung → Profil/Name → Standort → Fachrichtung → Klasse → explizite Klassenbestätigung
→ Onboarding-Fragebogen → Regeln → Rolle „Mitglied"
```

Vor vollständigem Abschluss: **nur** 🏫 Schulhof + notwendiger Verifizierungskanal. Nach Abschluss: Mitglied + vollständiger Plattformzugriff + korrekter Klassenbereich.

**IST (Code, `memberJourneyService.ts` / `journeyFlow.ts`):** Guard-Kette exakt in dieser Reihenfolge implementiert (`JOURNEY_STEPS`: `NEEDS_VERIFICATION → NEEDS_PROFILE_DETAILS → NEEDS_LOCATION → NEEDS_FACHRICHTUNG → NEEDS_CLASS → NEEDS_ONBOARDING → NEEDS_RULES_ACCEPTANCE → COMPLETE`). Rolle „Mitglied" wird einzig nach Regelwerk-Zustimmung vergeben (`grantOnboardedRoleIfComplete()`, aufgerufen nur aus `handleRulesAcceptButton`). Der komplette Flow läuft per DM/ephemere Interaktionen (`buildSafeNextStepReplyPart()`), unabhängig von Kanalsichtbarkeit.

**Bekannte Abweichung vom Ziel (bestätigt im Code):** Die Klassenrolle wird bereits bei „Klasse bestätigen" (Schritt 6) vergeben (`assignClass()` → `addRoleOrThrow(targetClass.roleId)`), nicht erst nach Schritt 9. Zusätzlich prüft `checkPermission.assertClassReadAccess()` für alle klassenbezogenen Lesefunktionen (Prüfungen, Termine, Berichte, Kursplan) ausschließlich `ownClassId === klasse.id` — **ohne** zusätzliche Prüfung auf vollständiges Onboarding/„Mitglied". Ein Nutzer sieht und nutzt seinen privaten Klassenbereich also bereits vor Abschluss von Onboarding-Fragebogen und Regelwerk-Zustimmung.

**Schulhof:** an die Rolle „Verifiziert" gebunden (bewusst NICHT „Mitglied" — Kommentar in `serverBootstrapService.ts`), damit auch während der übrigen Schritte zugänglich. Auf dem realen Zielserver laut Screenshot aktuell **nicht vorhanden** (s. Abschn. 26 „bekannte Fehler").

**Klasse A/B/C → korrekter Bereich:** im Code korrekt getrennt — jede Klassenrolle hat eigene `@everyone`-Deny + rollenspezifische Allow-Overwrites (`classAreaService.buildOverwrites()`), keine Kreuz-Sichtbarkeit. Die Rolle „Mitglied" selbst hat **keinen** Zugriffs-Overwrite auf Klassenbereiche — bestätigt korrekt umgesetzt.

---

## 7. Verifizierung

- **Service:** `verificationService.ts` (`setMemberVerification()`, `assertMemberVerified()`).
- **Persistenter Button:** `verificationMessage.ts` (`VERIFY_BUTTON_CUSTOM_ID`), gepostet einmalig im `🔐-verifizierung`-Kanal via `ensureBotMessage()` (Duplikatschutz über customId-Scan der letzten Nachrichten).
- **Commands:** `/setup-verifizierung` (Admin, Kanal konfigurieren), `/verifizieren` (Member, Fallback ohne Button), `/verifizierung-status`, `/mitglied-verifizieren` (Admin, manuell für einzelnes Mitglied).
- **States:** `PENDING → VERIFIED` (`Member.verificationStatus`, `Member.verifiedAt`), `REJECTED` als drittes definiertes Vokabular (kein aktiver Ablehnungs-Command gefunden).
- **DM-Verhalten:** `guildMemberAdd.ts` sendet Willkommens-DM mit Verify-Button; `resolveInteractionMember()` löst DM-Interaktionen serverübergreifend auf (`findGuildMemberAcrossGuilds`).
- **Fehlerbehandlung:** Discord-Fehlercode 50013 (Missing Permissions) wird in verständliche `ValidationError` übersetzt statt Rohfehler zu zeigen (mehrfach im Code, u. a. `discordRoleSync.ts`).
- **Audit-Log:** Verifizierung wird geloggt (`logAuditEvent`, Action-Feld z. B. `verification.*`).

---

## 8. Onboarding (Fragebogen)

- **Service:** `onboardingService.ts` + `onboardingFlow.ts` (reine State Machine, UI getrennt).
- **Command:** `/onboarding` (Resume/Restart über `ONBOARDING_RESTART_CUSTOM_ID`).
- **Felder:** `Member.itExperienceLevel` (`KEINE|ANFAENGER|FORTGESCHRITTEN|ERFAHREN`), `Member.interests` (JSON-kodierte Liste), zusätzlich generische `OnboardingAnswer`-Tabelle (Frage/Antwort-Paare, erweiterbar für dynamisch hinzukommende Fragen).
- **UI:** ephemere Embeds + Select-Menus (`onboardingMessage.ts`), dynamisches Branching je nach vorheriger Antwort.
- **Guard-Kette:** erreichbar erst nach Verifizierung+Profil+Standort+Fachrichtung+Klasse (Reihenfolge in Abschn. 6).

---

## 9. Fachrichtung / Standort / Profil

- **Fachrichtung:** `fachrichtungService.ts`, zwei Werte (`SYSTEMINTEGRATION`, `ANWENDUNGSENTWICKLUNG`), einmalige Wahl, UI in `fachrichtungMessage.ts`.
- **Standort:** `memberProfileService.ts` + `locationRepository.ts`, Suche über `/standort-waehlen` bzw. Modal im Flow, Katalog aus `ComcaveLocation` (226 Einträge, s. Abschn. 13).
- **Profil:** Pflichtfelder Vorname/Nachname/Alter (`PROFILE_DETAILS_*`-Modal), `Member.profileCompletedAt` als Gate-Flag. `/mitglied-profil-bearbeiten` (Admin-Korrektur).
- **Nickname-Sync:** `discordNicknameSync.ts` setzt den Discord-Nickname nach Standortwahl automatisch (mit Fallback-Hinweis bei fehlender Berechtigung).
- **Datenschutz:** bewusst kein Geburtsdatum, nur Alter als Zahl (Datensparsamkeit, Code-Kommentar in `schema.prisma`).

---

## 10. Klassen

- **Rollen/Bereiche:** s. Abschn. 5/6.
- **`#wo-bin-ich`:** dauerhafte Übersicht (`classMessage.buildClassSelectionMessage()`), zeigt **nur bestätigte** Klassenzuordnungen (`getConfirmedClassOverview()`), 3 Spalten A/B/C, escaped gegen Markdown-Injection, gekürzt bei >15 Namen.
- **Zweistufige Bestätigung:** Klick auf Klasse → Bestätigungs-Screen (zeigt aktuelle Teilnehmer, persistiert nichts) → „Ja, das ist meine Klasse" → `assignClass()` persistiert. „Zurück" verwirft ohne Änderung.
- **Selbstständiger Wechsel:** nach Erstzuweisung **nicht** möglich für normale Mitglieder (Einmal-Sperre in `assignClass()`); nur `/mitglied-klasse-aendern` (Admin, `allowChange: true`).
- **Race-Condition-Schutz:** `memberRepository.claimFirstClassAssignment()` — atomarer Compare-and-Swap (`UPDATE ... WHERE classId IS NULL`), verhindert inkonsistente Doppelzuweisung bei gleichzeitigem Doppelklick.
- **Audit-Log:** `class.assign` / `class.change` / `class.help_requested`, nur nicht-personenbezogene Felder (`targetDiscordId`, Klassenname).
- **Class-scoped Permissions:** `assertClassManagementAccess()` (Admin/Klassenleitung) und `assertClassReadAccess()` (zusätzlich: eigenes `classId`) — zentral in `src/permissions/checkPermission.ts`, von allen klassenbezogenen Services (Prüfungen, Termine, Berichte, Kursplan, Lernmaterial) wiederverwendet.

---

## 11. Ausbildungsplan (Kursplan-Modul)

**Bereits strukturiert und implementiert — nicht offen.**

- **Quelle:** ein realer, vom Nutzer bereitgestellter Kursplan (Klasse A), versioniert unter `data/course-plans/`.
- **Umfang:** aktuell **ausschließlich Klasse A** hat echte Terminplan-Daten (Code-Kommentar: „aktuell nur Klasse A", `coursePlanImportService.ts`); B/C sind vorbereitet, aber ohne Datenquelle.
- **Modelle:** `CourseEntry` (Kursnummer, Zeitraum, Trainer), `CourseSpecialDay` (Sonderzeiträume/Ausnahmen), `CourseAcknowledgment` (Kenntnisnahme je Mitglied), `CourseUpcomingNotification` (Duplicate-Prevention für 7-Tage-Hinweis).
- **KW-Logik:** eigene `dateTime`-Utils (ISO-Kalenderwoche, Datumsvergleich) für „aktueller/nächster Kurs".
- **Benachrichtigung:** 7-Tage-Vorlauf-Hinweis, idempotent (kein Doppelversand dank `CourseUpcomingNotification`).
- **Zugriff:** `assertClassReadAccess()` (Mitglied der Klasse) bzw. `assertClassManagementAccess()` (Import: ADMIN-only, bewusst nicht Klassenleitung).
- **Commands:** `/kursplan`, `/kursplan-status`, `/kursplan-importieren`.
- **Tests:** eigener Testsatz vorhanden (u. a. Idempotenz-Test für wiederholten Import).

---

## 12. 592 Kursinhalte

**Bereits strukturiert — nicht offen.**

- **Quelle:** `kursinhalte.pdf` (eCampus-Extraktion), strukturiert abgelegt in `data/course-plans/kursinhalte.json` mit Feldern `sourceFile`, `sourceDescription`, `sourceScope`, `extractionNotes`, `courses`.
- **Umfang:** **34 Kurse, 592 Inhaltseinträge**, verifiziert über Test `courseContentImportService.test.ts` (`expect(summary.itemsCreated + summary.itemsUpdated).toBe(592)`).
- **Hierarchie:** ursprüngliche Nummerierung aus dem PDF erhalten, hierarchisch (Kurs → Inhalt → ggf. Unterpunkte).
- **Modell:** `CourseContentItem`, global (klassenunabhängiger Referenzkatalog, anders als das Kursplan-Modul).
- **Import:** `courseContentImportService.ts`, idempotent (zweiter Import erzeugt 0 neue Einträge, nur Updates), stabile IDs zur Wiedererkennung.
- **Zugriff im Bot:** `/kursinhalte`-Command, Kanal `📚-kursinhalte`.
- **Tests:** eigener Testsatz inkl. Hierarchie-, Zuordnungs- und Konsistenz-Checks.

---

## 13. 226 COMCAVE-Standorte

- **Modell:** `ComcaveLocation` (global, serverunabhängig — bewusste Trennung von der guild-gebundenen Zuordnung über `Member.locationId`).
- **Import:** `locationImportService.ts`, Quelle `data/locations/comcave-standorte.json`, **226** aktive Einträge (verifiziert per Direktprüfung der JSON-Datei in dieser Sitzung).
- **Idempotenz:** Import über stabilen `code`-Schlüssel, `isActive`-Flag statt Löschen (verhindert Zerstörung bestehender Mitgliederzuordnungen bei veralteten Standorten).
- **Commands:** `/setup-standorte-importieren`, `npm run standorte:import` (CLI).
- **Umgang mit unsicheren Daten:** nicht belastbare/mehrdeutige Einträge (fehlende/unklare PLZ) werden laut Code-Kommentar bewusst **nicht** übernommen statt geraten.

---

## 14. IHK-Prüfungen (Rohdaten)

- **Datei:** `IHK Prüfungen.zip`, 861 MB, im Repository über **Git-LFS** versioniert (Commit `642480a`, vom Auftraggeber selbst hinzugefügt).
- **Umfang:** 722 PDF-Dateien (Abschluss-/Zwischenprüfungen 1999–2024, inkl. Unterordner „IHK alt").
- **Rechtliche Einschränkung:** Original-Prüfungsinhalte dürfen **nicht** vervielfältigt oder als Discord-Inhalte veröffentlicht werden — bei dieser Übergabe wurden daher **nur** die abgeleiteten Analyseergebnisse (Klassifikation, Statistik, Taxonomie), **keine** Volltexte/PDFs, dauerhaft gesichert (s. Abschn. 15).
- **Nutzung im Bot:** aktuell **keine** — keine Verknüpfung zu Discord-Funktionen oder Lernmaterial.

---

## 15. Bereits durchgeführte IHK-Analyse

**Wurde tatsächlich bereits durchgeführt — nicht neu berechnet.**

| Schritt                            | Ergebnis                                                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| PDFs verarbeitet                   | 722                                                                                                                                |
| Systemintegration (FISI)           | 425                                                                                                                                |
| Anwendungsentwicklung (FIAE)       | 175                                                                                                                                |
| WISO                               | 16                                                                                                                                 |
| Kernqualifikationen (gemeinsam)    | 4                                                                                                                                  |
| Sonstige (andere Berufe/Referenz)  | 91                                                                                                                                 |
| Stufe 1: FISI historisch 1999–2024 | n=65, Jahre 1999–2022 abgedeckt (2006–2010 nur 0 auswertbare Dokumente — Stichprobenlücke durch Scan-Qualität, kein reales Muster) |
| Stufe 2: FISI AO2020               | n=9                                                                                                                                |
| Stufe 2: FIAE AO2020               | n=4                                                                                                                                |
| Stufe 2: WISO                      | n=16                                                                                                                               |
| Stufe 2: Kernqualifikationen       | n=4                                                                                                                                |

**Methodik:** `pdftotext`-Extraktion mit Plausibilitätsprüfung gegen verstümmelte OCR-Layer → Klassifikation nach Ordner-/Dateinamen-Mustern (`classify.py`) → Themen-Taxonomie als Regex-Keyword-Katalog (`taxonomy.py`, u. a. Netzwerktechnik/TCP-IP, WLAN, Active Directory, Virtualisierung, IT-Sicherheit, Datenschutz, Programmierung, Datenbanken, Arbeitsrecht, Wirtschaftskreislauf) → Themenhäufigkeit je Zeitraum (`run_topics.py`).

**Artefakt-Verfügbarkeit (geprüft in dieser Sitzung):**

| Artefakt                                                              | Status                                           | Aktion                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `classification.json` (Datei-→-Kategorie-Zuordnung)                   | ✅ noch im Scratchpad vorhanden                  | → nach `data/ihk-analysis/classification.json` gesichert                                                     |
| `topic_results.json` (Themenhäufigkeit je Stufe)                      | ✅ noch im Scratchpad vorhanden                  | → nach `data/ihk-analysis/topic_results.json` gesichert                                                      |
| `analysis_records.json` (Rohdatensätze je Dokument, Metadaten)        | ✅ noch im Scratchpad vorhanden                  | → nach `data/ihk-analysis/analysis_records.json` gesichert                                                   |
| `taxonomy.py` (Themenkatalog/Keywords)                                | ✅ vorhanden                                     | → nach `data/ihk-analysis/taxonomy.py` gesichert                                                             |
| `extract_usable.py`, `classify.py`, `run_topics.py` (Analyse-Skripte) | ✅ vorhanden                                     | → nach `data/ihk-analysis/scripts/` gesichert (Nachvollziehbarkeit)                                          |
| `extracted_text/*.txt` (Volltext je PDF)                              | ✅ noch vorhanden, **absichtlich nicht kopiert** | enthält Original-Prüfungstext → Vervielfältigungsverbot (Abschn. 14)                                         |
| 722 Original-PDFs                                                     | ✅ noch vorhanden, **absichtlich nicht kopiert** | dito                                                                                                         |
| `analysis_records.pkl` (Python-Pickle)                                | ✅ vorhanden, **nicht kopiert**                  | Binärformat ohne Mehrwert ggü. der `.json`-Fassung, potenzielles Sicherheitsrisiko (Pickle-Deserialisierung) |

**Wichtig:** Diese Sicherung erfolgte als reines Datei-Kopieren (keine Neuberechnung, keine erneute PDF-Verarbeitung). Die kopierten Dateien liegen im Arbeitsverzeichnis, wurden aber **nicht committet/gepusht** (siehe Auftrag, Abschn. 29 — Freigabe steht noch aus).

---

## 16. Lernmaterial / Prüfungsbezug / Review

- **Modell:** `LearningMaterial` (klassenbezogen, Kategorien, optionale URL/Anhang).
- **Reverse-Lookup:** Verknüpfung Lernmaterial ↔ Prüfung (`pruefungLernmaterial.ts`), damit von einer Prüfung aus passendes Material auffindbar ist und umgekehrt.
- **Zugriff:** Lesen für Klassenmitglieder (`assertClassReadAccess`), Verwalten für Admin/Klassenleitung (`assertClassManagementAccess`).
- **Audit-Log:** Erstellen/Bearbeiten/Löschen protokolliert.
- **Klassenisolierung:** wie bei allen klassenbezogenen Modellen strikt über `classId` + zentrale Guards.

---

## 17. Prüfungen / Termine

- **Modelle:** `Exam` (Fach/Thema, Beschreibung, Lernhinweise, Zeitpunkt), `Appointment` (allgemeine Termine).
- **Verwaltung:** Admin/Klassenleitung der jeweiligen Klasse (`assertClassManagementAccess`).
- **Leserechte:** Klassenmitglieder der jeweils eigenen Klasse (`assertClassReadAccess`) — andere Klassen strikt abgelehnt (fail-closed).
- **Audit:** alle Schreiboperationen geloggt inkl. `createdByDiscordId`.
- **Manipulationsschutz:** serverseitige Neuauflösung der Klasse/Berechtigung bei jeder Aktion, keine Vertrauensbasis auf Client-/customId-Daten.

---

## 18. Berichtsheft / Reports

- **Modelle:** `DailyReport`, `WeeklyReport` (klassenbezogen).
- **Commands:** `/tagesbericht-erstellen`, `-bearbeiten`, `-loeschen`, `/tagesberichte-anzeigen`, analog für Wochenberichte, `/berichtsheft-anzeigen` als Übersicht.
- **Zugriff:** wie andere klassenbezogene Systeme (Management vs. Read Access), Datengrundlage für das offizielle Berichtsheft der Ausbildung.

---

## 19. Study Groups (Lerngruppen)

- **Modelle:** `StudyGroup`, `StudyGroupMember`.
- **Commands:** erstellen, beitreten, verlassen, schließen, Mitglied entfernen, Status/Übersicht anzeigen.
- **Klassen-/Guild-Isolation:** Lerngruppen sind an eine Klasse gebunden, Mitgliedschaft geprüft über `assertClassReadAccess`-Analogon.
- **Voice-Kanal:** an den Klassen-Sprachkanal gekoppelt (kein separater Voice-Kanal je Lerngruppe).
- **Teilnehmerlimits:** im Service geprüft (Konstante im Code, verhindert unbegrenztes Wachstum).
- **Klassenleitungsrechte:** Moderation/Schließen auch durch Klassenleitung möglich.
- **Race-Condition-Schutz:** `addStudyGroupMember()` nutzt denselben DB-Unique-Constraint-Schutz wie die Klassenzuweisung (verifiziert per Test: zwei gleichzeitige Beitrittsversuche erzeugen nur eine Mitgliedschaft).

---

## 20. Regelwerk

- **Modelle:** `RuleSet` (versioniert), `RuleAcceptance` (Zustimmung je Mitglied + Version).
- **Commands:** `/regeln` (anzeigen), `/regelwerk-aktualisieren` (Admin, neue Version), `/regelwerk-status` (Zustimmungsquote).
- **Journey-Integration:** letzter Schritt vor Rolle „Mitglied" (s. Abschn. 6).
- **Verhalten bei neuer Version:** bestehende Zustimmungen gelten nur für die jeweilige Version — bei Aktualisierung muss erneut zugestimmt werden (`showRulesToMember()` löst immer die **aktuell aktive** Version auf, nie eine veraltete aus der customId).
- **Race-Condition-Schutz:** wie Klassenzuweisung/Lerngruppen über DB-Unique-Constraint abgesichert.

---

## 21. Weitere Systeme

- **Zentrales Permission-System:** `src/permissions/checkPermission.ts` (`hasPermissionLevel()` für Slash-Command-Mindeststufen, `assertClassManagementAccess()`, `assertClassReadAccess()`, `isServerAdmin()`, `isClassLeadOf()`) + `PermissionLevel`-Enum je Command.
- **Audit-System:** `auditLogRepository.ts`/`auditLogService.ts`, zentrale, konsistente Action-Strings, nie personenbezogene Klartextdaten in `metadata` (nur IDs/Namen von Entitäten wie Klassen).
- **`serverBootstrapService.ts`:** ein Befehl (`/setup-server`) für den kompletten Ersteinrichtungs-Vorgang (Rollen, globale Kanalstruktur, Klassenbereiche, persistente Nachrichten) — ersetzt mehrere frühere Einzel-Setup-Befehle, die als Fallback weiter existieren (`/setup-klassen`, `/setup-klassenbereiche`, `/setup-verifizierung`, `/setup-admin-rollen`, `/setup-klassenleitung`, `/setup-standorte-importieren`).
- **`globalServerStructureService.ts`:** deklaratives Blueprint-Modell (`STRUCTURE`-Array) für die 8 globalen Kategorien, erzeugt/aktualisiert Berechtigungen idempotent.
- **`classAreaService.ts`:** analoges Blueprint-Modell für private Klassenbereiche.
- **Journey-Dispatcher:** `journeyFlow.ts` (`buildSafeNextStepReplyPart()`) — **einzige** Stelle, die entscheidet, welcher UI-Schritt als Nächstes gezeigt wird (verhindert doppelte/inkonsistente Reihenfolge-Logik an mehreren Stellen).
- **`discordRoleSync.ts` / `discordNicknameSync.ts`:** gemeinsame Helfer für Rollenvergabe/-entzug bzw. Nickname-Setzung mit einheitlicher 50013-Fehlerbehandlung.

---

## 22. Reparaturen / Bugfixes (technische Verbesserungen, keine Produktfeatures)

Nicht einzeln als Produktaufgaben geführt, stecken aber im aktuellen, funktionierenden Code und dürfen **nicht** rückgängig gemacht werden. Beispiele aus der Commit-Historie: TypeScript-`exactOptionalPropertyTypes`-Fixes, CI-Formatierung/Testfixtures, Race-Condition-Fixes (Klassenzuweisung, Lerngruppen-Beitritt, Regelzustimmung, Kursplan-Kenntnisnahme — alle über atomare DB-Operationen statt Read-then-Write), diverse reale Discord-Permission-Overwrite-Fixes (Bot durch eigenes `@everyone`-Deny „blind", doppelte Rollen-IDs, Sprachkanal-Rechte auf Textkanälen, fehlende Bot-Berechtigung beim Kanal-Reparenting).

---

## 23. Tests

- Framework: `vitest`, echte SQLite-Testdatenbank je Lauf, 13 Migrationen automatisch angewendet.
- **632 Tests, zuletzt vollständig grün** (Stand Commit `b4f6b72`, protokolliert in dieser Session — in dieser Übergabe-Sitzung **nicht** erneut ausgeführt, um Kosten zu sparen).
- Race-Condition-Tests nutzen `Promise.allSettled()` mit zwei echten, parallelen Service-Aufrufen gegen dieselbe Test-DB (kein Mocking der Nebenläufigkeit).

## 24. CI

GitHub Actions: Lint (`eslint`), Format-Check (`prettier --check`), Typecheck (`tsc --noEmit`), vollständiger Testlauf, Build (`tsc -p tsconfig.json`).

## 25. Git-/Branch-Stand

- Repository `sikkkilaci/comcave-discord-bot`, **einziger** Arbeits-Branch `claude/great-albattani-q7cy9o` (kein `main`, daher keine Pull Requests — direkte Commits).
- 52 Commits insgesamt, aktueller HEAD `b4f6b72`.
- Zusätzlich vorhanden: Backup-Branch `backup-vor-onboarding-gate` (Stand vor dem großen Onboarding-Gate-Umbau).

---

## 26. Bekannte Abweichungen & 27. bekannte Fehler

1. **Klassenrolle zu früh vergeben** (s. Abschn. 6/10) — bestätigte Soll/Ist-Abweichung im Code.
2. **🏫 Schulhof fehlt auf dem realen Zielserver** trotz korrektem Code — wahrscheinlichste Ursache: laufender Bot-Prozess war beim letzten `/setup-server`-Lauf nicht auf aktuellem Commit-Stand (kein Code-Fehler, sondern Deploy-Stand-Problem; **nicht abschließend von hier aus beweisbar**, da kein Zugriff auf den laufenden Prozess).
3. **Kursplan nur für Klasse A** mit echten Daten — B/C strukturell vorbereitet, aber ohne Datenquelle.
4. Mehrere global angelegte Kanäle (s. Abschn. 28) sind reine, permissionierte Hüllen ohne Bot-Logik dahinter.

## 28. Fehlende Funktionen

Folgende Kanäle/Kategorien sind im Code strukturell angelegt (korrekte Berechtigungen), aber **ohne** eigene Bot-Funktion dahinter (nur generischer Text-/Voice-Kanal): `🎛️-lern-cockpit`, `🧪-selbsttests`, `📈-lernfortschritt` (als eigenständiges Tracking-Feature — Wochenbericht existiert separat), `🎓-prüfungs-cockpit`, `🎯-prüfungsvorbereitung`, `🔎-prüfungsfragen`, `❓-fragen-und-antworten`, `💬-austausch`, `🛠️-projekte`, `📌-wichtige-informationen`, `🧭-heute`. Ebenso `🆘-hilfe-gesucht` und `🛡️-moderation` (keine Ticket-/Moderations-Logik dahinter — bewusste Designentscheidung, dokumentiert in `ARCHITECTURE.md`).

Die größte inhaltliche Lücke zur Produktvision (Abschn. 1/2): **keine Verknüpfung** zwischen IHK-Themenanalyse, Kursinhalten und einem individuellen „Lernfokus"-Feature.

## 29. Architekturentscheidungen (wichtig, nicht versehentlich ändern)

- **Zwei-Rollen-Modell** „Verifiziert" (Schritt 1) vs. „Mitglied"/`onboardedRoleId` (voller Abschluss) ist bewusst — Namensgebung im Code ist etwas irreführend (`Access`-Typ-Literal `'VERIFIED'` in `globalServerStructureService.ts` bezieht sich tatsächlich auf `onboardedRoleId`, nicht `verifiedRoleId` — im Code ausführlich kommentiert).
- **Kein Administrator-Flag** auf verwalteten Rollen — bewusster Fail-Closed-Schutz, vor jedem Bootstrap geprüft.
- **`assertClassReadAccess`/`assertClassManagementAccess`** als einzige zentrale Klassenberechtigungsprüfung — nicht duplizieren, sondern wiederverwenden.
- **Atomare Compare-and-Swap-Idiome** (`updateMany` mit Bedingung bzw. DB-Unique-Constraint) sind der etablierte Umgang mit Race Conditions in diesem Projekt — bei neuen „Einmal-Aktionen" fortführen, nicht durch Read-then-Write ersetzen.

## 30. Nächste sinnvolle Schritte

Siehe `TASKS.md`.

## 31. Ausdrücklich NICHT zu verändernde Grundlagen

- Die Guard-Reihenfolge des Access-Gates (Abschn. 6).
- Das Zwei-Rollen-Modell Verifiziert/Mitglied.
- Die zentrale `assertClass*`-Berechtigungsprüfung (nicht durch Kanal-Sichtbarkeit allein ersetzen).
- Die Nicht-Vervielfältigung der IHK-Original-Prüfungsinhalte (PDFs/Volltexte) außerhalb der bereits versionierten Roh-ZIP.
- Bestehende, funktionierende Reparaturen/Fixes (Abschn. 22) — nicht zurückrollen.

## 32. Sonstige relevante Informationen für einen neuen Entwickler

- `ARCHITECTURE.md` und `README.md` im Repository-Root enthalten ergänzende, bereits gepflegte Dokumentation zu einzelnen Subsystemen — diese Übergabe ersetzt sie nicht, sondern bündelt den Gesamtstand.
- Für jede Discord-seitige Aussage gilt: **vor** einer Aussage „ist auf Discord sichtbar/nutzbar" den echten Server prüfen (Screenshot/Live-Check), niemals aus Repo-Code ableiten.
- `docs/DISCORD_STRUCTURE.html` (in dieser Übergabe erstellt) enthält die vollständige Rollen-/Kanal-/Berechtigungsmatrix als eigenständige, offline lesbare Datei.
