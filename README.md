# COMCAVE Discord Bot

Ein Discord-Bot fuer eine private COMCAVE-Umschulungs-Lerngruppe.

Auf dem technischen Grundgeruest (Konfiguration, Logging, Datenpersistenz,
Berechtigungssystem, Command-/Event-Infrastruktur) sind die Kernfunktionen umgesetzt:
**Verifizierung neuer Mitglieder**, ein **verpflichtendes Teilnehmerprofil** (Vorname/Nachname/
Alter/COMCAVE-Standort, mit automatischem Server-Nickname), **Serverregeln mit nachvollziehbarer
Zustimmung**, **dynamisches Onboarding**, **Klassenzuweisung A/B/C**, **private Klassenbereiche**,
**klassenbezogene Klassenleitung**, **Pruefungen und Termine**, **Tages-/Wochenberichte als
Berichtsheft-Grundlage**, **strukturiertes Lernmaterial**, ein **Kursplan mit Kenntnisnahme und
7-Tage-Hinweis** (aktuell fuer Klasse A) sowie **klassenbezogene Lerngruppen** (Beitreten/
Verwalten/Moderation ueber den gemeinsamen Klassen-Sprachkanal) - die klassenbezogenen
Fachfunktionen auf Basis der Klassenleitung. Weitere Fachfunktionen (eigene Kursplaene fuer B/C,
weitergehende Moderation, ...) werden darauf aufbauend schrittweise ergaenzt. Details zu
Architektur und Roadmap stehen in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

**Eintrittsflow (verbindliche Reihenfolge):** Beitritt → Verifizierung → Teilnehmerprofil
(Pflichtangaben + COMCAVE-Standort) → Serverregeln (Zustimmung) → bestehendes Onboarding →
Klassenwahl A/B/C. Jeder Schritt wird ueber eine eigene, bei jedem Zugriff frisch gepruefte
Gate-Funktion abgesichert (`assertMemberVerified()` → `assertProfileComplete()` →
`assertRulesAccepted()`), sodass kein Schritt durch einen direkten Command-Aufruf (z. B.
`/onboarding`) umgangen werden kann - siehe `src/services/memberJourneyService.ts` fuer die
zentrale "welcher Schritt kommt als naechstes"-Logik.

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

## Teilnehmerprofil (Pflichtangaben)

Direkt nach der Verifizierung muss jedes Mitglied ein Pflichtprofil ausfuellen, bevor es mit
Onboarding oder Klassenwahl fortfahren kann (`src/services/memberProfileService.ts`):

1. **Vorname, Nachname, Alter** - per Discord-Modal (Button "Angaben machen"). Validierung:
   Namen nicht leer/max. 50 Zeichen, Alter eine ganze Zahl zwischen 14 und 99. Wird noch NICHT
   als abgeschlossen markiert.
2. **COMCAVE-Standort** - `/standort-waehlen standort:<Suche>`. Der Standort-Parameter nutzt
   Discord-**Autocomplete** (Suche nach Name/Stadt/PLZ, max. 25 Vorschlaege) statt einer festen
   Auswahlliste, da perspektivisch 300+ Standorte unterstuetzt werden sollen (siehe Abschnitt
   "COMCAVE-Standorte" unten).
3. Sobald beides vorliegt, setzt der Bot automatisch den **serverbezogenen Nickname** auf
   `Vorname Nachname` (`src/services/discordNicknameSync.ts`) - **niemals** den globalen
   Discord-Benutzernamen. Schlaegt das Setzen fehl (fehlende `ManageNicknames`-Berechtigung oder
   Server-Owner als Zielperson), wird das ohne Absturz uebersprungen und der restliche Flow laeuft
   trotzdem weiter.

`assertProfileComplete()` prueft bei jedem nachgelagerten Zugriff (Onboarding, Klassenwahl) frisch,
ob das Profil vollstaendig ist - ein direkter `/onboarding`-Aufruf vor Profilabschluss wird
fail-closed abgelehnt.

**Datenschutz:** Vorname/Nachname/Alter/Standort werden ausschliesslich auf `Member` gespeichert
(kein Geburtsdatum, nur die reine Alterszahl). Weder Audit-Log-Metadaten noch normale Logs oder
Fehlermeldungen enthalten diese Werte im Klartext - Audit-Eintraege (`member.profile_details_set`,
`member.location_set`, `member.profile_completed`) speichern ausschliesslich die Namen der
geaenderten Felder. Der zugeordnete Standort ist standardmaessig nur fuer Admins einsehbar (nicht
in `/wo-bin-ich` oder anderen fuer alle sichtbaren Ausgaben).

**Kontrollierte Korrektur:** `/mitglied-profil-bearbeiten mitglied:<@Mitglied> [vorname] [nachname]
[alter] [standort]` (nur Admins) - spaetere Aenderungen laufen bewusst nicht selbstbedienbar ueber
das Mitglied selbst, sondern nur administrativ, inkl. automatischer Nickname-Synchronisierung bei
einer Namensaenderung.

## COMCAVE-Standorte

Der Standort-Katalog (`ComcaveLocation`) ist **global**, nicht guild-gebunden - ein COMCAVE-Standort
ist ein realer, serverunabhaengiger Fakt (anders als Klasse A/B/C, die pro Discord-Server eigens
angelegt werden). Die Zuordnung eines Mitglieds zu einem Standort (`Member.locationId`) bleibt
dagegen ganz normal guild-/mitgliedsgebunden.

- Die Quelldatei (`data/locations/comcave-standorte.json`) enthaelt einen verifizierten Teilbestand
  von 226 echten COMCAVE-Standorten (Stadt + Bundesland, teils PLZ), ausschliesslich von
  [comcave.de/standorte](https://www.comcave.de/standorte) stammend - **keine** erfundenen oder aus
  Drittquellen ergaenzten Daten. Quelle, Erhebungsstand und Grenzen der Abdeckung (noch nicht alle
  300+ offiziellen Standorte) sind in `data/locations/README.md` dokumentiert; die Administration kann
  die Liste jederzeit um weitere offiziell verifizierte Standorte ergaenzen.
- Import/Aktualisierung ohne Codeaenderung: `/setup-standorte-importieren` (nur Admins) oder
  `npm run standorte:import`. Beide Wege sind idempotent (Upsert ueber einen stabilen `code`) und
  deaktivieren (nicht loeschen) Standorte, die in einer aktualisierten Datei fehlen - bestehende
  Mitglieder-Zuordnungen bleiben dadurch immer gueltig.
- Suche/Auswahl erfolgt ausschliesslich ueber Discord-Autocomplete (`/standort-waehlen`,
  `/mitglied-profil-bearbeiten`), nie ueber eine feste Dropdown-Liste (Discords Select-Menu-Limit
  liegt bei 25 Optionen).

## Serverregeln und Zustimmung

Nach dem Teilnehmerprofil, aber vor dem Onboarding, muss jedes Mitglied den aktuellen Serverregeln
ausdruecklich zustimmen (`src/services/ruleService.ts`):

- `/regelwerk-aktualisieren text:<...>` (nur Admins) legt eine **neue Version** an
  (`RuleSet.version`, fortlaufend) und deaktiviert dabei atomar die zuvor aktive Version - nie zwei
  aktive Versionen gleichzeitig. Eine bestehende Version wird nie nachtraeglich veraendert
  (Regelversionen sind unveraenderlich), damit eine historische Zustimmung immer nachvollziehbar
  bleibt.
- Jedes Mitglied sieht die aktuelle Version (automatisch im Eintrittsflow, jederzeit auch per
  `/regeln`) und bestaetigt per Button "Ich stimme den Regeln zu". Der Zustimmungsstatus
  (`RuleAcceptance`) haelt pro Mitglied+Version fest: **wann angezeigt** (`shownAt`), **ob und
  wann zugestimmt** (`acceptedAt`) und **zu welcher Version**.
- Ein Regelwerk-Update erzwingt automatisch eine erneute Zustimmung: eine neue Version hat
  zwangslaeufig noch keine Zustimmungszeile, wodurch `assertRulesAccepted()` (bei jedem
  nachgelagerten Zugriff frisch geprueft) erneut greift - kein manuelles Zuruecksetzen noetig.
- `/regelwerk-status` (nur Admins) zeigt die Zustimmungsquote zur aktuellen Version.
- Audit-Log (`rules.version_created`, `rules.accepted`) speichert nur die Versionsnummer, nie den
  Regeltext oder personenbezogene Werte.

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

## Berichtsheft, Tages- und Wochenberichte

Zweite klassenbezogene Fachfunktion nach demselben Muster wie Pruefungen/Termine - die Grundlage
fuer ein strukturiertes Berichtsheft je Klasse.

**📋 Tagesberichte:**

- `/tagesbericht-erstellen klasse:<A|B|C> datum:<TT.MM.JJJJ> themen:<...> lerninhalte:<...> hinweise:<...> [lernmaterialien:<...>]`
- `/tagesbericht-bearbeiten bericht-id:<...> [datum:<...>] [themen:<...>] [lerninhalte:<...>] [hinweise:<...>] [lernmaterialien:<...>]`
- `/tagesbericht-loeschen bericht-id:<...>`
- `/tagesberichte-anzeigen [klasse:<A|B|C>]` - ohne Angabe wird die eigene Klasse angezeigt

**📅 Wochenberichte:**

- `/wochenbericht-erstellen klasse:<A|B|C> kalenderwoche:<1-53> zeitraum-start:<TT.MM.JJJJ> zeitraum-ende:<TT.MM.JJJJ> themen:<...> lernfortschritt:<...> hinweise:<...>`
  (das Jahr wird automatisch aus `zeitraum-start` abgeleitet, kein separates Eingabefeld noetig)
- `/wochenbericht-bearbeiten bericht-id:<...> [kalenderwoche:<...>] [zeitraum-start:<...>] [zeitraum-ende:<...>] [themen:<...>] [lernfortschritt:<...>] [hinweise:<...>]`
  (Zeitraum-Start und -Ende muessen gemeinsam angegeben werden, wenn der Zeitraum geaendert werden soll)
- `/wochenbericht-loeschen bericht-id:<...>`
- `/wochenberichte-anzeigen [klasse:<A|B|C>]`

**📝 Berichtsheft:** `/berichtsheft-anzeigen [klasse:<A|B|C>]` zeigt Tages- und Wochenberichte einer
Klasse gemeinsam, chronologisch sortiert - die kombinierte Grundlage fuer eine spaetere
Export-/Ausgabefunktion (siehe ARCHITECTURE.md).

Zugriff und Audit-Logging funktionieren identisch zu Pruefungen/Terminen: Verwalten nur fuer Admin
oder die Klassenleitung der betroffenen Klasse (`assertClassManagementAccess()`, Klasse beim
Bearbeiten/Loeschen immer aus dem gespeicherten Datensatz aufgeloest), Lesen fuer jedes
verifizierte Mitglied der eigenen Klasse (`assertClassReadAccess()`). Protokolliert werden
`dailyReport.create`/`.update`/`.delete` bzw. `weeklyReport.create`/`.update`/`.delete`.

## 📚 Lernmaterial

Vierte klassenbezogene Fachfunktion nach demselben Muster - strukturiertes Lernmaterial je Klasse.

- `/lernmaterial-erstellen klasse:<A|B|C> titel:<...> beschreibung:<...> fach:<...> kategorie:<...> [url:<...>] [datei:<Anhang>] [verknuepfung-typ:<...>] [verknuepfung-id:<...>]`
- `/lernmaterial-bearbeiten material-id:<...> [titel:<...>] [beschreibung:<...>] [fach:<...>] [kategorie:<...>] [url:<...>] [datei:<Anhang>] [verknuepfung-typ:<...>] [verknuepfung-id:<...>]`
- `/lernmaterial-loeschen material-id:<...>`
- `/lernmaterial-anzeigen [klasse:<A|B|C>]` - ohne Angabe wird die eigene Klasse angezeigt, gruppiert nach Kategorie
- `/pruefung-lernmaterial pruefung-id:<...>` - umgekehrte Abfrage: zeigt alles Lernmaterial, das mit
  einer bestimmten Pruefung verknuepft ist. Dieselbe Leseberechtigung wie `/lernmaterial-anzeigen`
  (`assertClassReadAccess()` anhand der Klasse, zu der die Pruefung tatsaechlich gehoert) - eine
  manipulierte oder fremde Pruefungs-ID liefert nie Daten einer fremden Klasse/Guild.

**Kategorien** (zentral in `src/types/domain.ts` definiert, leicht erweiterbar):
🖥️ IT / Technik, 🌐 Netzwerke, 💻 Programmierung, 🗄️ Datenbanken, 🔐 IT-Sicherheit,
🎓 Allgemeine Pruefungsvorbereitung.

**Optionale Verknuepfung:** Lernmaterial kann optional mit einer Pruefung oder einem Tages-/
Wochenbericht **derselben Klasse** verknuepft werden (`verknuepfung-typ` + `verknuepfung-id`,
beide gemeinsam erforderlich). Eine Verknuepfung zu einem Datensatz einer anderen Klasse wird
serverseitig abgelehnt, auch wenn die ID gueltig ist.

Zugriff und Audit-Logging funktionieren identisch zu Pruefungen/Terminen/Berichten: Verwalten nur
fuer Admin oder die Klassenleitung der betroffenen Klasse (`assertClassManagementAccess()`, Klasse
beim Bearbeiten/Loeschen immer aus dem gespeicherten Datensatz aufgeloest), Lesen fuer jedes
verifizierte Mitglied der eigenen Klasse (`assertClassReadAccess()`). Protokolliert werden
`learningMaterial.create`/`.update`/`.delete`.

## 🗓️ Kursplan

Strukturierter Kursplan je Klasse, importiert aus einer versionierten Quelldatei (kein Live-Zugriff
auf die HTML zur Laufzeit - siehe "Import" unten). Aktuell liegt nur fuer **Klasse A** ein Kursplan
vor; die Architektur (Datenmodell, Import, Commands) ist bewusst klassen-generisch gehalten, damit
Klasse B/C spaeter eigene Daten erhalten koennen, ohne Code/Modell aendern zu muessen.

- `/kursplan [klasse:<A|B|C>]` (VERIFIED) - zeigt fuer die eigene (oder eine andere, sofern
  berechtigte) Klasse die aktuelle ISO-Kalenderwoche, den **aktuellen Kurs** (falls das heutige
  Datum in einem Kurszeitraum liegt, sonst ein ausdruecklicher "kein Kurs"-Hinweis) sowie den
  **naechsten anstehenden Kurs**. Ist fuer die Klasse noch kein eigener Kursplan vorhanden (aktuell
  B/C), erscheint statt Daten von Klasse A ein klarer Status-Hinweis: "Fuer deine Klasse liegt
  aktuell noch kein eigener Kursplan vor", dass der A-Kursplan nur Vorschau/Beispiel und fuer B/C
  **nicht verbindlich** ist, sowie der Hinweis, sich an Klassenleitung/OverHead zu wenden.
- Zum aktuellen Kurs erscheint ein **"Kenntnis genommen"**-Button (nur solange noch nicht
  bestaetigt) - ein Klick speichert Mitglied, Klasse, Kurs und Zeitpunkt. Ein erneuter Klick erzeugt
  keine zweite Bestaetigung (eindeutig durch einen DB-Constraint pro Kurs+Mitglied).
- `/kursplan-status klasse:<A|B|C>` (KLASSENLEITUNG/Admin) - zeigt aktuellen/naechsten Kurs sowie,
  wer die Kenntnisnahme des aktuellen Kurses bereits bestaetigt hat und wer noch aussteht.
  Klassenleitung darf ausschliesslich die eigene Klasse abfragen (`assertClassManagementAccess()`).
- `/kursplan-importieren klasse:<A|B|C>` (nur Admins) - importiert/aktualisiert die Kursdaten einer
  Klasse aus ihrer versionierten Quelldatei. Fuer Klassen ohne hinterlegte Quelle (aktuell B/C)
  schlaegt der Befehl kontrolliert mit einer Fehlermeldung fehl, statt versehentlich Daten einer
  anderen Klasse zu verwenden.

**Import:** `data/course-plans/0002_KALENDER_ABLAUF_KW_preview.html` ist die versionierte
Quelldatei fuer Klasse A. Ein regexbasierter Parser (bewusst kein `eval()`) extrahiert daraus
Kursnummer/Titel/Zeitraum/Dozent sowie besondere/unterrichtsfreie Termine unveraendert - es werden
keine Daten erfunden oder ergaenzt. Der Import ist idempotent: derselbe Kurs-Slot (Klasse +
Kursnummer + Startdatum) wird bei einem erneuten Import erkannt und aktualisiert statt dupliziert.
Reproduzierbarer CLI-Weg: `npm run course-plan:import -- <guildId> <actorDiscordId> [klasse=A]`.

**7-Tage-Hinweis:** Bei jedem Bot-Start prueft der Bot automatisch, ob fuer eine Klasse ein neuer
Kurs innerhalb der naechsten 7 Tage beginnt, und postet in dem Fall einen Hinweis in die
Klassen-Ankuendigungen (`Class.announcementChannelId`, falls konfiguriert). Pro Kurs+Klasse wird das
nur einmal ausgeloest (per DB-Constraint) - wiederholte Bot-Starts erzeugen keine doppelten Hinweise.

### Kursinhalte

Zusaetzlich zum Zeitplan (oben) gibt es einen separaten, globalen Katalog der eigentlichen
**Lerninhalte** je Kurs (`CourseContentItem`), importiert aus `data/course-plans/kursinhalte.json`
(strukturierte Extraktion des eCampus-Kursinhalte-PDFs - Quelle, Datenmodell und die Verknuepfung
zum Kursplan sind in `data/course-plans/README.md` dokumentiert). Verknuepfung zum Kursplan erfolgt
ausschliesslich ueber die gemeinsame Kursnummer (`courseNumber`), nicht per Fremdschluessel, da ein
Kurs-Slot (`CourseEntry`) pro Klasse dupliziert wird, waehrend der Inhalt genau einmal global gilt.

- Reproduzierbarer CLI-Import: `npm run kursinhalte:import`.
- Noch OHNE eigene Discord-UI/-Commands (bewusst, siehe Aufgabenstellung) - die Daten sind bereits
  ueber `src/services/courseContentService.ts` (`getCourseContentForEntry()`/
  `getCourseContentByCourseNumber()`) abrufbar und fuer eine spaetere Erweiterung von `/kursplan`
  vorbereitet.
- Enthaelt aktuell **34 Kurse** und **592 hierarchisch nummerierte Inhaltseintraege** (9 Kurse ohne
  Inhalte in der Quelle - z. B. Betriebliche Praxisphasen - bleiben konsequent ohne Eintraege statt
  kuenstlich aufgefuellt zu werden).

## Lerngruppen

Temporaere, klassenbezogene Lern-/Arbeitsgruppen (nicht zu verwechseln mit der "Lerngruppe" im Sinne
der gesamten COMCAVE-Kohorte aus der Einleitung oben) - Mitglieder einer Klasse koennen sich fuer
gemeinsames Lernen zu einer Gruppe zusammenschliessen.

- `/lerngruppe-erstellen name:<...> [teilnehmerlimit:<Zahl>] [klasse:<A|B|C>]` (VERIFIED) - gruendet
  eine Gruppe fuer die eigene (oder eine andere, sofern berechtigte) Klasse; die Ersteller:in wird
  automatisch erstes Mitglied. Optionales Teilnehmerlimit (1-100) wird serverseitig durchgesetzt.
- `/lerngruppen-anzeigen [klasse:<A|B|C>]` (VERIFIED) - listet die aktiven Gruppen der eigenen Klasse
  inkl. Teilnehmerzahl und ID (fuer Beitreten/Verlassen/Schliessen) sowie einen Hinweis auf den
  gemeinsamen Klassen-Sprachkanal.
- `/lerngruppe-beitreten gruppe-id:<...>` / `/lerngruppe-verlassen gruppe-id:<...>` (VERIFIED) -
  Selbstbedienung; ein erneuter Beitritt erzeugt keine doppelte Mitgliedschaft.
- `/lerngruppe-schliessen gruppe-id:<...>` (VERIFIED, tatsaechliche Berechtigung serverseitig
  geprueft) - erlaubt fuer die Ersteller:in der Gruppe, die Klassenleitung der betroffenen Klasse
  oder Admin. Eine bereits geschlossene Gruppe kann nicht erneut geschlossen oder sonst veraendert
  werden (Beitreten/Verlassen/Mitgliederverwaltung schlagen danach kontrolliert fehl).
- `/lerngruppe-status klasse:<A|B|C>` (KLASSENLEITUNG/Admin) - Verwaltungssicht: alle Gruppen (aktiv
  und geschlossen) der Klasse inkl. vollstaendiger Mitgliederliste.
- `/lerngruppe-mitglied-entfernen gruppe-id:<...> mitglied:<@Person>` (KLASSENLEITUNG/Admin) -
  Moderationsaktion: entfernt ein Mitglied aus einer Gruppe der eigenen Klasse.

**Voice-Konzept:** Lerngruppen bekommen bewusst **keinen eigenen, dynamisch angelegten Voice-Kanal**.
Der bereits vorhandene Klassen-Sprachkanal (`Class.voiceChannelId`, eingerichtet per
`/setup-klassenbereiche`) steht ohnehin allen Mitgliedern der Klasse offen - ein zusaetzlicher
Kanal pro Gruppe waere unnoetige Komplexitaet (Kanal-Lifecycle, verwaiste Kanaele bei einem
Bot-Absturz, Discord-Kanal-Limits) ohne echten Mehrwert. `/lerngruppen-anzeigen` verweist lediglich
auf diesen gemeinsamen Kanal.

## Admin-/Moderator-Rollen

`adminRoleId`/`moderatorRoleId` (siehe `GuildConfig` in `prisma/schema.prisma`) waren bereits Teil
des Datenmodells und wurden in `/konfiguration` angezeigt, konnten aber ueber keinen Befehl gesetzt
werden - `isServerAdmin()` (`src/permissions/checkPermission.ts`) wertet `adminRoleId` bereits aktiv
aus, die Rolle liess sich in der Praxis aber gar nicht konfigurieren.

- `/setup-admin-rollen admin-rolle:<Rolle> [moderator-rolle:<Rolle>]` (nur Admins) - setzt
  `adminRoleId` (und optional `moderatorRoleId`). Wird `moderator-rolle` weggelassen, bleibt ein
  bereits gesetzter Wert unveraendert (wie beim Kanal-Parameter von `/setup-verifizierung`).
- Beide Rollen werden wie Verifiziert-/Klassenrollen gegen Administrator-Rechte geprueft
  (`roleHasAdministrator()`) und bei einem Treffer abgelehnt - eine Rolle, die den Bot zum
  Admin macht, darf nicht gleichzeitig eine zweite, unkontrollierte Rechtequelle sein.
- **`moderatorRoleId` ist aktuell reine Konfiguration ohne Wirkung.** Es gibt noch keine
  `PermissionLevel.MODERATOR` und keine Moderationsfunktionen (Kick/Mute/Warn o.ae. existieren
  nicht) - das Feld ist im Schema als Vorbereitung fuer eine spaetere Moderationsfunktion angelegt
  (siehe Schema-Kommentar), wird von `checkPermission.ts` aber bewusst noch nirgends ausgewertet.
  Ein Mitglied mit ausschliesslich dieser Rolle hat dieselben Rechte wie jedes andere verifizierte
  Mitglied.
- Ohne konfigurierte `adminRoleId` bleibt die Rolle als Admin-Quelle inaktiv (fail-closed) - globale
  Admin-Rechte kommen dann weiterhin nur ueber den Server-Owner oder echte Discord-"Administrator"-
  Berechtigung zustande.

## Audit-Log-Anzeige

- `/audit-log [seite:<Zahl>] [aktion:<...>] [nutzer:<@Mitglied>]` (nur globale Admins) - zeigt das
  Audit-Log dieses Servers, neueste Eintraege zuerst, paginiert zu 10 Eintraegen pro Seite. Optional
  nach exakter Aktion (z. B. `class.setup`) und/oder ausfuehrendem Mitglied filterbar.
- Zugriff ist strikt auf globale Admins beschraenkt (`isServerAdmin()`, sowohl ueber
  `permissionLevel: ADMIN` am Command als auch zusaetzlich in `auditLogService.ts` selbst geprueft)
  - Klassenleitung hat **keinen** Zugriff, auch nicht auf Eintraege der eigenen Klasse.
  - Jede Anzeige ist strikt auf die aktuelle Guild beschraenkt (`guildConfig.id`), es werden nie
    Eintraege einer anderen Guild angezeigt.
  - Zeigt pro Eintrag Zeitpunkt, Aktion, ausfuehrenden und (falls vorhanden) betroffenen Nutzer,
    die betroffene Klasse (best-effort aus den Metadaten ausgelesen) sowie die restlichen Metadaten.

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
npm run standorte:import  # COMCAVE-Standort-Katalog aus der Quelldatei importieren
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
                                     dailyReportService.ts / weeklyReportService.ts
                                     (Tages-/Wochenberichte), berichtsheftService.ts (kombinierte
                                     Berichtsheft-Sicht), learningMaterialService.ts
                                     (Lernmaterial), discordRoleSync.ts (gemeinsame
                                     Rollenvergabe-Fehlerbehandlung), memberProfileService.ts
                                     (Teilnehmerprofil), discordNicknameSync.ts
                                     (Nickname-Synchronisierung), locationImportService.ts
                                     (COMCAVE-Standort-Import), ruleService.ts (Regelwerk/
                                     Zustimmung), memberJourneyService.ts (zentrale
                                     "naechster Schritt"-Logik des Eintrittsflows)
  types/                              Gemeinsame TypeScript-Typen
  utils/                                Logger, Fehlerklassen, dateTime.ts (Datum/Uhrzeit-Parsing)
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
- **Zusaetzliche Bot-Permission `ManageNicknames` ("Nicknames verwalten")** wird fuer die
  automatische Nickname-Synchronisierung im Teilnehmerprofil benoetigt
  (`GuildMember.setNickname()` erfordert diese Berechtigung, um den Nicknamen eines ANDEREN
  Mitglieds zu setzen). Fehlt sie, wird das ueber `trySetNickname()`
  (`src/services/discordNicknameSync.ts`) abgefangen - der restliche Eintrittsflow laeuft dann
  ohne Nickname-Aenderung weiter, kein Absturz.
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
- `/setup-verifizierung` verweigert ebenso Rollen mit Administrator-Berechtigung als
  Verifiziert-Rolle, da diese Rolle automatisch und ohne Pruefung an jedes neue Mitglied vergeben
  wird.
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
- Tages-/Wochenberichte (Berichtsheft) verwenden dieselben zwei zentralen Funktionen nach
  demselben Muster: `report.classId` -> `getClassById()` bestimmt beim Bearbeiten/Loeschen immer
  die tatsaechliche Klasse, nie ein vom Aufrufer angegebener Klassenname. Kalenderwoche (1-53,
  ganzzahlig) und Zeitraum (Ende darf nicht vor dem Beginn liegen) werden serverseitig validiert,
  bevor ein Wochenbericht gespeichert wird.
- Lernmaterial verwendet dieselben zwei zentralen Funktionen nach demselben Muster
  (`material.classId` -> `getClassById()` beim Bearbeiten/Loeschen). Eine optionale Verknuepfung
  mit einer Pruefung oder einem Bericht wird zusaetzlich serverseitig geprueft: der referenzierte
  Datensatz muss existieren UND zur selben Klasse gehoeren wie das Lernmaterial selbst - eine
  manipulierte Verknuepfungs-ID, die auf eine fremde Klasse zeigt, wird abgelehnt. Die Kategorie
  wird gegen eine feste, zentral gepflegte Liste validiert. Wird eine verknuepfte Pruefung bzw. ein
  verknuepfter Tages-/Wochenbericht geloescht, wird die Verknuepfung (`linkedType`/`linkedId`) auf
  jedem betroffenen Lernmaterial automatisch aufgeloest, damit keine verwaisten Verweise stehen
  bleiben (`clearLearningMaterialLinksTo()`).
- `/pruefung-lernmaterial` (Reverse-Lookup) loest die Pruefung immer per `guildConfig.id` auf
  (`getExamById()`) und prueft den Lesezugriff ueber dieselbe `assertClassReadAccess()`-Funktion wie
  `/lernmaterial-anzeigen` - eine manipulierte oder aus einer fremden Guild stammende Pruefungs-ID
  liefert nie Treffer.
- `/setup-admin-rollen` prueft beide Rollen (Admin und optional Moderator) gegen Administrator-
  Rechte (`roleHasAdministrator()`) und lehnt sie in dem Fall ab - dasselbe Muster wie bei
  `/setup-klassen`/`/setup-verifizierung`. `moderatorRoleId` ist aktuell reine Konfiguration ohne
  Wirkung (siehe Abschnitt "Admin-/Moderator-Rollen" oben) und verleiht daher auch keine
  zusaetzlichen Rechte.
- `/audit-log` ist ausschliesslich globalen Admins vorbehalten (`isServerAdmin()`, sowohl per
  `permissionLevel: ADMIN` am Command als auch zusaetzlich in `auditLogService.ts` selbst geprueft) -
  Klassenleitung und normale Mitglieder erhalten keinen Zugriff, auch nicht auf Eintraege der
  eigenen Klasse. Alle Abfragen sind strikt nach `guildConfig.id` gescoped.
- Kursplan verwendet dieselben zentralen Funktionen wie alle anderen klassenbezogenen
  Fachfunktionen: `assertClassReadAccess()` fuer `/kursplan` und die Kenntnisnahme
  (`acknowledgeCourseEntryForMember()` loest den Kurs immer per `guildConfig.id` auf - eine
  manipulierte oder fremde Kurs-ID liefert nie Zugriff auf eine andere Klasse/Guild), sowie
  `assertClassManagementAccess()` fuer `/kursplan-status` (Klassenleitung B kann damit niemals den
  Status/die Kenntnisnahme-Liste von Klasse A einsehen). Der Import (`/kursplan-importieren`) ist
  bewusst strikter als das uebliche Klassenleitung-oder-Admin-Muster: nur `isServerAdmin()` darf
  Kursdaten importieren, da es sich um offizielle, von der Administration uebermittelte Daten
  handelt. Ein Mitglied ohne Klassenzuordnung (unverifiziert oder noch keine Klasse gewaehlt) erhaelt
  fail-closed eine `PermissionError`/`ValidationError` statt Kursplan-Inhalten - dieselbe Ableitung
  wie bei Pruefungen/Terminen/Lernmaterial, keine zusaetzliche Sonderpruefung.
- Lerngruppen loesen Klasse/Guild immer aus dem gespeicherten `group.classId` auf (nie aus einem
  Aufrufer-Parameter): Beitreten/Verlassen/Erstellen pruefen `assertClassReadAccess()`, Schliessen/
  Mitgliederverwaltung pruefen `assertClassManagementAccess()` - eine manipulierte oder aus einer
  fremden Guild stammende Gruppen-ID liefert nie Zugriff auf eine andere Klasse. Einzige Erweiterung
  gegenueber dem Standard-Muster: die Ersteller:in einer Gruppe darf sie zusaetzlich selbst
  schliessen (`isServerAdmin() || isClassLeadOf() || istErstellerin`) - Klassenleitung B bleibt davon
  unberuehrt und kann weiterhin niemals eine Gruppe der Klasse A schliessen oder deren Mitglieder
  verwalten. Ein Teilnehmerlimit wird serverseitig durchgesetzt (nicht nur als Anzeige), und jede
  mutierende Aktion auf einer bereits geschlossenen Gruppe wird kontrolliert abgelehnt.
