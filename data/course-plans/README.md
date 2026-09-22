# Kursplan-/Kursinhalte-Quelldateien

Dieses Verzeichnis enthaelt die versionierten Quelldateien fuer zwei getrennte,
aber ueber die Kursnummer (`courseNumber`/`courseId`) lose verknuepfte
Datensaetze:

- **Kursplan (Termine/Zeitplan):** `0002_KALENDER_ABLAUF_KW_preview.html` -
  Kurs-Slots (Kursnummer, Titel, Trainer, Start-/Enddatum) je Klasse, siehe
  `src/services/coursePlanImportService.ts`. Bisher nur fuer Klasse A
  hinterlegt (`COURSE_PLAN_SOURCE_FILES`).
- **Kursinhalte (Lerninhalte):** `kursinhalte.json` - die vollstaendigen,
  hierarchisch nummerierten Lerninhalte je Kurs, siehe
  `src/services/courseContentImportService.ts`.

## Kursinhalte (`kursinhalte.json`)

### Quelle

- **Ausgangsquelle:** ein vom Nutzer bereitgestelltes eCampus-PDF
  (`kursinhalte.pdf`) mit der Kursuebersicht und den Kursinhalten des
  Ausbildungsplans.
- **Importweg:** Der Nutzer hat das PDF ausserhalb dieser Umgebung bereits zu
  einer strukturierten JSON-Datei extrahiert (Kursmetadaten und nummerierte
  Kursinhalte, Zeilenumbrueche innerhalb eines Inhalts zusammengefuehrt,
  keine fehlenden Inhalte durch allgemeines Wissen ergaenzt - siehe die
  `extractionNotes` am Anfang von `kursinhalte.json`) und diese Datei
  unveraendert als `kursinhalte.json` in dieses Verzeichnis uebernommen. Der
  Bot selbst liest **ausschliesslich** diese JSON-Datei ein.
- **Warum nicht das Roh-PDF als Laufzeitquelle?** Ein PDF ist kein
  maschinell zuverlaessig strukturiertes Format - Layout, Spalten- und
  Seitenumbrueche muessten bei jedem Import erneut interpretiert werden, mit
  dem Risiko einer stillschweigend abweichenden Extraktion zwischen zwei
  Laeufen (nicht deterministisch, nicht diffbar, keine sinnvolle
  Versionierung in Git). Die bereits extrahierte, strukturierte JSON-Datei
  ist dagegen deterministisch parsebar, versionierbar und exakt das, was
  tatsaechlich importiert wird - dasselbe Prinzip wie bei der HTML-Kursplan-
  Quelle (dort wird ebenfalls eine bereits strukturierte Quelldatei statt
  eines Original-Exports/Screenshots eingelesen).
- **Keine Inhalte veraendert:** Der Bot-Import uebernimmt Kurstitel und
  Kursinhalte **woertlich** aus `kursinhalte.json` - keine Umformulierung,
  Korrektur oder Ergaenzung, auch nicht bei erkennbaren Extraktions-
  Artefakten der Quelle (z. B. ein in einen Inhaltstext hineingerutschter
  Seitenumbruch-Hinweis). Ein Kurs ohne Kursinhalte in der Quelle
  (`contentItems: []`) bleibt konsequent ohne Eintraege - es wird nichts
  kuenstlich aufgefuellt.

### Datenmodell

- Neues Modell `CourseContentItem` (siehe `prisma/schema.prisma`) - ein Row
  je einzelnem, nummerierten Inhaltseintrag (nicht ein JSON-Blob pro Kurs):
  `courseNumber`, `courseTitle`, `orderIndex` (Position in Quellreihenfolge),
  `numberPath` (rekonstruierter hierarchischer Pfad, z. B. `"1.2.3"`),
  `level` (Hierarchietiefe von `numberPath`), `text` (Inhaltstext ohne
  fuehrende Nummerierung), `sourceFile`.
- Bewusst **global** wie `ComcaveLocation`, nicht guild-/klassen-gescoped:
  der Inhalt eines Kurses ist ein von Klasse/Guild unabhaengiger Fakt.
- **Hierarchie-Rekonstruktion:** Die Quelle nummeriert jede Ebene fuer sich
  neu beginnend bei 1 (kein durchgehender Pfad wie `"1.2.3"` im Rohtext) -
  `reconstructCourseContentHierarchy()` in `courseContentImportService.ts`
  leitet die tatsaechliche Tiefe deterministisch aus der Zahlenfolge her
  (fortlaufende Zahl = Geschwisterknoten auf derselben Ebene, Zahl 1 nach
  einem tieferen/gleichen Knoten = neue, tiefere Ebene). Diese Regel wurde
  gegen alle 592 Eintraege der realen Quelldatei verifiziert (keine
  Abweichung); ein nicht einordenbarer Eintrag bricht den Import ab, statt
  eine geratene Tiefe zu uebernehmen.
- **Start-/Enddatum werden bewusst NICHT gespeichert** - Terminplanung
  bleibt exklusiv Aufgabe der bestehenden `CourseEntry`/Kursplan-Architektur
  (siehe oben), damit keine zweite, potenziell abweichende Datumsquelle
  entsteht.

### Zuordnung zum bestehenden Kursplan

Die Verknuepfung zu `CourseEntry` (dem bestehenden Kursplan-Modell) erfolgt
**ausschliesslich ueber die gemeinsame Kursnummer** (`courseNumber` bei
`CourseContentItem` = `courseId` aus `kursinhalte.json` = `courseNumber` bei
`CourseEntry`, aus der HTML-Kursplan-Quelle) - bewusst **kein** Fremdschluessel,
da `CourseEntry` pro Klasse/Guild dupliziert wird (dieselbe Kursnummer kann in
mehreren Klassen mit unterschiedlichem Start-/Enddatum auftauchen), waehrend
der Inhalt genau einmal global im Katalog liegt. `src/services/
courseContentService.ts` stellt dafuer `getCourseContentForEntry(entry)` (aus
einem vorhandenen `CourseEntry`) sowie `getCourseContentByCourseNumber(...)`
(direkt per Kursnummer, auch ohne vorhandenen `CourseEntry`) bereit. Beide
Importe (Kursplan/Termine und Kursinhalte) sind unabhaengig voneinander lauf-
und wiederholbar und beeinflussen sich nicht gegenseitig.

Pruefungsvorbereitungskurse (z. B. "Vorbereitung schriftliche Pruefung Teil
1/2") sind in der Quelle normale Kurse mit `courseId`/`contentItems` und
werden dementsprechend genau wie jeder andere Kurs importiert - keine
Sonderbehandlung.

### Import

- Kommandozeile: `npm run kursinhalte:import`
- Discord: bewusst noch KEIN eigener Admin-Command registriert (siehe
  "Discord-Anbindung" unten) - `importCourseContentAsAdmin()` in
  `courseContentImportService.ts` ist bereits ADMIN-only abgesichert und
  einsatzbereit, sobald ein Command dafuer angelegt wird.

Der Import ist idempotent und deterministisch: pro Kurs werden die
Inhaltseintraege vollstaendig ersetzt (`replaceCourseContentForCourse()` in
`courseContentRepository.ts`) - ein wiederholter Import mit unveraenderter
Quelle erzeugt keine Duplikate, ein geaenderter Kurs wird aktualisiert und
weggefallene Eintraege werden entfernt (kein FK von anderen Modellen auf
`CourseContentItem`, daher ist Loeschen hier - anders als beim Standort-
Katalog - unbedenklich).

### Discord-Anbindung

- `/kursinhalte` (Klasse, VERIFIED) zeigt die Gliederung eines einzelnen
  Kurses als private Antwort.
- `/setup-kurskategorien` (nur Admins, siehe `src/services/
  courseCategoryService.ts`) richtet je Kurs des Katalogs eine eigene, fuer
  alle vollstaendig onboardeten Mitglieder sichtbare Discord-Kategorie mit
  einem Kanal (`📄-kursinhalte`) ein - Titel, Zeitraum und die vollstaendige
  Kursgliederung sind damit dauerhaft und oeffentlich in Discord sichtbar,
  nicht nur ueber einen Pull-Befehl. Bewusst **eine Kategorie je Kurs** statt
  je Kalenderwoche: ueber eine mehrjaehrige Ausbildung waere Letzteres nicht
  durch Discords Limit von ca. 50 Kategorien pro Server gedeckt, Ersteres
  bleibt fest bei der Anzahl der importierten Kurse (aktuell 34). Start-/
  Enddatum werden dafuer frisch aus `kursinhalte.json` gelesen
  (`loadCourseSchedule()`/`parseCourseSchedule()` in
  `courseContentImportService.ts`) - die DB speichert weiterhin keine Termine
  (siehe oben). Ein Kurs gilt als klausurrelevant, wenn einer seiner
  Kursinhalte (nach Entfernen der Nummerierung) mit "Klausur" beginnt, und
  wird dann mit ⚠️ im Kategorienamen sowie einem Hinweisfeld markiert. Der
  Befehl ist vollstaendig idempotent: ein erneuter Lauf legt nichts doppelt
  an, aktualisiert aber Berechtigungen, Kategorienamen (z. B. bei neu
  erkannter Klausur) und den Inhalt der bereits geposteten Nachricht.
- **Bekannte Luecke:** Der Kurs "Vorbereitung auf eine medieninformations-
  technische Umschulung" (17.04.2026 - 19.06.2026) ist bisher NICHT Teil von
  `kursinhalte.json` und erscheint daher weder im Katalog noch unter den
  Kurs-Kategorien - er muesste zuerst analog zu den anderen 34 Kursen
  strukturiert erfasst und importiert werden.

### Keine personenbezogenen Daten

`kursinhalte.json` und `CourseContentItem` enthalten ausschliesslich
Kurs-Stammdaten (Kursnummer/-titel/-inhalte), keine Teilnehmerdaten. Der
Import-Audit-Log-Eintrag (`courseContent.import`) enthaelt nur Zaehlwerte
(Anzahl Kurse/Eintraege), keine Inhalte.
