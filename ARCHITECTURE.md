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

## UI-Konventionen: Emojis

Embeds, Buttons und Command-Beschreibungen verwenden gezielt Standard-Unicode-Emojis, um die
Bedienung uebersichtlicher zu machen, ohne den professionellen COMCAVE-/IT-Look zu verlieren.
Faustregeln:

- **Ein Emoji pro Titel/Button reicht.** Kein Emoji-Stapeln in einer Zeile oder pro Auswahloption
  in Select-Menus (`IT_SKILL_LABELS`, `INTEREST_LABELS` etc. bleiben bewusst emoji-frei, sonst
  wirken die Fragebogen-Dropdowns schnell ueberladen).
- **Wiedererkennbares Symbol je Themenbereich:** 🔐 Verifizierung, 🧑‍💻 Onboarding/IT-Werdegang,
  🖥️ technische Kenntnisse, 💼 bisherige Taetigkeit, 📚 Lern-/IT-Interessen, 🏫 Klassenbereich/
  `#wo-bin-ich`. Fuer die drei Klassen bewusst humorvollere, aber eindeutige Buchstaben-Emojis
  (🅰️/🅱️/🆑 in `CLASS_NAME_LABELS`, `src/types/domain.ts`) statt eines generischen Symbols.
- **Zentral in Labels/Konfiguration, nicht dupliziert.** `CLASS_NAME_LABELS` traegt das Emoji
  direkt im Anzeigetext, wodurch Buttons, #wo-bin-ich-Footer und Bestaetigungstexte
  (`interactionCreate.ts`, `/setup-klassen`) es automatisch mitbekommen - keine zweite Emoji-Zuordnung
  parallel pflegen.
- **Neue Fachbereiche** (Hilfe 🆘, Sprachkanal 🔊 - siehe Roadmap) erhalten ihr Emoji, sobald die
  zugehoerige UI tatsaechlich existiert; es wird nichts vorab in Commands/Embeds eingebaut, die es
  noch nicht gibt. Bereits umgesetzt: Klassenleitung 👑 (`/setup-klassenleitung`,
  `/entferne-klassenleitung`), Pruefungen 🎓 und Termine 📅 (alle `/pruefung-*`/`/termin-*`-Befehle
  und ihre Embeds), Berichtsheft 📝, Tagesbericht 📋 und Kalenderwoche/Zeitraum 📅 (alle
  `/tagesbericht-*`/`/wochenbericht-*`/`/berichtsheft-*`-Befehle; Lerninhalte werden innerhalb der
  Embeds zusaetzlich mit 📚 markiert), sowie Lernmaterial 📚 (alle `/lernmaterial-*`-Befehle und ihr
  Embed) mit kategoriespezifischen Emojis in den Kategorie-Labels selbst (🖥️/🌐/💻/🗄️/🔐/🎓, siehe
  `LEARNING_MATERIAL_CATEGORY_LABELS` in `src/types/domain.ts`).

## Datenmodell (aktueller Stand)

- `GuildConfig`: Konfiguration pro Server (Rollen-IDs, Kanal-IDs). Wird lazy per
  `getOrCreateGuildConfig()` angelegt, keine manuelle Ersteinrichtung noetig.
- `Member`: Verknuepfung Discord-Nutzer <-> Verifizierungsstatus, IT-Erfahrung, Interessen,
  Klassenzuordnung sowie Pflicht-Teilnehmerprofil (`firstName`/`lastName`/`age`/`locationId`/
  `profileCompletedAt`, siehe "Teilnehmerprofil, COMCAVE-Standorte und Serverregeln" unten).
- `ComcaveLocation`: Katalog der COMCAVE-Kurs-/Niederlassungsstandorte. Bewusst **global**, nicht
  guild-gescoped (ein Standort ist ein realer, serverunabhaengiger Fakt) - `isActive` statt Loeschen,
  damit eine `Member.locationId`-Zuordnung nie durch einen entfernten Standort zerstoert wird.
- `OnboardingAnswer`: Frage/Antwort-Paare fuer die dynamischen Onboarding-Folgefragen
  (append-only Historie, siehe Onboarding-Abschnitt unten).
- `Class`: Klasse (A/B/C) mit zugehoeriger Rolle (`roleId`), privatem Kategorie-Channel
  (`categoryId`) und den sieben Kanal-IDs des privaten Klassenbereichs
  (`chatChannelId`/`announcementChannelId`/`scheduleChannelId`/`examChannelId`/
  `reportChannelId`/`materialChannelId`/`voiceChannelId`, siehe "Private Klassenbereiche"
  unten) sowie der Klassenleitung: `leadRoleId` (Discord-Rolle, wird bei Bedarf automatisch
  angelegt) und `leadDiscordId` (Discord-ID der aktuell zugewiesenen Person, siehe
  "Klassenleitung" unten).
- `Exam`: Pruefung einer Klasse (Fach/Thema, Beschreibung, optionale Lernhinweise, Zeitpunkt),
  verknuepft mit `Class` und `GuildConfig`, siehe "Pruefungen und Termine" unten.
- `Appointment`: Termin einer Klasse (Titel, Beschreibung, Zeitpunkt) - strukturell wie `Exam`,
  aber ein eigenes Modell statt eines gemeinsamen mit Nullable-Feldern, da sich die Pflichtfelder
  unterscheiden (Fach/Lernhinweise vs. reiner Titel).
- `DailyReport`: Tagesbericht einer Klasse (Datum, Themen, Lerninhalte, Hinweise, optionale
  Lernmaterialien) - Berichtsheft-Grundlage, siehe "Pruefungen und Termine" analoger Abschnitt
  "Berichtsheft, Tages- und Wochenberichte" unten.
- `WeeklyReport`: Wochenbericht einer Klasse (Jahr, Kalenderwoche, Zeitraum, Themen,
  Lernfortschritt, Hinweise) - ebenfalls Berichtsheft-Grundlage.
- `LearningMaterial`: Lernmaterial einer Klasse (Titel, Beschreibung, Fach/Thema, Kategorie,
  optionale URL/Discord-Anhang-Metadaten, optionale Verknuepfung mit einer Pruefung/einem Bericht
  derselben Klasse), siehe "Lernmaterial" unten.
- `AuditLogEntry`: Generisches Audit-Log fuer administrative Aktionen/Moderation.
- `CourseEntry`/`CourseSpecialDay`: Kursplan-Eintraege einer Klasse (Kursnummer, Titel, Dozent,
  Zeitraum bzw. Feiertag/unterrichtsfreie Zeit), importiert aus einer versionierten Quelldatei.
  `CourseAcknowledgment`: Kenntnisnahme eines Mitglieds fuer einen Kurs-Slot.
  `CourseUpcomingNotification`: Marker fuer bereits gesendete 7-Tage-Hinweise. Siehe "Kursplan"
  unten.
- `CourseContentItem`: Katalog der Kursinhalte je Kursnummer, bewusst GLOBAL wie `ComcaveLocation`
  (nicht guild-/klassen-gescoped) und nur lose ueber `courseNumber` mit `CourseEntry` verknuepft
  (kein FK). Siehe "Kursinhalte" unten.
- `StudyGroup`: temporaere Lerngruppe einer Klasse (Name, Ersteller, aktiv/geschlossen, optionales
  Teilnehmerlimit). `StudyGroupMember`: Mitgliedschaft eines Discord-Nutzers in einer Gruppe. Siehe
  "Lerngruppen" unten.
- `RuleSet`: eine Version des Serverregelwerks (guild-gescoped, unveraenderlich - eine
  Aktualisierung legt immer eine neue Zeile mit fortlaufender `version` an). `RuleAcceptance`:
  Zustimmungsstatus eines Mitglieds zu EINER Version (`shownAt`/`acceptedAt`). Siehe
  "Teilnehmerprofil, COMCAVE-Standorte und Serverregeln" unten.

SQLite unterstuetzt in Prisma keine nativen Enums; Statuswerte (z. B. Verifizierungsstatus) werden
daher als String-Spalten mit Validierung in `src/types/domain.ts` (Zod) gefuehrt.

> **Migration `add_class_area_channels`:** Die sieben Kanal-Felder auf `Class` sind die einzige
> Schema-Aenderung seit dem Grundgeruest, die tatsaechlich neue Spalten braucht (rein additiv,
> nullable, keine Datenmigration noetig). Begruendung: `categoryId` existierte zwar bereits, aber
> ohne die IDs der einzelnen Kanaele darin muesste jede zukuenftige Funktion, die auf einen
> bestimmten Kanal verweisen will (z. B. ein spaeteres `/berichtsheft`-Command), diesen per
> Namenssuche in der Kategorie wiederfinden - fragil, sobald ein Kanal umbenannt wird. Die IDs
> direkt und flach auf `Class` zu speichern (statt eines eigenen Nebenmodells fuer eine feste,
> nicht-dynamische 1:1-Menge von sieben Kanaelen) entspricht dem bereits etablierten Stil von
> `roleId`/`categoryId`/`leadRoleId`.

> **Migration `add_class_lead_assignment`:** Ergaenzt `Class.leadDiscordId` (nullable, plus Index
> auf `guildId, leadDiscordId`) - rein additiv, keine Datenmigration. Begruendung: `leadRoleId`
> speichert nur, welche _Rolle_ Klassenleitung ist, nicht _wer_ sie aktuell traegt. Ohne ein
> eigenes Feld muesste jede Neuzuweisung/Entfernung die Rollenmitgliedschaft live aus dem
> Discord-Cache lesen (`role.members`), was fehlschlaegt, sobald die Person nicht (mehr) im Cache
> ist, und keine serverseitige Abfrage "leitet diese Person bereits eine andere Klasse?" erlaubt.
> `leadDiscordId` macht Zuweisung/Wechsel/Entfernung robust und DB-basiert, analog zu
> `Member.classId` fuer die normale Klassenzugehoerigkeit.

> **Migration `add_exams_and_appointments`:** Fuegt die neuen Modelle `Exam` und `Appointment`
> hinzu (je mit `guildId`/`classId`-Fremdschluesseln, Index auf `guildId, classId, scheduledAt`
> fuer die chronologisch sortierte Listenabfrage) - echte neue Tabellen statt einer Erweiterung
> von `Class`, da es sich um eine 1:n-Beziehung (mehrere Pruefungen/Termine pro Klasse) statt
> flacher Einzelwerte handelt. Zwei getrennte Modelle statt eines gemeinsamen "ClassEvent" mit
> Typ-Diskriminator, weil sich die Pflichtfelder unterscheiden (Pruefung: Fach/Thema + optionale
> Lernhinweise; Termin: nur Titel) und ein gemeinsames Modell entweder Nullable-Felder fuer die
> jeweils nicht zutreffende Variante gebraucht haette oder eine JSON-Spalte - beides unnoetig
> komplex fuer zwei feste, einfache Formen.

> **Migration `add_daily_and_weekly_reports`:** Fuegt die neuen Modelle `DailyReport` und
> `WeeklyReport` hinzu (je mit `guildId`/`classId`-Fremdschluesseln), analog zu
> `add_exams_and_appointments` rein additiv. Kein drittes "Berichtsheft"-Modell: Ein Berichtsheft
> ist begrifflich die Sammlung aller Tages- und Wochenberichte einer Klasse, keine eigene
> Datenkategorie - eine zusaetzliche Tabelle wuerde entweder die Daten duplizieren oder nur als
> Fremdschluessel-Sammlung auf die beiden anderen Tabellen verweisen, ohne eigenen Wert zu
> schaffen (siehe `berichtsheftService.ts` im Abschnitt "Berichtsheft, Tages- und Wochenberichte"
> unten, der genau diese kombinierte Sicht stattdessen zur Laufzeit erzeugt). `WeeklyReport.year`
> wird serverseitig aus `periodStart` abgeleitet (kein eigenes Eingabefeld), damit Jahr und
> Zeitraum nie widerspruechlich gespeichert werden koennen.

> **Migration `add_learning_materials`:** Fuegt das neue Modell `LearningMaterial` hinzu (mit
> `guildId`/`classId`-Fremdschluesseln, Index auf `guildId, classId, category`) - rein additiv.
> Die optionale Verknuepfung mit einer Pruefung oder einem Bericht (`linkedType`/`linkedId`) ist
> bewusst **kein** DB-Fremdschluessel: eine Verknuepfung kann auf drei verschiedene Zieltabellen
> (`Exam`, `DailyReport`, `WeeklyReport`) zeigen, was in Prisma nur ueber drei getrennte,
> gleichzeitig vorhandene Nullable-Fremdschluessel-Spalten abgebildet werden koennte (polymorphe
> Relationen werden nicht nativ unterstuetzt) - das haette drei zusaetzliche Rueckwaerts-Relationen
> auf `Exam`/`DailyReport`/`WeeklyReport` erfordert, nur um ein optionales "Nice-to-have"-Feature
> zu stuetzen. Stattdessen speichert `LearningMaterial` Typ und ID als einfache String-Spalten;
> Existenz und Klassenzugehoerigkeit werden serverseitig in `learningMaterialService.ts` geprueft
> (siehe Design-Entscheidungen im Abschnitt "Lernmaterial" unten) - konsistent mit dem Rest der
> Architektur, die Geschaeftsregeln grundsaetzlich in der Service-Schicht durchsetzt, nicht per
> DB-Constraint.

> **Migration `add_course_plan`:** Fuegt `CourseEntry`, `CourseSpecialDay`, `CourseAcknowledgment`
> und `CourseUpcomingNotification` hinzu (alle mit `guildId`/`classId`-Fremdschluesseln, analog zu
> `add_learning_materials`) - rein additiv. `CourseEntry` traegt einen zusammengesetzten Unique-Key
> `[classId, courseNumber, startDate]` fuer einen idempotenten Import (siehe "Kursplan" unten) statt
> einer generierten ID als einzigem Identifikator - so kann ein wiederholter Import denselben
> Kurs-Slot zuverlaessig wiedererkennen. `CourseUpcomingNotification.courseEntryId` ist zusaetzlich
> `@unique` (nicht nur Teil eines zusammengesetzten Keys), da hier maximal eine Benachrichtigung pro
> Kurs jemals existieren darf - das Schema selbst verhindert Duplikate, unabhaengig von der
> Abfragelogik.

> **Migration `add_study_groups`:** Fuegt `StudyGroup` und `StudyGroupMember` hinzu (mit
> `guildId`/`classId`-Fremdschluesseln, analog zu `add_course_plan`) - rein additiv. `StudyGroup`
> nutzt `isActive`/`closedAt`/`closedByDiscordId` statt eines `DELETE` beim Schliessen, damit
> geschlossene Gruppen fuer Audit/Nachvollziehbarkeit erhalten bleiben - dieselbe Ueberlegung wie bei
> `Class.leadDiscordId`, das beim Entfernen einer Klassenleitung ebenfalls nicht geloescht,
> sondern auf `null` gesetzt wird. `StudyGroupMember` traegt `@@unique([studyGroupId,
memberDiscordId])`, damit ein wiederholter Beitrittsversuch nie zu einer doppelten Mitgliedschaft
> fuehren kann.

> **Migration `add_member_profile_and_locations`:** Fuegt `ComcaveLocation` sowie
> `firstName`/`lastName`/`age`/`locationId`/`profileCompletedAt` auf `Member` hinzu - rein additiv,
> alle Felder nullable (bestehende Mitglieder ohne Profil bleiben gueltig, `profileCompletedAt:
null` ist das Gate-Flag fuer `assertProfileComplete()`). `ComcaveLocation` bewusst als eigenes,
> globales Modell statt einer Erweiterung von `GuildConfig`/`Class`, da ein Standort keinerlei
> Guild-Bezug hat (siehe Datenmodell-Hinweis oben) und perspektivisch 300+ Eintraege umfassen soll -
> eine Freitext-Spalte auf `Member` haette weder Idempotenz beim Import noch eine sinnvolle
> Autocomplete-Suche erlaubt.

> **Migration `add_rules_and_acceptance`:** Fuegt `RuleSet` und `RuleAcceptance` hinzu (analog zu
> `add_course_plan`/`add_study_groups` rein additiv). `RuleSet` traegt `@@unique([guildId, version])`
> statt eines einzelnen Freitextfelds auf `GuildConfig`, damit historische Versionen erhalten
> bleiben (eine bereits erteilte Zustimmung muss auch nach einem Update nachvollziehbar bleiben,
> wozu die damalige Version unveraendert vorliegen muss). `RuleAcceptance.acceptedAt` ist nullable
> und getrennt von `shownAt`, weil beide Zeitpunkte unabhaengig auftreten koennen (angezeigt, aber
> noch nicht zugestimmt) - ein einzelnes Boolean-Feld haette diese Unterscheidung nicht abgebildet.
> `@@unique([memberDiscordId, ruleSetId])` verhindert doppelte Zustimmungen zur selben Version und
> sorgt zugleich dafuer, dass eine neue Version automatisch keine Zustimmungszeile besitzt - genau
> der Mechanismus, der eine erneute Zustimmung nach einem Regelwerk-Update erzwingt, ganz ohne
> Zusatzlogik.

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

### Teilnehmerprofil, COMCAVE-Standorte und Serverregeln

Zwischen Verifizierung und Onboarding eingefuegter Pflichtblock: Vorname/Nachname/Alter +
COMCAVE-Standort (`src/services/memberProfileService.ts`, `src/repositories/locationRepository.ts`)
sowie Zustimmung zu den aktuellen Serverregeln (`src/services/ruleService.ts`). Ablauf:

1. Nach der Verifizierung zeigt der Bot einen Button "Angaben machen", der ein Discord-**Modal**
   mit drei Textfeldern (Vorname, Nachname, Alter) oeffnet (`buildProfileDetailsModal()` in
   `src/bot/ui/profileMessage.ts`). Modals unterstuetzen keine Select-/Autocomplete-Komponenten,
   daher der Standort als separater, zweiter Schritt.
2. `/standort-waehlen standort:<Suche>` nutzt eine Command-Option mit `.setAutocomplete(true)`
   statt eines festen Select-Menus (Discords Hartlimit: 25 Optionen, hier aber perspektivisch
   300+ Standorte) - ein neuer `AutocompleteInteraction`-Handler in `interactionCreate.ts`
   durchsucht `ComcaveLocation` per Teilstring auf Name/Stadt/PLZ.
3. Sobald beides vorliegt, setzt `completeProfileAndSetNickname()` `profileCompletedAt` und
   synchronisiert den **Server-Nickname** (`GuildMember.setNickname()`, niemals den globalen
   Discord-Benutzernamen) ueber `src/services/discordNicknameSync.ts`.
4. Danach zeigt der Bot die aktuelle Regelversion (`RuleSet`) mit einem
   Zustimmungs-Button - erst nach explizitem Klick ("Ich stimme den Regeln zu") gilt der Schritt
   als erledigt.

**Zentraler Dispatcher statt verstreuter Reihenfolge-Logik:**
`src/services/memberJourneyService.ts::resolveNextJourneyStep()` ist die EINZIGE Stelle, die die
Schrittreihenfolge kennt (`NEEDS_VERIFICATION` → `NEEDS_PROFILE_DETAILS` → `NEEDS_LOCATION` →
`NEEDS_RULES_ACCEPTANCE` → `NEEDS_ONBOARDING` → `COMPLETE`). `src/bot/journeyFlow.ts` rendert dazu
die passende Nachricht und wird von drei Stellen aus aufgerufen (nach Verify-Klick, nach
Standortwahl, nach Regelzustimmung) - dieselbe Continuation-Stelle, die zuvor nur ins Onboarding
sprang, ruft jetzt zuerst diesen Dispatcher.

**Reihenfolge Verifizierung vs. Regelzustimmung (explizit abgewogen):** Verifizierung bleibt
technisch der erste Schritt, obwohl inhaltlich naheliegend waere, zuerst zustimmen zu lassen. Grund:
Es gibt genau EINEN bestehenden Einstiegspunkt nach dem Server-Beitritt (die Verify-DM,
`handleVerifyButton()`); Profil und Regeln haengen sich additiv an diesen an, statt einen zweiten,
parallelen Einstiegspunkt VOR der Verifizierung neu zu bauen (haette `guildMemberAdd.ts` und die
initiale DM selbst veraendert - ein Eingriff in eine bereits funktionierende, getestete Komponente
statt einer reinen Erweiterung). Sicherheitsrelevant ist das nicht: der eigentlich schuetzenswerte
Bereich (private Klassenkanaele) wird ohnehin erst durch die Klassenrolle nach `/wo-bin-ich`
freigeschaltet, und `assignClass()` liegt hinter `assertProfileComplete()` UND
`assertRulesAccepted()` - unabhaengig von der Reihenfolge relativ zur Verifizierung.

**Umgehungsschutz:** `assertProfileComplete()` und `assertRulesAccepted()` folgen demselben Muster
wie `assertMemberVerified()` - beide werden bei JEDEM Zugriff frisch geprueft (in
`onboardingService.ts` und `classService.ts` zusaetzlich zur bestehenden Verifizierungspruefung
eingebaut), nicht nur einmalig beim ersten Kontakt. Ein direkter `/onboarding`-Aufruf oder ein
Klick auf "Onboarding neu starten" vor Abschluss von Profil/Regeln wird dadurch fail-closed
abgelehnt, unabhaengig vom gewaehlten Weg dorthin.

**COMCAVE-Standorte als eigener, globaler Katalog:** `ComcaveLocation` ist bewusst NICHT
guild-gescoped (siehe Datenmodell-Abschnitt oben) und wird ueber eine versionierte Quelldatei
(`data/locations/comcave-standorte.json`, Format in `data/locations/README.md`) importiert -
idempotent per stabilem `code` (`upsertLocation()`), mit automatischer Deaktivierung (nicht
Loeschung) fehlender Eintraege bei einem erneuten Import. Die Quelldatei enthaelt einen verifizierten
Teilbestand von 226 echten, ausschliesslich von `comcave.de/standorte` stammenden Standorten (Stadt +
Bundesland, teils PLZ) - keine erfundenen Adressen/PLZ/Namen und keine Daten aus Drittquellen (siehe
`data/locations/README.md` fuer Quelle, Stand und Grenzen der Abdeckung). Das Schema traegt dem mit
einem eigenen Pflichtfeld `state` (Bundesland) und einem optionalen `postalCode` Rechnung, da nicht
fuer jeden offiziell bestaetigten Standort eine PLZ oeffentlich verifizierbar war.

**Regelwerk-Versionierung statt In-Place-Aenderung:** `RuleSet` wird nie nachtraeglich editiert -
`/regelwerk-aktualisieren` legt immer eine neue Version an und deaktiviert dabei atomar (in einer
Prisma-Transaktion) die vorige. Das haelt jede historische Zustimmung korrekt einer konkreten,
unveraenderten Fassung zugeordnet und erzwingt nebenbei automatisch eine erneute Zustimmung nach
einem Update (die neue `RuleSet.id` hat zwangslaeufig noch keine `RuleAcceptance`-Zeile).

**Datenschutz/Datensparsamkeit:** Alter wird als reine Zahl gespeichert, nie als Geburtsdatum.
Audit-Log-Metadaten (`member.profile_details_set`, `member.location_set`,
`member.profile_completed`, `member.profile_updated_by_admin`, `rules.version_created`,
`rules.accepted`) enthalten ausschliesslich Feldnamen/Versionsnummern, nie die eigentlichen Werte
(Name, Alter, Standortname, Regeltext) - konsistent mit der bereits etablierten Zurueckhaltung bei
`class.change` (nur Klassennamen, keine Freitexte). Der zugeordnete Standort ist standardmaessig
nur fuer Admins sichtbar (`/mitglied-profil-bearbeiten` liest ihn, `/wo-bin-ich` zeigt ihn nicht).

**Korrektur nur administrativ:** `/mitglied-profil-bearbeiten` (ADMIN-only) ist der einzige Weg,
bereits erfasste Angaben zu aendern - bewusst nicht selbstbedienbar fuer das Mitglied selbst
(verhindert z. B. wiederholtes, unkontrolliertes Aendern des Alters), analog zur bestehenden
Zurueckhaltung bei `/mitglied-verifizieren`.

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

### Klassenzuweisung A/B/C

`#wo-bin-ich` als zentrale, dauerhafte Klassenauswahl - per Button, echte Discord-Rollen statt
einer reinen DB-Markierung. Beteiligte Bausteine:

- `src/services/discordRoleSync.ts` - aus der Verifizierung herausgeloeste, jetzt gemeinsam
  genutzte Rollen-Helfer (`addRoleOrThrow`/`removeRoleOrThrow`) inkl. Uebersetzung von
  Discord-Fehlercode `50013` in eine verstaendliche `ValidationError`. `verificationService.ts`
  wurde im Zuge dessen auf diese Helfer umgestellt (Verhalten unveraendert, per Tests
  abgesichert) - eine neue Rollenvergabe-Stelle (kuenftig z. B. Interessenrollen) muss diese
  Uebersetzung nicht erneut implementieren.
- `assertMemberVerified()` wurde von `onboardingService.ts` nach `verificationService.ts`
  verschoben (dort thematisch beheimatet) und wird von dort re-exportiert, damit bestehender
  Code ohne Anpassung weiterlaeuft. `classService.ts` importiert es kanonisch von dort - **eine**
  Stelle definiert "was heisst verifiziert sein", genutzt von Onboarding und Klassenauswahl gleichermassen.
- `src/repositories/classRepository.ts` - reiner Datenzugriff auf `Class` (anlegen, Rolle setzen,
  nach Name suchen, auflisten).
- `src/repositories/memberRepository.ts` - erweitert um `getMemberWithClass()` (Member inkl.
  `class`-Relation) und `setMemberClass()`. Da `Member.classId` ein Einzelfeld ist (keine Liste),
  erzwingt bereits das Datenmodell "eine Klasse gleichzeitig".
- `src/services/classService.ts::assignClass()` - die eigentliche Geschaeftslogik, analog zu
  `setMemberVerification()` aufgebaut: prueft Verifizierung, laedt Zielklasse (muss existieren
  und eine Rolle haben, sonst `ValidationError`), entfernt bei einem Wechsel zuerst die alte
  Rolle, vergibt dann die neue, aktualisiert `Member.classId` und schreibt einen Audit-Log-
  Eintrag (`class.assign` bei Erstzuweisung, `class.change` bei einem Wechsel, Metadaten
  `{ from, to }`). Prueft Discord-Rollenbesitz **und** DB-Zustand unabhaengig voneinander und
  gleicht beides ab (self-healing), falls sie z. B. durch eine manuelle Rollenaenderung auf
  Discord auseinanderlaufen sollten.
- `src/bot/ui/classMessage.ts` - Embed + ein Button je Klasse; die aktuelle Klasse wird per
  Button-Style (`Success` statt `Secondary`) hervorgehoben. Ein Rendering-Pfad fuer die
  dauerhafte Kanal-Nachricht, `/wo-bin-ich` und den Zustand nach einem Wechsel.
- `src/bot/events/interactionCreate.ts` - neuer Zweig fuer `class:select:*`-Buttons. Unterscheidet
  anhand von `interaction.message.flags.has(MessageFlags.Ephemeral)`, ob die Original-Nachricht
  die **dauerhafte, oeffentliche** Kanal-Nachricht ist (bleibt fuer alle unveraendert, nur eine
  private Bestaetigung) oder die **persoenliche, ephemere** `/wo-bin-ich`-Antwort (darf sicher
  per `interaction.update()` aktualisiert werden, da nur der klickende Nutzer sie sieht) - eine
  einzelne geteilte Nachricht darf niemals den "aktuelle Klasse"-Zustand eines einzelnen Klicks
  fuer alle anderen Betrachter ueberschreiben.
- Commands: `/setup-klassen` (ADMIN; drei Rollen + Kanal, lehnt doppelt verwendete Rollen und
  Rollen mit Administrator-Berechtigung ab), `/wo-bin-ich` (EVERYONE, aber `getCurrentClassName()`
  weist unverifizierte Mitglieder ab).

Design-Entscheidungen:

- **Kein Schema-Update noetig.** `Class` (inkl. `roleId`, `categoryId`, `leadRoleId`) und
  `Member.classId` waren bereits im Grundgeruest fuer genau diesen Zweck angelegt.
- **Echte Discord-Rolle statt DB-Flag.** Die Klassenzugehoerigkeit wird ueber
  `member.roles.add()`/`.remove()` durchgesetzt, nicht nur in der Datenbank vermerkt - nur so
  greifen spaeter Kanal-Berechtigungen fuer private Klassenbereiche tatsaechlich.
- **Keine Administrator-Rollen als Klassenrollen.** `roleHasAdministrator()`
  (`src/bot/discordHelpers.ts`) prueft das bei `/setup-klassen` explizit, inklusive der
  discord.js-Eigenheit, dass eine Rolle aus einer Interaktion typseitig entweder ein volles
  `Role`-Objekt (`PermissionsBitField`) oder ein rohes `APIRole` (String-Bitfeld) sein kann.
- **Klassenleitung war zum Zeitpunkt dieser Iteration noch nicht implementiert, aber bereits
  vorbereitet** (siehe Abschnitt "Klassenleitung" unten fuer die inzwischen umgesetzte Version).
  Das bestehende Berechtigungssystem (`PermissionLevel.KLASSENLEITUNG`, `isClassLeadOf()`) und das
  Datenfeld `Class.leadRoleId` deckten bereits ab, dass eine kuenftige Klassenleitung nur ihre
  _eigene_ Klasse verwalten darf; `assignClass()` und die Commands dieser Iteration vergaben oder
  nutzten `leadRoleId` noch nicht.
- **Oeffentliche Nachricht bleibt neutral.** Siehe `interactionCreate.ts`-Punkt oben - verhindert,
  dass Klick A den fuer Klick B sichtbaren Zustand der geteilten Kanal-Nachricht verfaelscht.

### Private Klassenbereiche

Jede Klasse bekommt eine eigene, fuer `@everyone` unsichtbare Kategorie mit sieben Kanaelen -
durchgesetzt ueber echte Discord-Permission-Overwrites, nicht nur durch Kanal-Anordnung oder
Konvention. Beteiligte Bausteine:

- `src/services/classAreaService.ts::setupClassArea()` - legt die Kategorie und die sieben
  Kanaele an (`CHANNEL_BLUEPRINTS`: Klassenchat, Ankuendigungen, Termine, Pruefungen,
  Berichtsheft, Lernmaterial, Sprachkanal). Kategorie **und** jeder einzelne Kanal werden
  unabhaengig voneinander per `guild.channels.fetch()` auf Idempotenz geprueft - ein erneuter
  Aufruf legt nichts doppelt an und repariert nur fehlende/geloeschte Kanaele einzeln nach,
  ohne bestehende anzufassen (dieselbe "erneuter Aufruf ist sicher"-Philosophie wie bei
  Verifizierung/Onboarding/Klassenauswahl).
- `buildOverwrites()` baut fuer Kategorie und jeden Kanal denselben Basissatz an Overwrites:
  `@everyone` verliert `ViewChannel`; die Klassenrolle bekommt `ViewChannel`/`ReadMessageHistory`/
  `Connect`/`Speak` und (ausser im Ankuendigungen-Kanal) `SendMessages`/`AttachFiles`/
  `EmbedLinks`; die konfigurierte Admin-Rolle (`GuildConfig.adminRoleId`) bekommt volle
  Sichtbarkeit; eine bereits gesetzte Klassenleitungs-Rolle (`Class.leadRoleId`) bekommt
  zusaetzlich `ManageMessages` - **auch im Ankuendigungen-Kanal**, da bei einem Konflikt
  zwischen zwei Rollen-Overwrites (Klassenrolle denied SendMessages, Klassenleitung erlaubt es)
  Discord den Allow-Overwrite gewinnen laesst.
- `createChannelOrThrow()` uebersetzt Discord-Fehlercode `50013` (fehlende "Kanaele verwalten"-
  Berechtigung) in eine verstaendliche `ValidationError`, nach demselben Muster wie
  `discordRoleSync.ts`.
- Command: `/setup-klassenbereiche` (ADMIN, optionaler `klasse`-Parameter fuer nur eine Klasse)
  - ueberspringt Klassen ohne konfigurierte Rolle mit einem klaren Hinweis auf `/setup-klassen`,
    fasst Ergebnis pro Klasse in einer Zeile zusammen (neu angelegt / repariert / bereits
    vollstaendig) und schreibt einen `class.area_setup`-Audit-Log-Eintrag pro tatsaechlich
    veraenderter Klasse.

Design-Entscheidungen:

- **Schema-Erweiterung bewusst und minimal.** Siehe Migrations-Hinweis im Datenmodell-Abschnitt
  oben - sieben neue nullable Spalten, keine neue Tabelle, keine Datenmigration.
- **Nur "Ankuendigungen" ist read-only fuer die Klasse.** Alle anderen Kanaele (auch
  Lernmaterial und Pruefungen) bleiben voll beschreibbar, weil z. B. das Berichtsheft von den
  Mitgliedern selbst befuellt wird und die Anforderung keine weitere Differenzierung vorgibt.
  Admins koennen einzelne Kanal-Berechtigungen bei Bedarf manuell in Discord nachjustieren.
- **Kanal-/Kategorienamen bewusst ohne Emoji.** Anders als Buttons/Embeds (siehe
  "UI-Konventionen: Emojis" oben) bleiben Kanalnamen reiner ASCII-Text, um jedes Risiko von
  Sonderzeichen-Normalisierungsproblemen bei der Discord-API zu vermeiden, die ohne echten
  Token/Server-Verbindung nicht verifizierbar waeren.
- **Klassenleitung war zu diesem Zeitpunkt weiterhin vorbereitet, nicht abgeschlossen** (siehe
  "Klassenleitung" unten fuer die inzwischen umgesetzte Version). `buildOverwrites()` las
  `Class.leadRoleId` bereits mit, aber es gab noch kein Setup-Command, das diese Rolle setzt.

### Klassenleitung

Klassenbezogene Administration: eine Klassenleitung verwaltet ausschliesslich ihre eigene Klasse
und erhaelt dabei zu keinem Zeitpunkt globale Server-Rechte. Beteiligte Bausteine:

- `src/permissions/checkPermission.ts::assertClassManagementAccess()` - die zentrale,
  wiederverwendbare Zugriffspruefung fuer **jede** klassenbezogene Verwaltungsaktion: erlaubt ist
  ein globaler Admin (`isServerAdmin()`) oder die Klassenleitung genau der betroffenen Klasse
  (`isClassLeadOf()`), sonst wird eine `PermissionError` geworfen. Sie nimmt bewusst ein
  minimales `{ name, leadRoleId }`-Objekt entgegen statt einer Klassen-ID, damit auch eine noch
  gar nicht existierende Klasse (`leadRoleId: null`) sicher abgelehnt wird ("Fail closed") -
  jede kuenftige klassenbezogene Funktion (Termine, Berichtsheft, Lernmaterial, Tagesberichte,
  Klassenmoderation, siehe Roadmap) soll dieselbe Funktion verwenden, statt eine eigene Pruefung
  danebenzubauen.
- `src/repositories/classRepository.ts::updateClassLead()`/`getClassLedByMember()` - persistiert
  `leadRoleId`/`leadDiscordId` und findet die Klasse, die eine bestimmte Person aktuell leitet
  (fuer die "eine Person leitet nur eine Klasse gleichzeitig"-Regel bei einer Neuzuweisung).
- `src/services/classLeadService.ts` - die eigentliche Geschaeftslogik:
  - `assignClassLead()`: laedt die Zielklasse (muss bereits eine Klassenrolle haben, sonst
    `ValidationError`), legt bei Bedarf per `ensureLeadRole()` eine neue Klassenleitungs-Rolle an
    (**immer** mit `permissions: []` - keine Basis-Berechtigung) oder heilt eine in Discord
    geloeschte Rolle selbst (dieselbe Idempotenz-/Selbstheilungs-Philosophie wie
    `classAreaService.ts`), prueft **fail-closed**, dass eine wiederverwendete bestehende Rolle
    keine Administrator-Berechtigung traegt (`assertRoleHasNoAdministrator()` - Schutz gegen eine
    nachtraeglich manuell in Discord geaenderte Rolle), loest eine bestehende
    Klassenleitungszuweisung derselben Person an einer **anderen** Klasse sauber auf
    (`getClassLedByMember()` + `releaseClassLead()`), ersetzt eine bestehende Klassenleitung
    **derselben** Klasse, vergibt die Rolle und schreibt `class.lead_assign`
    (Erstzuweisung) bzw. `class.lead_change` (Ersetzung/Wechsel) ins Audit-Log.
  - `removeClassLead()`: entzieht der aktuell zugewiesenen Person die Rolle und loescht
    `leadDiscordId` (die Rolle selbst bleibt fuer eine spaetere Wiederverwendung bestehen),
    schreibt `class.lead_remove`. Idempotent (`changed: false`, kein Audit-Log-Eintrag), wenn
    die Klasse ohnehin keine zugewiesene Klassenleitung hatte.
  - Beide Funktionen bereinigen den DB-Zustand auch dann, wenn die betroffene Person nicht mehr
    ueber `guild.members.fetch()` auffindbar ist (z. B. hat den Server verlassen) - kein
    Discord-Fehler blockiert die Datenkonsistenz.
- `src/services/classAreaService.ts::CLASS_LEAD_CHANNEL_PERMISSIONS` - der vollstaendige,
  ausschliesslich als Kanal-Overwrite vergebene Rechtekatalog der Klassenleitung (siehe
  Design-Entscheidungen unten fuer die genaue Liste und die bewussten Ausschluesse).
- Commands: `/setup-klassenleitung klasse:<A|B|C> mitglied:<@Person>` (ADMIN) und
  `/entferne-klassenleitung klasse:<A|B|C>` (ADMIN) delegieren direkt an `classLeadService.ts`.
  Zusaetzlich wurde `/setup-klassenbereiche` von `PermissionLevel.ADMIN` auf
  `PermissionLevel.KLASSENLEITUNG` herabgestuft: eine Klassenleitung darf den Befehl jetzt fuer
  ihre eigene Klasse ausfuehren (Admins weiterhin fuer alle). Die eigentliche Einschraenkung "nur
  die eigene Klasse" erfolgt dabei **nicht** ueber die globale `PermissionLevel`-Stufe (die
  pruefte immer nur "irgendeine Klassenleitung"), sondern zusaetzlich pro angefragter Klasse in
  der Command-Schleife ueber `assertClassManagementAccess()` - das ist das konkrete Beispiel
  dafuer, wie kuenftige klassenbezogene Commands die zentrale Pruefung nutzen sollen.

Design-Entscheidungen:

- **Schema-Erweiterung minimal und begruendet.** Ein neues Feld (`Class.leadDiscordId`), siehe
  Migrations-Hinweis im Datenmodell-Abschnitt oben.
- **Rolle traegt nie Basis-Berechtigungen.** `guild.roles.create({ permissions: [] })` - die
  Klassenleitungs-Rolle ist in Discords Rollenuebersicht sichtbar als Rolle "ohne Berechtigungen".
  Jedes tatsaechliche Recht kommt ausschliesslich aus Kanal-/Kategorie-Overwrites innerhalb der
  eigenen Klasse (`CLASS_LEAD_CHANNEL_PERMISSIONS` in `classAreaService.ts`), niemals aus der
  Rolle selbst. Das ist der zentrale technische Unterschied zu einer "nur durch UI-Pruefung
  simulierten" Einschraenkung, wie in der Anforderung explizit gefordert.
- **`CLASS_LEAD_CHANNEL_PERMISSIONS` im Detail:** `ViewChannel`, `SendMessages`,
  `ReadMessageHistory`, `ManageMessages` (bearbeiten eigener Nachrichten braucht keine
  Berechtigung; loeschen/anheften fremder Nachrichten schon), `AttachFiles`, `EmbedLinks`,
  `CreatePublicThreads`/`CreatePrivateThreads`/`SendMessagesInThreads`/`ManageThreads`,
  `MentionEveryone` (fuer "eigene Klassenrolle erwaehnen" - als Kanal-Overwrite ungefaehrlich,
  da nur in den eigenen Klassenkanaelen wirksam), `Connect`/`Speak`/`MuteMembers`/`DeafenMembers`/
  `MoveMembers` (Sprachkanal-Moderation - die Text-Kanal-Bits dieser Liste sind dort einfach
  wirkungslos, analog zur bereits bestehenden Klassenrollen-Logik), `ModerateMembers` (Timeout -
  wirkt nur auf Mitglieder, die ueberhaupt in den privaten Klassenkanaelen sichtbar sind, also
  ausschliesslich die eigene Klasse).
- **Bewusst ausgeschlossen, permanent.** `Administrator`, `ManageGuild`, `ManageRoles`,
  `ManageChannels`, `ManageWebhooks`, `KickMembers`, `BanMembers` erscheinen an **keiner** Stelle
  im Code fuer die Klassenleitungs-Rolle - weder als Rollen-Basisrecht noch als Overwrite.
- **Discords native "Server-Events" bewusst nicht verwendet.** Die Anforderung "Termine/Events
  verwalten" wird **nicht** ueber Discords `ManageEvents`-Berechtigung abgebildet, da sich diese
  in Discord nicht auf eine einzelne Klasse beschraenken laesst (waere zwangslaeufig serverweit) -
  stattdessen bekommt die Klassenleitung volle Nachrichtenkontrolle im dedizierten
  Termine-Kanal (`scheduleChannelId`). Eine Fail-closed-Entscheidung: lieber ein Feature bewusst
  einschraenken als ein serverweites Recht vergeben.
- **Eine Person leitet immer nur eine Klasse.** Analog zur bestehenden
  "ein Mitglied gehoert nur einer Klasse an"-Regel (`Member.classId`) entfernt `assignClassLead()`
  automatisch eine bestehende Klassenleitungszuweisung derselben Person an einer anderen Klasse,
  bevor die neue vergeben wird.
- **Rolle bleibt bei Entfernung erhalten.** `removeClassLead()` loescht nur `leadDiscordId`, nicht
  `leadRoleId` - eine spaetere Neuzuweisung muss die Rolle nicht neu anlegen (weniger
  Rollen-Muell in Discord, gleiche Kanal-Overwrites bleiben gueltig).
- **Fail-closed bei Manipulation.** `assertClassManagementAccess()` prueft ausschliesslich anhand
  der tatsaechlichen Rollenmitgliedschaft (`member.roles.cache.has(klasse.leadRoleId)`) - ein
  manipulierter `klasse`-Parameter in `/setup-klassenbereiche` (z. B. Klassenleitung A versucht
  `klasse:B`) fuehrt zu einer `PermissionError`, unabhaengig davon, ob Klasse B ueberhaupt
  existiert. Explizit mit der geforderten Testmatrix abgedeckt (A→A erlaubt, A→B/C verweigert,
  B→A/C→A verweigert, siehe `tests/permissions.test.ts`).

### Pruefungen und Termine

Die erste klassenbezogene Fachfunktion auf Basis der Klassenleitungs-Architektur (siehe Roadmap-
Punkt 12 "Kuenftige klassenbezogene Funktionen"). Beteiligte Bausteine:

- `src/utils/dateTime.ts::parseGermanDateTime()`/`formatGermanDateTime()` - reine, I/O-freie
  Parsing-/Formatierungsfunktion fuer die Eingabeform "Datum (TT.MM.JJJJ) + Uhrzeit (HH:MM)" aus
  zwei getrennten Slash-Command-Optionen. Prueft zusaetzlich zur Formatpruefung, dass das Datum
  tatsaechlich existiert (JS' `Date`-Konstruktor rollt sonst z. B. den 30. Februar stillschweigend
  auf den 2. Maerz um) - wirft andernfalls eine `ValidationError`. Von beiden Services
  (Pruefungen, Termine) gemeinsam genutzt, damit Datums-/Zeitvalidierung nicht zweimal
  unterschiedlich implementiert wird.
- `src/permissions/checkPermission.ts::assertClassReadAccess()` - neue, zur bestehenden
  `assertClassManagementAccess()` analoge Funktion fuer **Lesezugriff**: erlaubt sind dieselben
  Admin-/Klassenleitung-Primitiven (`isServerAdmin()`/`isClassLeadOf()`) plus zusaetzlich ein
  Mitglied, dessen `Member.classId` der angefragten Klasse entspricht. Bewusst keine zweite,
  parallele Permission-Logik - nur eine zusaetzliche erlaubte Bedingung neben denselben Admin-/
  Klassenleitung-Pruefungen.
- `src/repositories/examRepository.ts`/`appointmentRepository.ts` - reiner Datenzugriff. Jede
  Einzelabfrage nach ID (`getExamById()`/`getAppointmentById()`) ist **immer** zusaetzlich nach
  `guildId` gescoped, damit eine ID nie serveruebergreifend Daten preisgeben kann.
- `src/repositories/classRepository.ts::getClassById()` (neu) - laedt eine Klasse ueber ihre ID,
  ebenfalls immer nach `guildId` gescoped. Zentraler Baustein fuer den Manipulationsschutz: beim
  Bearbeiten/Loeschen wird darueber die **tatsaechliche** Klasse einer Pruefung/eines Termins
  aufgeloest (`exam.classId`/`appointment.classId`), nie ein vom Aufrufer behaupteter Klassenname.
- `src/services/examService.ts`/`appointmentService.ts` - je vier Funktionen
  (`create*ForClass()`, `update*ForClass()`, `delete*ForClass()`, `list*ForClass()`), bewusst als
  zwei getrennte, aber strukturell parallele Services statt einer generischen Abstraktion (siehe
  Datenmodell-Abschnitt oben fuer die Modell-Begruendung). `create`/`update`/`delete` rufen
  `assertClassManagementAccess()` mit der ueber die Klasse (create) bzw. den geladenen Datensatz
  (update/delete) aufgeloesten Klasse auf - **das** ist der Manipulationsschutz aus Anforderung 7:
  eine Klassenleitung kann durch Angabe einer fremden Pruefungs-/Termin-ID niemals auf eine andere
  Klasse zugreifen, weil die Berechtigungspruefung nie dem Aufrufer glaubt, welcher Klasse eine ID
  angeblich gehoert. `list*ForClass()` ruft stattdessen `assertClassReadAccess()` auf und loest
  ohne explizite Klassenangabe die eigene Klasse des Aufrufers auf (`Member.classId`).
- `src/bot/ui/classEventMessage.ts` - Embed-Builder fuer die `*-anzeigen`-Befehle
  (`buildExamListEmbed()`/`buildAppointmentListEmbed()`), sortiert chronologisch (naechster
  Termin zuerst), inkl. der jeweiligen ID pro Eintrag (fuer die anschliessende Bearbeitung/
  Loeschung per ID - siehe Design-Entscheidungen unten).
- Commands (`src/bot/commands/klasse/`, neue Kategorie fuer klasseninterne Fachfunktionen):
  `/pruefung-erstellen`, `/pruefung-bearbeiten`, `/pruefung-loeschen` (alle KLASSENLEITUNG),
  `/pruefungen-anzeigen` (VERIFIED) sowie die analogen vier `/termin-*`-Befehle.

Design-Entscheidungen:

- **Zwei neue Tabellen, sauber begruendet und migriert.** Siehe Migrations-Hinweis im
  Datenmodell-Abschnitt oben.
- **Identifikation ueber ID statt interaktivem Auswahl-Menu.** Da Discord-Slash-Commands keinen
  Optionstyp fuer "beliebiger Datensatz aus einer dynamischen Liste" kennen, zeigt
  `*-anzeigen` die ID jeder Pruefung/jedes Termins an, die dann in `*-bearbeiten`/`*-loeschen` als
  String-Parameter angegeben wird - derselbe pragmatische Ansatz wie viele etablierte Discord-Bots
  (z. B. Warn-/Ticket-Systeme). Ein interaktives Auswahl-Menu (Select-Menu/Buttons) waere
  komfortabler, aber fuer diesen ersten Ausbauschritt bewusst nicht Teil des Umfangs.
- **Keine automatische Kanal-Benachrichtigung.** Erstellen/Aendern/Loeschen postet aktuell nichts
  automatisch in den jeweiligen Pruefungen-/Termine-Kanal (`examChannelId`/`scheduleChannelId`) -
  nur eine ephemere Bestaetigung an die ausfuehrende Person. Das war nicht Teil der Anforderung;
  eine spaetere Erweiterung koennte das ergaenzen, ohne die Service-Schicht anzufassen.
  Verwaltungspersonen taggen sich dafuer eine Zusammenfassung manuell im Kanal an.
- **Datum und Uhrzeit als zwei getrennte Optionen statt einer kombinierten.** Entspricht der
  Anforderungsformulierung ("Datum und Uhrzeit") und ist in der Discord-Oberflaeche als zwei
  kurze Textfelder komfortabler auszufuellen. Beim Bearbeiten muessen beide gemeinsam angegeben
  werden, wenn der Zeitpunkt geaendert werden soll (sonst `ValidationError`) - vermeidet die
  Mehrdeutigkeit, welchen Teil ein alleinstehendes `datum` oder `uhrzeit` eigentlich aendern soll.
- **Lesezugriff bewusst per Datenbankzustand, nicht per Kanal-Sichtbarkeit geloest.**
  `assertClassReadAccess()` prueft `Member.classId`, nicht ob die Person Zugriff auf
  `examChannelId`/`scheduleChannelId` hat - konsistent mit dem Rest der Architektur, die
  Berechtigungen immer ueber die Datenbank/Discord-Rollen und nicht ueber Kanal-Overwrites prueft
  (Kanal-Overwrites sichern zusaetzlich auf Discord-Ebene ab, sind aber nicht die Quelle der
  Wahrheit fuer die Bot-Logik).

### Berichtsheft, Tages- und Wochenberichte

Zweite klassenbezogene Fachfunktion, strukturell identisch zu "Pruefungen und Termine" aufgebaut -
derselbe Architektur-Baustein wird hier nur ein weiteres Mal angewendet. Beteiligte Bausteine:

- `src/utils/dateTime.ts::parseGermanDate()`/`formatGermanDate()` (neu) - Datum ohne Uhrzeit
  (`TT.MM.JJJJ`), fuer Tagesbericht-Datum und Wochenbericht-Zeitraum. Intern refaktoriert:
  `parseGermanDateTime()` und `parseGermanDate()` teilen sich jetzt dieselbe
  Komponenten-Parsing-/Existenzpruefung (`parseDateComponents()`/`assertRealDate()`), damit die
  "existiert dieses Datum wirklich"-Logik nicht zweimal unterschiedlich implementiert ist.
- `src/repositories/dailyReportRepository.ts`/`weeklyReportRepository.ts` - reiner Datenzugriff,
  nach demselben Muster wie `examRepository.ts`/`appointmentRepository.ts`: jede Einzelabfrage
  nach ID ist immer zusaetzlich nach `guildId` gescoped.
- `src/services/dailyReportService.ts`/`weeklyReportService.ts` - je vier Funktionen
  (`create*ForClass()`, `update*ForClass()`, `delete*ForClass()`, `list*ForClass()`), 1:1 nach dem
  bei Pruefungen/Terminen etablierten Muster: `assertClassManagementAccess()` fuer
  Verwaltungsaktionen (Klasse beim Bearbeiten/Loeschen immer aus dem gespeicherten Datensatz
  aufgeloest, nie aus einem Aufrufer-Parameter), `assertClassReadAccess()` fuer die
  `list*ForClass()`-Funktionen. `weeklyReportService.ts` validiert zusaetzlich die Kalenderwoche
  (ganzzahlig, 1-53) und den Zeitraum (Ende darf nicht vor dem Beginn liegen), bevor gespeichert
  wird.
- `src/services/berichtsheftService.ts::getBerichtsheftForClass()` (neu) - kombiniert Tages- und
  Wochenberichte einer Klasse zu einer einzigen, chronologisch sortierten `BerichtsheftEntry[]`-
  Liste. Ruft dafuer ausschliesslich `listDailyReportsForClass()`/`listWeeklyReportsForClass()`
  auf (die bereits eigenstaendig `assertClassReadAccess()` durchsetzen) und fuegt **keine**
  zusaetzliche Berechtigungslogik hinzu - die Kombination ist rein praesentational. Das ist
  bewusst die "Grundlage fuer einen spaeteren Export" aus der Anforderung: ein spaeteres
  `/berichtsheft-export`-Command muesste nur `BerichtsheftEntry[]` in ein Zielformat (CSV, PDF, ...)
  serialisieren, ohne die bestehende Service-Schicht anzufassen.
- `src/bot/ui/reportMessage.ts` - Embed-Builder fuer alle drei Anzeige-Befehle
  (`buildDailyReportListEmbed()`/`buildWeeklyReportListEmbed()`/`buildBerichtsheftEmbed()`),
  strukturell wie `classEventMessage.ts` bei Pruefungen/Terminen.
- Commands (`src/bot/commands/klasse/`): `/tagesbericht-erstellen`, `/tagesbericht-bearbeiten`,
  `/tagesbericht-loeschen` (alle KLASSENLEITUNG), `/tagesberichte-anzeigen` (VERIFIED), die
  analogen vier `/wochenbericht-*`-Befehle sowie `/berichtsheft-anzeigen` (VERIFIED, kombinierte
  Ansicht).

Design-Entscheidungen:

- **Kein drittes "Berichtsheft"-Modell.** Siehe Migrations-Hinweis im Datenmodell-Abschnitt oben -
  `DailyReport` und `WeeklyReport` SIND bereits die Berichtsheft-Eintraege, `berichtsheftService.ts`
  fasst sie nur zusammen.
- **"Besondere Hinweise" ist ein Pflichtfeld, "Lernmaterialien" optional.** Entspricht der
  Anforderungsformulierung woertlich: Nur bei Tagesberichten war "optional verknuepfte
  Lernmaterialien" explizit als optional markiert, alle anderen Felder (inkl. "besondere
  Hinweise") nicht - konsistent mit dem bereits etablierten Muster bei Pruefungen
  (Beschreibung Pflicht, Lernhinweise optional).
- **Lernmaterialien als Freitext-Referenz statt Fremdschluessel.** Es existiert noch kein eigenes
  Lernmaterial-Modell (siehe Roadmap) - eine Relation dorthin waere verfrueht. Ein Freitextfeld
  (z. B. "Kapitel 4 PDF, Video XY") deckt die Anforderung "optional verknuepfte Lernmaterialien"
  ab, ohne ein Feature vorwegzunehmen, das noch nicht existiert.
- **Jahr wird serverseitig aus dem Zeitraum-Beginn abgeleitet, nicht separat abgefragt.** Vermeidet
  ein fuenftes Eingabefeld und die Moeglichkeit, dass Jahr und Zeitraum widerspruechlich
  eingegeben werden (siehe Migrations-Hinweis oben).
- **Kalenderwoche und Zeitraum werden beide gespeichert, ohne sie gegeneinander zu validieren.**
  Die Anforderung nennt beide Felder separat; ob eine angegebene Kalenderwoche exakt zum
  angegebenen Zeitraum passt (ISO-8601-Wochenberechnung), wird nicht geprueft - das waere eine
  zusaetzliche, nicht angeforderte Validierungsebene und in der Praxis Sache der eintragenden
  Klassenleitung. Was geprueft wird: Ganzzahligkeit/Bereich (1-53) der Kalenderwoche und dass das
  Zeitraum-Ende nicht vor dem Beginn liegt.
- **Lesezugriff wie bei Pruefungen/Terminen ueber `Member.classId`, nicht ueber Kanal-Overwrites.**
  Die Anforderung nennt zusaetzlich "sofern der jeweilige Klassenkanal dies erlaubt" - das ist
  bereits durch die echten Discord-Permission-Overwrites auf `reportChannelId` abgedeckt (siehe
  "Private Klassenbereiche" oben) und eine separate, davon unabhaengige Schicht: Discord verhindert
  ohnehin, dass ein Mitglied den Kanal einer fremden Klasse ueberhaupt sieht. Die Bot-interne
  Pruefung dupliziert das nicht ueber eine Live-Kanalabfrage (die einen echten Server/Token
  braeuchte, siehe Punkt 14 der Anforderung), sondern bleibt bei derselben DB-basierten Pruefung
  wie alle anderen klassenbezogenen Funktionen.

### Lernmaterial

Vierte klassenbezogene Fachfunktion, strukturell nach demselben Muster wie Pruefungen/Termine/
Berichte aufgebaut. Beteiligte Bausteine:

- `src/types/domain.ts::LEARNING_MATERIAL_CATEGORIES`/`LEARNING_MATERIAL_CATEGORY_LABELS` (neu) -
  zentral definierte, leicht erweiterbare Kategorienliste (IT/Technik, Netzwerke, Programmierung,
  Datenbanken, IT-Sicherheit, allgemeine Pruefungsvorbereitung), nach demselben Muster wie
  `CLASS_NAME_LABELS`/`IT_SKILL_LABELS` - Emoji direkt im Label, keine zweite Zuordnung zu
  pflegen. `LEARNING_MATERIAL_LINK_TYPES`/`_LABELS` beschreiben analog die drei moeglichen
  Verknuepfungsziele (Pruefung, Tages-, Wochenbericht).
- `src/repositories/learningMaterialRepository.ts` - reiner Datenzugriff nach demselben Muster wie
  `examRepository.ts`: jede Einzelabfrage nach ID ist immer zusaetzlich nach `guildId` gescoped.
  `listLearningMaterialsByClassId()` sortiert nach Kategorie dann Titel, damit die Anzeige
  gruppiert und uebersichtlich bleibt. `listLearningMaterialsLinkedTo(classId, linkedType, linkedId)`
  ist die umgekehrte Abfrage zu `resolveLink()` (siehe unten) - zusaetzlich zu `linkedType`/
  `linkedId` immer auch nach `classId` gescoped, obwohl eine cuid bereits eindeutig ist (dieselbe
  defensive Doppel-Absicherung wie beim Anlegen der Verknuepfung).
- `src/services/learningMaterialService.ts` - fuenf Funktionen
  (`createLearningMaterialForClass()`, `updateLearningMaterialForClass()`,
  `deleteLearningMaterialForClass()`, `listLearningMaterialsForClass()`,
  `listLearningMaterialsLinkedToExam()`), 1:1 nach dem etablierten Muster:
  `assertClassManagementAccess()` fuer Verwaltungsaktionen (Klasse beim Bearbeiten/Loeschen immer
  aus dem gespeicherten Datensatz aufgeloest, nie aus einem Aufrufer-Parameter),
  `assertClassReadAccess()` fuer die beiden Lesefunktionen. Zusaetzlich validiert
  `validateCategory()` die Kategorie gegen `learningMaterialCategorySchema` und `resolveLink()`
  eine optionale Verknuepfung: Typ und ID muessen gemeinsam angegeben werden, und der
  referenzierte Datensatz (Pruefung/Tages-/Wochenbericht) muss existieren UND zur selben Klasse
  gehoeren wie das Lernmaterial selbst - fail-closed gegen eine manipulierte Verknuepfungs-ID, die
  sonst auf eine fremde Klasse verweisen koennte (Anforderung 4/6).
  `listLearningMaterialsLinkedToExam()` loest die Pruefung immer per `guildConfig.id` auf
  (`getExamById()`), sodass eine Pruefungs-ID aus einer fremden Guild nie einen Treffer liefert,
  und prueft die Leseberechtigung anhand der Klasse, zu der die Pruefung tatsaechlich gehoert -
  keine zweite, parallele Berechtigungslogik.
- `src/bot/ui/learningMaterialMessage.ts::buildLearningMaterialListEmbed()` - Embed-Builder fuer
  `/lernmaterial-anzeigen` UND `/pruefung-lernmaterial` (Titel wird vom Aufrufer per `.setTitle()`
  ueberschrieben), strukturell wie `classEventMessage.ts`/`reportMessage.ts`.
- Commands (`src/bot/commands/klasse/`): `/lernmaterial-erstellen`, `/lernmaterial-bearbeiten`,
  `/lernmaterial-loeschen` (alle KLASSENLEITUNG), `/lernmaterial-anzeigen` (VERIFIED). Der
  optionale Discord-Datei-Anhang wird ueber `SlashCommandBuilder.addAttachmentOption()`
  entgegengenommen; gespeichert werden nur die von Discord gelieferten Metadaten
  (`attachment.url`/`.name`/`.contentType`) - die Datei selbst bleibt auf Discords CDN, der Bot
  laedt oder speichert sie nicht selbst hoch. `/pruefung-lernmaterial` (VERIFIED) ist die
  Reverse-Lookup-Abfrage: Lernmaterial anhand einer Pruefungs-ID finden statt umgekehrt.

Design-Entscheidungen:

- **Kein DB-Fremdschluessel fuer die optionale Verknuepfung.** Siehe Migrations-Hinweis im
  Datenmodell-Abschnitt oben - `linkedType`/`linkedId` sind einfache String-Spalten, deren
  Gueltigkeit (Existenz + Klassenzugehoerigkeit) `resolveLink()` bei jedem Schreibzugriff prueft.
  Da die DB die Referenz nicht selbst durchsetzt, loesen `deleteExamForClass()`/
  `deleteDailyReportForClass()`/`deleteWeeklyReportForClass()` die Verknuepfung explizit ueber
  `clearLearningMaterialLinksTo()` auf, wenn der verknuepfte Datensatz geloescht wird - sonst
  wuerde ein verwaister Verweis stehen bleiben, den `learningMaterialMessage.ts` faelschlich als
  gueltig anzeigen wuerde.
- **Anhang als Metadaten-Verweis, nicht als Datei-Kopie.** Der Bot laedt keine Datei-Inhalte
  herunter oder speichert sie selbst - Discord haelt die Datei auf seinem eigenen CDN vor, das
  Modell speichert nur URL/Name/Content-Type als Referenz. Das entspricht der Anforderung
  "Discord attachment metadata" woertlich und vermeidet unnoetige Datenhaltung/Speicherlimits.
- **Kategorie als feste Liste, nicht Freitext.** Ermoeglicht spaetere Filterung/Gruppierung
  (bereits in der Sortierung von `listLearningMaterialsByClassId()` genutzt) und verhindert
  Tippfehler-Varianten derselben Kategorie. `LEARNING_MATERIAL_CATEGORIES` ist die einzige
  Quelle der Wahrheit - eine neue Kategorie hinzuzufuegen bedeutet eine Zeile in `domain.ts`.
- **Verknuepfung ist datenbankseitig einseitig, aber in beide Richtungen abfragbar.** `Exam`/
  `DailyReport`/`WeeklyReport` wissen selbst weiterhin nichts von verknuepftem Lernmaterial (keine
  Rueckwaerts-Relation im Schema) - die Rueckwaerts-Abfrage laeuft stattdessen ueber
  `listLearningMaterialsLinkedTo()`/`listLearningMaterialsLinkedToExam()`, die `LearningMaterial`
  nach `linkedType`/`linkedId` filtern (`/pruefung-lernmaterial`). Kein neuer Fremdschluessel/keine
  neue Relation noetig, da die vorhandene `resolveLink()`-Validierung bereits sicherstellt, dass
  jede gespeicherte Verknuepfung gueltig und klassenzugehoerig ist.

### Kursplan

Fuenfte klassenbezogene Fachfunktion. Anders als Pruefungen/Termine/Berichte/Lernmaterial werden
Kursplan-Eintraege nicht per Discord-Command einzeln angelegt, sondern aus einer versionierten
externen Quelldatei importiert (aktuell nur fuer Klasse A: `data/course-plans/0002_KALENDER_ABLAUF_KW_preview.html`).
Beteiligte Bausteine:

- **Datenmodell** (`prisma/schema.prisma`): `CourseEntry` (ein Kurs-Slot: Kursnummer, Titel,
  optionaler Dozent, Start-/Enddatum, Herkunfts-Datei), `CourseSpecialDay` (Feiertage/
  unterrichtsfreie Zeiten, gleiches Muster), `CourseAcknowledgment` (Kenntnisnahme eines Mitglieds
  fuer einen Kurs-Slot, `@@unique([courseEntryId, memberDiscordId])`) und
  `CourseUpcomingNotification` (Marker fuer bereits gesendete 7-Tage-Hinweise,
  `courseEntryId @unique`). Alle vier Modelle sind wie jedes andere Fachmodell immer sowohl nach
  `guildId` als auch nach `classId` gescoped - **`classId` entscheidet allein, zu welcher Klasse ein
  Kurs gehoert**, nicht der Dateiname oder Zeitpunkt des Imports. Klasse B/C eigene Kursplaene zu
  geben bedeutet daher ausschliesslich: eine neue Quelldatei + einen neuen Eintrag in
  `COURSE_PLAN_SOURCE_FILES` (siehe unten) - keine Schema- oder Code-Aenderung.
- **Import** (`src/services/coursePlanImportService.ts`): `parseCoursePlanHtml()` ist eine reine
  Funktion ohne Datei-/DB-Zugriff, die die `courses`/`special`-JS-Arrays aus dem `<script>`-Block
  der Quell-HTML per Regex extrahiert - bewusst **kein `eval()`**, um keine beliebige JS-Ausfuehrung
  aus einer Datei zuzulassen, und weil das Quellformat fest genug ist, dass ein gezielter Parser
  ausreicht. Weicht die Anzahl geparster Eintraege von der Anzahl erkannter `{id:`/`{start:`-Marker
  ab, bricht der Parser mit einer `ValidationError` ab, statt still unvollstaendige Daten zu
  uebernehmen. `importCoursePlanFromFile()` schreibt die geparsten Daten idempotent per
  `upsertCourseEntry()`/`upsertCourseSpecialDay()` (`coursePlanRepository.ts`): eindeutiger
  Schluessel ist `[classId, courseNumber, startDate]` bzw. `[classId, startDate, endDate, label]` -
  ein wiederholter Import mit unveraenderter Quelle aktualisiert nur bestehende Zeilen (keine
  Duplikate), ein Import nach einer Quelldatei-Aenderung uebernimmt die geaenderten Felder gezielt.
  `importCoursePlanFromFile()` selbst hat KEINE Berechtigungspruefung (Vertrauensgrenze wie ein
  Repository) - sie liegt in den beiden Aufrufern: `/kursplan-importieren`
  (`importCoursePlanForClass()`, prueft `isServerAdmin()`) und dem reproduzierbaren CLI-Skript
  `src/scripts/importCoursePlan.ts` (`npm run course-plan:import`, laeuft ausserhalb des Bots ohne
  Discord-Kontext - derselbe Vertrauenslevel wie `deployCommands.ts`).
- **Aktueller/naechster Kurs** (`src/services/coursePlanService.ts`): `getCoursePlanOverviewForClass()`
  normalisiert "heute" auf UTC-Mitternacht (`toDateOnlyUtc()`, `src/utils/dateTime.ts`) und
  vergleicht das gegen `startDate`/`endDate` jedes `CourseEntry` der Klasse - liegt heute in keinem
  Zeitraum, wird das ausdruecklich als "kein Kurs" statt eines falschen Ergebnisses gemeldet. Die
  ISO-Kalenderwoche wird ueber `getIsoWeek()`/`getIsoWeekYear()` bestimmt - derselbe Standard-
  Algorithmus, 1:1 aus der `isoWeek()`-Funktion der Quell-HTML portiert, damit Bot-Anzeige und
  Quelldatei dieselbe Zaehlweise verwenden (verifiziert gegen die eigene Angabe der Quelle: KW 34
  fuer den 17.08.2026). Eine Klasse ganz ohne `CourseEntry`-Zeilen (aktuell B/C) liefert
  `hasOwnPlan: false` statt der Daten einer anderen Klasse. Fuer alle Lesezugriffe (Uebersicht,
  Kenntnisnahme) gilt dieselbe `assertClassReadAccess()` wie bei Pruefungen/Terminen/Lernmaterial;
  fuer den Status (`getCoursePlanStatusForClass()`, Klassenleitung/Admin) `assertClassManagementAccess()`
  - keine zweite, parallele Berechtigungslogik.
- **Kenntnisnahme**: `/kursplan` haengt an den aktuellen Kurs einen "Kenntnis genommen"-Button
  (`src/bot/ui/coursePlanMessage.ts`, customId-Schema `coursePlan:ack:<courseEntryId>` nach
  demselben Muster wie `class:select:<name>`/`verification:self-verify`). Der Button-Handler in
  `interactionCreate.ts` ruft `acknowledgeCourseEntryForMember()` auf, die den Kurs immer per
  `guildConfig.id` aufloest und dieselbe `assertClassReadAccess()` wie die Anzeige prueft - eine
  manipulierte `courseEntryId` in der customId verschafft daher nie Zugriff auf eine fremde
  Klasse/Guild. Eindeutigkeit der Kenntnisnahme liegt im Schema (`@@unique([courseEntryId,
memberDiscordId])`); die Repository-Funktion prueft zusaetzlich per `findUnique()` vor dem
  `create()` und liefert bei einem erneuten Klick `created: false` zurueck, statt einen zweiten
  Eintrag anzulegen oder einen Fehler zu werfen.
- **7-Tage-Hinweis** (`src/services/coursePlanNotificationService.ts`): wird bei jedem Bot-Start aus
  dem `ready`-Event (`src/bot/events/ready.ts`) fuer jede Guild/Klasse aufgerufen - keine separate
  Scheduler-Infrastruktur. `listCourseEntriesNeedingUpcomingNotification()` filtert Kurse, die
  innerhalb von `UPCOMING_NOTICE_WINDOW_DAYS` (7) beginnen UND fuer die noch keine
  `CourseUpcomingNotification` existiert (`upcomingNotification: { is: null }`-Relationsfilter).
  Sobald ein Kurs erkannt wird, wird sofort eine `CourseUpcomingNotification`-Zeile angelegt UND ein
  Audit-Log-Eintrag (`coursePlan.upcomingNotice`) geschrieben, bevor irgendetwas anderes passiert -
  `courseEntryId` ist zusaetzlich `@unique` im Schema, sodass selbst ein hypothetischer doppelter
  Aufruf nie zwei Benachrichtigungen fuer denselben Kurs anlegen kann. Das Posten der eigentlichen
  Discord-Nachricht in die Klassen-Ankuendigungen (`Class.announcementChannelId`) ist bewusst
  Best-Effort und lebt ausserhalb des Service (in `ready.ts`) - ein fehlender Kanal oder fehlende
  Bot-Berechtigungen duerfen weder den Bot-Start verhindern noch die bereits erfolgte, im Audit-Log
  nachvollziehbare Benachrichtigung ungeschehen machen.
- Commands (`src/bot/commands/`): `/kursplan` (VERIFIED, `klasse/`), `/kursplan-status`
  (KLASSENLEITUNG, `klasse/`), `/kursplan-importieren` (ADMIN, `admin/` - Import ist bewusst
  strikter als das uebliche Klassenleitung-oder-Admin-Muster, da es sich um offizielle,
  administrativ uebermittelte Daten handelt, nicht um taegliche Klassenleitungsarbeit).

Design-Entscheidungen:

- **Kein `eval()` fuer den HTML-Import.** Ein regexbasierter, auf das bekannte Quellformat
  zugeschnittener Parser ist ausreichend maechtig und vermeidet das Sicherheitsrisiko, beliebigen
  JavaScript-Code aus einer Datei auszufuehren.
- **B/C-Status statt A-Daten als Fallback.** `hasOwnPlan: false` ist eine explizite Modell-Aussage
  ("keine `CourseEntry`-Zeilen fuer diese Klasse"), niemals ein impliziter Fallback auf die Daten
  einer anderen Klasse - genau das ist per Anforderung ausdruecklich verboten (A-Daten duerfen nicht
  als Kursplan von B/C erscheinen).
- **Kein separater Scheduler fuer den 7-Tage-Hinweis.** Die Pruefung haengt am ohnehin vorhandenen
  `ready`-Event; ein Bot, der laenger als 7 Tage durchgehend laeuft, ohne neu zu starten, wuerde
  einen neu in dieses Fenster rutschenden Kurs erst beim naechsten Neustart erkennen. Fuer eine
  kleine, private Lerngruppe ohne Hochverfuegbarkeitsanspruch ist das ein akzeptabler Kompromiss
  gegenueber einer zusaetzlichen Cron-/Timer-Infrastruktur; eine spaetere Ergaenzung (z. B.
  taeglicher `setInterval()`-Check) waere lokal auf `ready.ts`/`coursePlanNotificationService.ts`
  begrenzt.

### Kursinhalte

Ergaenzt den Kursplan (oben) um die eigentlichen Lerninhalte je Kurs, importiert aus
`data/course-plans/kursinhalte.json` (strukturierte Extraktion des eCampus-Kursinhalte-PDFs - siehe
`data/course-plans/README.md` fuer Quelle, Erhebungsmethode und den Grund, warum das Roh-PDF nicht
als Laufzeitquelle dient).

- **Datenmodell:** neues Modell `CourseContentItem` (siehe "Datenmodell" oben) - bewusst **global**
  wie `ComcaveLocation`, nicht guild-/klassen-gescoped, da der Inhalt eines Kurses ein von
  Klasse/Guild unabhaengiger Fakt ist. Ein Row je einzelnem, nummerierten Inhaltseintrag (nicht ein
  JSON-Blob pro Kurs) - `orderIndex`/`numberPath`/`level` erhalten Reihenfolge und hierarchische
  Struktur aus der Quelle.
- **Hierarchie-Rekonstruktion:** Die Quelle nummeriert jede Ebene fuer sich neu beginnend bei 1 (kein
  durchgehender Pfad im Rohtext) - `reconstructCourseContentHierarchy()` in
  `courseContentImportService.ts` leitet die tatsaechliche Tiefe deterministisch aus der Zahlenfolge
  her (fortlaufende Zahl = Geschwisterknoten derselben Ebene, Zahl 1 nach einem tieferen/gleichen
  Knoten = neue tiefere Ebene) und wurde gegen alle 592 Eintraege der realen Quelldatei verifiziert.
- **Verknuepfung zum Kursplan bewusst nur lose ueber `courseNumber`, kein FK** - `CourseEntry` wird
  pro Klasse/Guild dupliziert (dieselbe Kursnummer kann in mehreren Klassen mit unterschiedlichem
  Start-/Enddatum auftauchen), waehrend der Inhalt genau einmal global gilt. `courseContentService.ts`
  stellt `getCourseContentForEntry(entry)` sowie `getCourseContentByCourseNumber(...)` bereit.
- **Start-/Enddatum werden nicht in `CourseContentItem` gespeichert** - Terminplanung bleibt exklusiv
  Aufgabe von `CourseEntry`, damit keine zweite, potenziell abweichende Datumsquelle entsteht.
- **Import idempotent per Kurs-Ersetzung:** `replaceCourseContentForCourse()` ersetzt pro Kurs den
  kompletten Eintragsbestand (loeschen, was nicht mehr in der Quelle steht; upsert per
  `[courseNumber, orderIndex]`) - anders als beim Standort-Katalog unbedenklich, da kein anderes
  Modell per FK auf `CourseContentItem.id` verweist. CLI: `npm run kursinhalte:import`.
- **Noch keine Discord-UI/-Commands** (bewusst, siehe Aufgabenstellung) - Daten sind bereits ueber die
  Service-Schicht abrufbar und fuer eine spaetere Erweiterung von `/kursplan` bzw. einen neuen Befehl
  vorbereitet, ohne dass Repository/Service sich dafuer aendern muessten.

### Lerngruppen

Sechste klassenbezogene Fachfunktion: temporaere Lern-/Arbeitsgruppen innerhalb einer Klasse
(begrifflich nicht zu verwechseln mit der "Lerngruppe" im Sinne der gesamten COMCAVE-Kohorte aus der
Einleitung von README.md - der Name wurde bewusst so aus der Anforderung uebernommen). Beteiligte
Bausteine:

- **Datenmodell** (`prisma/schema.prisma`): `StudyGroup` (Name, Ersteller, `isActive`/`closedAt`/
  `closedByDiscordId` statt Loeschen - geschlossene Gruppen bleiben fuer Audit/Nachvollziehbarkeit
  erhalten, dieselbe Ueberlegung wie bei entfernten Klassenleitungs-Zuweisungen, die ebenfalls nicht
  geloescht werden), optionales `maxParticipants`. `StudyGroupMember` (Mitgliedschaft, `@@unique(
[studyGroupId, memberDiscordId])` - ein erneuter Beitritt kann nie einen zweiten Eintrag anlegen).
  Beide Modelle wie jedes andere Fachmodell immer nach `guildId` UND `classId` gescoped.
- **Repository/Service** (`studyGroupRepository.ts`/`studyGroupService.ts`), 1:1 nach dem
  etablierten Muster: jede Funktion loest die Gruppe zuerst per `guildConfig.id` auf
  (`getStudyGroupById()`), dann die Klasse aus dem gespeicherten `group.classId`
  (`getClassById()`) - niemals aus einem Aufrufer-Parameter. `assertClassReadAccess()` fuer
  Erstellen/Anzeigen/Beitreten/Kenntnisnahme-aehnliche Lesevorgaenge (jedes verifizierte Mitglied der
  eigenen Klasse), `assertClassManagementAccess()` fuer Verwaltungssicht und Mitgliederverwaltung
  (nur Admin/Klassenleitung der betroffenen Klasse). Verlassen einer Gruppe braucht keine eigene
  Berechtigungspruefung - man kann ausschliesslich die eigene Mitgliedschaft loeschen.
- **Schliessen als kontrollierte Ausnahme:** `closeStudyGroup()` erlaubt zusaetzlich zu Admin/
  Klassenleitung auch die urspruengliche Ersteller:in der Gruppe (`isServerAdmin() ||
isClassLeadOf() || group.createdByDiscordId === member.id`) - dieselbe Technik wie bei
  `assertClassReadAccess()` selbst (dieselben Grund-Bedingungen, um GENAU eine zusaetzliche erlaubte
  Bedingung ergaenzt, keine zweite parallele Pruefung). Jede mutierende Funktion prueft zuerst
  `group.isActive` und lehnt mit `ValidationError` ab, wenn die Gruppe bereits geschlossen ist -
  Beitreten, Verlassen, Mitgliederverwaltung und ein erneutes Schliessen sind auf einer geschlossenen
  Gruppe damit einheitlich blockiert.
- Commands (`src/bot/commands/klasse/`): `/lerngruppe-erstellen`, `/lerngruppen-anzeigen`,
  `/lerngruppe-beitreten`, `/lerngruppe-verlassen`, `/lerngruppe-schliessen` (alle VERIFIED - die
  tatsaechliche Einschraenkung bei `/lerngruppe-schliessen` liegt im Service, nicht im
  Command-Gate, da auch eine normale Ersteller:in schliessen darf), `/lerngruppe-status` und
  `/lerngruppe-mitglied-entfernen` (beide KLASSENLEITUNG). Kein interaktives Auswahl-Menu (ID-basiert
  wie bei Pruefungen/Terminen), keine dynamischen Buttons pro Gruppe.

Design-Entscheidungen:

- **Kein dynamisch angelegter/geloeschter Voice-Kanal pro Gruppe.** Der Klassen-Sprachkanal
  (`Class.voiceChannelId`, siehe "Private Klassenbereiche" oben) steht bereits allen Mitgliedern der
  Klasse offen - fuer eine Lerngruppe gibt es dort nichts zusaetzlich zu gewaehren, das nicht schon
  laenger existiert. Ein Kanal pro Gruppe haette Kanal-Lifecycle-Management (Erstellung beim
  Gruenden, Loeschung beim Schliessen, verwaiste Kanaele bei einem Bot-Absturz zwischen beiden
  Schritten, Discord-Kanal-Limits) erfordert, ohne dass die Anforderung selbst einen Vorteil
  gegenueber dem gemeinsamen Kanal benennt - genau der Fall, den die Anforderung selbst als "wenn
  temporaere Voice-Raeume architektonisch unnoetig komplex waeren" vorgesehen hat. `/lerngruppen-
anzeigen` verweist stattdessen lediglich auf den vorhandenen Kanal.
  Moderationsseitig bedeutet das: "Voice-/Gruppenrechte zurücksetzen" hat hier keine eigene
  Discord-Berechtigung zum Widerrufen (da nie eine gruppenspezifische vergeben wurde) - Schliessen
  der Gruppe bzw. Entfernen eines Mitglieds IST die vollstaendige Rueckstellung.
- **Status aktiv/inaktiv statt Loeschen.** Ermoeglicht `/lerngruppe-status` weiterhin geschlossene
  Gruppen samt Verlauf anzuzeigen und haelt den Audit-Trail (`studyGroup.close` mit `closedAt`/
  `closedByDiscordId`) nachvollziehbar, statt Historie durch ein `DELETE` zu verlieren.
- **Teilnehmerlimit als einfaches optionales Integer-Feld statt Warteliste.** Die Anforderung nennt
  nur eine "optional begrenzte Teilnehmerzahl", keine Warteschlangen-Logik - ein zusaetzliches
  Warteliste-Modell waere Funktionsumfang ohne Anforderungsdeckung.

### Admin-/Moderator-Rollen

`GuildConfig.adminRoleId`/`moderatorRoleId` waren von Anfang an Teil des Schemas ("Rollen-IDs fuer
das Berechtigungssystem", siehe Datenmodell-Abschnitt) und `isServerAdmin()`
(`src/permissions/checkPermission.ts`) wertet `adminRoleId` bereits seit dem Permission-Grundgeruest
aktiv aus. Es gab jedoch **keinen Befehl, der diese Felder tatsaechlich setzen konnte** -
`/konfiguration` zeigte sie nur an. Das Review hat diese Luecke identifiziert und geschlossen:

- `src/services/guildConfigService.ts::configureAdminRoles()` - neue Service-Funktion, die
  `adminRoleId` (erforderlich) und optional `moderatorRoleId` setzt. Beide Rollen werden vor dem
  Speichern gegen `roleHasAdministrator()` geprueft (dasselbe Muster wie bei Verifiziert-/
  Klassenrollen) und bei einem Treffer mit `ValidationError` abgelehnt, bevor irgendetwas
  geschrieben wird. Schreibt einen `admin.roles.setup`-Audit-Log-Eintrag.
- `/setup-admin-rollen` (`src/bot/commands/admin/setupAdminRollen.ts`, ADMIN) - duenner
  Command-Wrapper um `configureAdminRoles()`. Wird `moderator-rolle` nicht angegeben, bleibt ein
  bereits gesetzter Wert unveraendert (`input.moderatorRole !== undefined`-Unterscheidung).
- **Wichtige Klarstellung zu `moderatorRoleId`:** Das Feld ist jetzt konfigurierbar, aber
  `checkPermission.ts` wertet es weiterhin nirgends aus - es gibt keine `PermissionLevel.MODERATOR`
  und keine Moderationsfunktionen (Kick/Mute/Warn), die eine solche Stufe brauchen wuerden. Das
  Feld wurde bewusst NICHT mit erfundener Moderationslogik verknuepft, um kein neues, ungenutztes
  Berechtigungssystem parallel zum bestehenden aufzubauen - es bleibt fuer eine spaetere
  Moderationsfunktion reserviert (vgl. Schema-Kommentar "Verifizierung, Onboarding, Klassen,
  Klassenleitung, Berichte, Moderation, Logging"). Ein Mitglied mit ausschliesslich der
  Moderator-Rolle hat aktuell exakt dieselben Rechte wie jedes andere verifizierte Mitglied.

### Audit-Log-Anzeige

Der Audit-Log-Repository-Layer (`src/repositories/auditLogRepository.ts`) existierte von Anfang an
(`logAuditEvent()`/`listAuditEvents()`), es gab aber keinen Weg, die gesammelten Eintraege
tatsaechlich einzusehen - nur direkter Datenbankzugriff. Das Review hat das geschlossen:

- `listAuditEvents()`/neu `countAuditEvents()` wurden um optionale `actorDiscordId`-/`action`-Filter
  sowie `take`/`skip` fuer Paginierung erweitert (rueckwaertskompatibel - bestehende Aufrufe mit nur
  `targetDiscordId` funktionieren unveraendert weiter).
- `src/services/auditLogService.ts::getAuditLogPage()` - liefert eine Seite zu 10 Eintraegen,
  neueste zuerst. Prueft **explizit in der Service-Schicht** `isServerAdmin()`, nicht nur ueber
  `permissionLevel: ADMIN` am Command - dieselbe zentrale Funktion wie ueberall sonst, keine zweite
  Berechtigungslogik, aber unabhaengig von der Command-Anbindung testbar und durchsetzbar.
  Klassenleitung hat **keinen** erweiterten Zugriff, auch nicht auf Eintraege der eigenen Klasse.
- `src/bot/ui/auditLogMessage.ts::buildAuditLogEmbed()` - liest die betroffene Klasse best-effort
  aus dem `className`-Feld der `metadata`-Spalte aus (das nahezu jeder klassenbezogene Audit-Log-
  Eintrag im Projekt bereits mitfuehrt), statt eine neue Spalte oder Relation dafuer anzulegen.
- `/audit-log seite:<...> aktion:<...> nutzer:<...>` (`src/bot/commands/admin/auditLog.ts`, ADMIN).

### Server-Bootstrap

`/setup-klassen`/`/setup-verifizierung`/`/setup-admin-rollen` verlangten bislang jeweils bereits
existierende Discord-Rollen/-Kanaele als Parameter (Discords `RoleOption`/`ChannelOption`-Typen
lassen technisch gar nichts anderes zu - der Admin waehlt zwingend aus bestehenden Objekten). Fuer
einen komplett neuen, leeren Testserver bedeutete das siebenfaches manuelles Vorab-Anlegen von
Rollen/Kanaelen in Discord, bevor der erste Setup-Befehl ueberhaupt lief. `/setup-server`
(`src/services/serverBootstrapService.ts`, `src/bot/commands/admin/setupServer.ts`) schliesst diese
Luecke, indem es **ausschliesslich bereits bestehende Services orchestriert** statt eine
Parallelarchitektur zu bauen:

- **Rollen/Kanaele finden-oder-anlegen** (`ensureManagedRole()`/`ensureTextChannel()`): zuerst per
  in `GuildConfig`/`Class` gespeicherter ID (Selbstheilung wie bei `classLeadService.ts`, falls die
  ID nicht mehr aufloesbar ist), sonst per exaktem Namensabgleich unter allen Rollen/Kanaelen des
  Servers (deckt den Fall ab, dass ein Admin sie bereits manuell mit dem erwarteten Namen angelegt
  hat), erst dann Neuanlage - nie werden vorhandene Objekte umbenannt, veraendert oder geloescht.
  Feste Namen (`Verifiziert`/`Admin`/`Moderator`/`Klasse A/B/C`/`verifizierung`/`wo-bin-ich`/
  `bot-log`) uebernehmen wortwoertlich die Begriffe, die README.md/ARCHITECTURE.md fuer diese
  Rollen/Kanaele bereits durchgaengig verwenden.
- **Private Klassenbereiche**: ruft nach dem Setzen der Klassenrollen direkt `setupClassArea()`
  (`classAreaService.ts`) auf - identischer Code-Pfad wie `/setup-klassenbereiche "alle Klassen"`,
  keine zweite Kanal-/Overwrite-Logik.
- **Admin-/Moderator-Rolle**: persistiert ueber das bestehende `configureAdminRoles()`
  (`guildConfigService.ts`), das seine eigene Administrator-Rechte-Pruefung und sein eigenes
  Audit-Log bereits mitbringt.
- **Fail-closed vor jeder Persistierung:** alle sechs verwalteten Rollen (Verifiziert/Admin/
  Moderator/Klasse A/B/C) werden auf Administrator-Rechte geprueft, **bevor** irgendetwas in der DB
  geschrieben wird - ein Verstoss (z. B. eine bereits manuell mit Admin-Rechten angelegte Rolle mit
  passendem Namen) bricht den gesamten Bootstrap ab, statt einen halb konfigurierten Server zu
  hinterlassen.
- **Nachrichten-Idempotenz ohne neues Datenmodell:** vor dem Posten der Verifizierungs-/
  #wo-bin-ich-Nachricht scannt `channelHasMatchingMessage()` die letzten 20 Nachrichten des Kanals
  auf eine bereits vorhandene Nachricht mit dem passenden Button (`VERIFY_BUTTON_CUSTOM_ID`/
  `CLASS_SELECT_CUSTOM_ID_PREFIX`) - deckt sowohl "Kanal gerade neu angelegt" als auch "Kanal
  existierte schon, aber ohne Nachricht" korrekt ab, ohne dafuer ein neues "wurde schon gepostet"-
  Feld einzufuehren.
- **Race Conditions:** ein In-Process-Lock (`Set<guildId>`) verweigert einen zweiten parallelen
  `/setup-server`-Aufruf fuer denselben Server mit einer klaren Fehlermeldung, statt zwei
  gleichzeitige Laeufe doppelte Rollen/Kanaele anlegen zu lassen (Discord bietet kein atomares
  "nur anlegen, falls nicht vorhanden"). Schuetzt nur innerhalb dieses Bot-Prozesses - ausreichend,
  da das Deployment genau eine Bot-Instanz betreibt.
- **Bot-Rollenposition/Konsistenzpruefung:** am Ende nicht-blockierende Warnungen, falls die
  hoechste Bot-Rolle nicht ueber den verwalteten Rollen steht (spaetere Rollenzuweisung wuerde sonst
  mit Discord-Fehlercode 50013 fehlschlagen) oder falls die DB nach dem Bootstrap unerwarteterweise
  noch Luecken aufweist.
- **Log-Kanal** (`GuildConfig.logChannelId`) wird angelegt und mit `@everyone`-ViewChannel-Deny +
  Admin-Allow-Overwrite versehen, bleibt aber wie `moderatorRoleId` bewusst **ohne Schreib-Logik** -
  nichts im Projekt postet aktuell dorthin; das Feld existierte bereits im Schema, der Bootstrap
  fuellt es nur.

`/setup-server` ersetzt keinen der granularen Einzel-Befehle (die bleiben fuer gezielte
Nachkonfiguration/Reparatur einzelner Rollen/Kanaele nutzbar) und fuehrt keine neue fachliche
Logik ein - es verbindet ausschliesslich bereits vorhandene, einzeln getestete Bausteine.

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
- Klassenauswahl ist ebenso an den Verifizierungsstatus gekoppelt (`assignClass()`/
  `getCurrentClassName()` rufen `assertMemberVerified()` bei jedem Aufruf auf) - kein
  unverifiziertes Mitglied kann sich selbst eine Klassenrolle zuweisen.
- Klassenrollen duerfen laut `/setup-klassen`-Validierung keine Administrator-Berechtigung
  tragen - eine Klassenzugehoerigkeit kann nie versehentlich globale Admin-Rechte verleihen.
- Ein Mitglied kann nie zwei Klassenrollen gleichzeitig besitzen: `assignClass()` entfernt die
  alte Rolle immer, bevor die neue vergeben wird, und `Member.classId` ist ein Einzelfeld.
- Private Klassenbereiche sind ueber echte Discord-Permission-Overwrites abgesichert
  (`@everyone` verliert `ViewChannel` auf Kategorie und jedem Kanal), nicht durch eine reine
  Konvention wie "Kanal nicht verlinken". Fehlt dem Bot die Berechtigung zum Anlegen von
  Kanaelen, wird das (wie bei Rollenvergabe) in eine verstaendliche `ValidationError`
  uebersetzt statt eines stillen Fehlschlags.
- Die Klassenleitungs-Rolle wird ausschliesslich mit `permissions: []` angelegt und vor jeder
  Zuweisung erneut auf Administrator-Rechte geprueft (`assertRoleHasNoAdministrator()`) - selbst
  eine nachtraeglich manuell in Discord veraenderte Rolle blockiert dann weitere Zuweisungen,
  statt stillschweigend Admin-Rechte durchzureichen. Jedes tatsaechliche Recht der Klassenleitung
  ist ein Kanal-Overwrite innerhalb der eigenen Klasse, nie eine globale Rollenberechtigung -
  `Administrator`/`ManageGuild`/`ManageRoles`/`ManageChannels`/`ManageWebhooks`/`KickMembers`/
  `BanMembers` kommen im gesamten Klassenleitungs-Code nicht vor.
- Klassenbezogene Verwaltungsaktionen laufen ausnahmslos durch
  `assertClassManagementAccess()`/`isClassLeadOf()` (`src/permissions/checkPermission.ts`) - fail
  closed: fehlt die Klasse, die Rolle oder die Zuordnung, wird der Zugriff verweigert statt im
  Zweifel erlaubt. Eine manipulierte Klassen-ID/ein manipulierter Command-Parameter kann dadurch
  nie Zugriff auf eine fremde Klasse verschaffen (siehe Testmatrix in `tests/permissions.test.ts`).
- Pruefungen und Termine loesen die Berechtigung beim Bearbeiten/Loeschen immer aus dem
  gespeicherten Datensatz auf (`exam.classId`/`appointment.classId` -> `getClassById()`), niemals
  aus einem vom Aufrufer angegebenen Klassennamen - eine manipulierte Pruefungs-/Termin-ID kann
  dadurch nie auf eine fremde Klasse zugreifen, selbst wenn der Aufrufer die ID einer fremden
  Klasse erraet oder kopiert. `getClassById()`/`getExamById()`/`getAppointmentById()` sind
  zusaetzlich immer nach `guildId` gescoped, damit keine ID serveruebergreifend Daten preisgibt.
  Lesezugriff (`assertClassReadAccess()`) ist ebenso fail-closed: ohne eine der drei erlaubten
  Bedingungen (Admin, Klassenleitung dieser Klasse, eigene Klassenzugehoerigkeit) wird verweigert.
- Tages-/Wochenberichte (Berichtsheft) wenden exakt dasselbe Fail-closed-Muster an wie
  Pruefungen/Termine: `dailyReportService.ts`/`weeklyReportService.ts` loesen die Klasse beim
  Bearbeiten/Loeschen immer aus `report.classId` -> `getClassById()` auf, nie aus einem
  Aufrufer-Parameter. `berichtsheftService.ts` fuegt keine eigene Pruefung hinzu, sondern
  delegiert vollstaendig an die bereits authentifizierten Listenfunktionen der beiden Services.
- Lernmaterial wendet dasselbe Fail-closed-Muster an (`material.classId` -> `getClassById()`) und
  erweitert es um eine zusaetzliche Pruefung fuer die optionale Verknuepfung: `resolveLink()` in
  `learningMaterialService.ts` akzeptiert eine Verknuepfungs-ID nur, wenn der referenzierte
  Datensatz existiert UND `classId`-gleich mit dem Lernmaterial ist - eine manipulierte
  Verknuepfungs-ID kann dadurch nie eine Verbindung zu einer fremden Klasse herstellen, selbst
  wenn die ID selbst gueltig ist (gehoert nur zu einer anderen Klasse).
- Teilnehmerprofil und Regelzustimmung sind wie Verifizierung/Klassenwahl an eine bei jedem
  Zugriff frisch geprueften Gate-Funktion gekoppelt (`assertProfileComplete()`/
  `assertRulesAccepted()`, siehe "Teilnehmerprofil, COMCAVE-Standorte und Serverregeln" oben) -
  kein einmaliges, umgehbares Client-Flag.
- `selectLocation()`/`completeProfileAndSetNickname()` loesen eine `locationId` immer gegen die
  Datenbank auf (`getLocationById()`) und verlangen `isActive: true` - eine manipulierte oder
  veraltete ID aus einer Autocomplete-Antwort wird dadurch fail-closed abgelehnt.
- Persoenliche Daten (Name/Alter/Standort) tauchen in keinem Audit-Log-Eintrag, keiner normalen
  Log-Ausgabe und keiner Fehlermeldung im Klartext auf - siehe Datenschutz-Absatz im
  Teilnehmerprofil-Abschnitt oben.
- Die zusaetzliche Bot-Permission `ManageNicknames` wird ausschliesslich fuer das automatische
  Setzen des serverbezogenen Nicknamens verwendet, nie fuer den globalen Discord-Benutzernamen
  (dafuer besitzt kein Bot ueberhaupt eine Berechtigung) - ein Fehlschlag wird ueber
  `trySetNickname()` abgefangen, nie ungeprueft durchgereicht.

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
   jetzt erfassten `Member.interests`. Kann `src/services/discordRoleSync.ts` direkt wiederverwenden.
5. ~~**Klassenzuweisung A/B/C**~~ - **umgesetzt.** Nutzt `Class`/`Member.classId`, siehe
   ["Klassenzuweisung" im README](./README.md#klassenzuweisung) und "Klassenzuweisung A/B/C" oben.
6. ~~**`#wo-bin-ich` mit Auswahl A/B/C`**~~ - **umgesetzt** als Teil von Punkt 5 (dauerhafte
Kanal-Nachricht per `/setup-klassen`sowie`/wo-bin-ich` als persoenliche Alternative).
7. ~~**Private Klassenbereiche**~~ - **umgesetzt.** Siehe Abschnitt
   ["Private Klassenbereiche" im README](./README.md#private-klassenbereiche) sowie
   "Private Klassenbereiche" oben. Nutzt `Class.categoryId` und die neuen Kanal-ID-Felder.
8. ~~**Klassenleitung mit administrativen Rechten nur fuer die eigene Klasse**~~ - **umgesetzt.**
   Siehe Abschnitt ["Klassenleitung" im README](./README.md#klassenleitung) sowie
   "Klassenleitung" oben. `assertClassManagementAccess()` ist ab jetzt die zentrale Pruefung fuer
   alle folgenden klassenbezogenen Funktionen (Punkte 9-12, 14).
9. ~~**Pruefungen und Termine**~~ - **umgesetzt.** Siehe Abschnitt
   ["Pruefungen und Termine" im README](./README.md#pruefungen-und-termine) sowie "Pruefungen und
   Termine" oben. Erste klassenbezogene Fachfunktion, die `assertClassManagementAccess()`/
   `assertClassReadAccess()` fuer Verwaltung bzw. Lesezugriff verwendet - das Muster fuer die
   folgenden Punkte 10-12.
10. ~~**Tages-/Wochenberichte**~~ - **umgesetzt.**
11. ~~**Berichtsheft**~~ - **umgesetzt** als kombinierte Sicht auf Tages-/Wochenberichte. Siehe
    Abschnitt ["Berichtsheft, Tages- und Wochenberichte" im
    README](./README.md#berichtsheft-tages--und-wochenberichte) sowie "Berichtsheft, Tages- und
    Wochenberichte" oben. Kanal existiert bereits (`reportChannelId`).
12. ~~**Lernmaterial**~~ - **umgesetzt.** Siehe Abschnitt
    ["Lernmaterial" im README](./README.md#lernmaterial) sowie "Lernmaterial" oben. Kanal existiert
    bereits (`materialChannelId`); die optionale Verknuepfung mit Pruefungen/Berichten nutzt
    dasselbe Fail-closed-Prinzip wie alle anderen klassenbezogenen Funktionen.
13. ~~**Lerngruppen (Voice-Konzept)**~~ - **umgesetzt**, mit der robusteren Variante ohne dynamische
    Voice-Kanaele. Siehe Abschnitt ["Lerngruppen" im README](./README.md#lerngruppen) sowie
    "Lerngruppen" oben: Gruppen nutzen den bereits vorhandenen Klassen-Sprachkanal
    (`Class.voiceChannelId`) statt eigener, dynamisch verwalteter Kanaele.
14. ~~**Klassenbezogene Moderation (Lerngruppen)**~~ - **teilweise umgesetzt**: Klassenleitung/Admin
    koennen Lerngruppen-Mitglieder entfernen und Gruppen schliessen (`/lerngruppe-mitglied-entfernen`,
    `/lerngruppe-status`), siehe "Lerngruppen" oben. Server-/kanalweite Moderation (Mute/Kick auf
    Discord-Ebene, `MuteMembers`/`DeafenMembers`/`MoveMembers`-Overwrites) ist weiterhin offen - kann
    die bereits vergebenen Klassenleitungs-Overwrites direkt nutzen, sobald benoetigt.
    `GuildConfig.moderatorRoleId` ist seit dem Sicherheits-Review ueber `/setup-admin-rollen`
    konfigurierbar (siehe "Admin-/Moderator-Rollen" oben), aber weiterhin ohne Wirkung - eine
    kuenftige serverweite Moderationsfunktion braucht dafuer noch eine eigene
    `PermissionLevel.MODERATOR`-Stufe in `src/permissions/`.
15. ~~**Logging/Audit-Log-Anzeige**~~ - **umgesetzt** fuer den Lesezugriff. `AuditLogEntry` wurde
    von Anfang an bei jeder relevanten Aktion geschrieben; `/audit-log` (siehe
    "Audit-Log-Anzeige" oben) macht die gesammelten Eintraege jetzt fuer globale Admins einsehbar.
16. ~~**Kursplan (Klasse A)**~~ - **umgesetzt.** Siehe Abschnitt ["Kursplan" im
    README](./README.md#kursplan) sowie "Kursplan" oben: strukturierter Import aus einer
    versionierten Quelldatei, aktueller/naechster Kurs, Kenntnisnahme, 7-Tage-Hinweis.
17. **Eigene Kurspläne für Klasse B/C** - reine Datenaufgabe auf Basis der bestehenden Architektur:
    sobald eine versionierte Quelldatei fuer B/C vorliegt, genuegt ein neuer Eintrag in
    `COURSE_PLAN_SOURCE_FILES` (`coursePlanImportService.ts`) und ein Import-Lauf - Schema, Services,
    Commands und Permission-Pruefungen sind bereits klassen-generisch und brauchen keine Aenderung.
18. **Weitere Admin-Befehle**
19. ~~**Teilnehmerprofil (Pflichtangaben) + COMCAVE-Standorte**~~ - **umgesetzt.** Siehe Abschnitte
    ["Teilnehmerprofil (Pflichtangaben)" und "COMCAVE-Standorte" im
    README](./README.md#teilnehmerprofil-pflichtangaben) sowie "Teilnehmerprofil, COMCAVE-Standorte
    und Serverregeln" oben. Standort-Katalog mit einem verifizierten Teilbestand von 226 echten,
    ausschliesslich von `comcave.de` stammenden Standorten befuellt (siehe
    `data/locations/README.md`) - die vollstaendige Liste der 300+ offiziellen Standorte kann die
    Administration jederzeit ergaenzen, ohne dass sich Format oder Importlogik aendern.
20. ~~**Serverregeln mit Zustimmungsstatus**~~ - **umgesetzt.** Siehe Abschnitt
    ["Serverregeln und Zustimmung" im README](./README.md#serverregeln-und-zustimmung) sowie
    "Teilnehmerprofil, COMCAVE-Standorte und Serverregeln" oben. Regeltext muss noch per
    `/regelwerk-aktualisieren` erstmalig konfiguriert werden - ohne aktives `RuleSet` bleibt der
    Eintrittsflow an dieser Stelle mit einer verstaendlichen Fehlermeldung stehen (bewusst
    fail-closed, kein stillschweigendes Ueberspringen).
21. ~~**Kursinhalte (eCampus-PDF-Extraktion)**~~ - **umgesetzt** (Datenmodell + Import + Service-
    Schicht). Siehe Abschnitt ["Kursinhalte" im README](./README.md#kursinhalte) sowie "Kursinhalte"
    oben: globaler Katalog (`CourseContentItem`), 34 Kurse/592 Inhaltseintraege aus
    `data/course-plans/kursinhalte.json`, Verknuepfung zum Kursplan lose ueber `courseNumber`.
    Bewusst noch OHNE eigene Discord-UI/-Commands - `courseContentService.ts` ist bereits als
    Einstiegspunkt fuer eine spaetere `/kursplan`-Erweiterung vorbereitet.
22. ~~**Zentraler Server-Bootstrap (`/setup-server`)**~~ - **umgesetzt.** Siehe Abschnitt
    ["Server-Bootstrap" im README](./README.md#-server-bootstrap-setup-server) sowie
    "Server-Bootstrap" oben: orchestriert ausschliesslich bereits bestehende Services
    (`configureAdminRoles()`, `classAreaService.ts`, `updateGuildConfig()`/`updateClassRole()`),
    keine neue Parallelarchitektur. Ersetzt keinen der granularen Einzel-Befehle, deckt aber den
    "leerer Testserver" Sonderfall in einem Aufruf ab.

Jede dieser Funktionen wird als eigener, in sich getesteter Arbeitsschritt umgesetzt, um das
Projekt durchgehend in einem lauffaehigen Zustand zu halten.
