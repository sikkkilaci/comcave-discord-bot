# PROJECT_STATE.md — Kurzstatus (Stand: 2026-09-22, Commit `9bfeb77`, Branch `claude/great-albattani-q7cy9o`)

## Produktziel

Digitale Lern-/Unterstützungsplattform für die COMCAVE-Umschulung zum/zur Fachinformatiker/in (Systemintegration/Anwendungsentwicklung) auf Discord. Fachliches Modell: Ausbildungsplan → aktuelles Thema → Kursinhalt → Lernmaterial → Selbsttest → erkannte Schwäche → Wiederholung → historische Prüfungsrelevanz (IHK-Analyse als Evidenz, **nicht** Vorhersage) → individueller Lernfokus.

## Technischer Stand (Repository)

- 54 Commits, TypeScript/discord.js v14/Prisma+SQLite, 632 Tests zuletzt grün (Stand Commit `b4f6b72`, nicht in dieser Sitzung erneut ausgeführt).
- Alle fachlichen Kernsysteme (siehe PROJECT_HANDOVER.md) sind im Code vollständig implementiert: Verifizierung, Profil/Standort/Fachrichtung, Klassenwahl+Bestätigung, Onboarding-Fragebogen, Regelwerk, Klassenbereiche, Klassenleitung, Prüfungen/Termine, Berichtsheft, Lernmaterial, Lerngruppen, Kursplan (nur Klasse A), Kursinhalte-Katalog (592/34), Standortkatalog (226), Audit-Log, Server-Bootstrap.

## Aktueller Discord-Stand (realer Zielserver, per Screenshot bestätigt nach `/setup-server`)

- Kategorien 01–08 vorhanden. Klassenbereiche A/B/C vorhanden.
- **🏫 Schulhof fehlt auf dem realen Zielserver laut Screenshot.** Der Code erzeugt ihn korrekt. Die Ursache ist derzeit nicht abschließend festgestellt.
- Weitere Discord-Punkte (Berechtigungen im Detail, Nachrichten-Zustände) auf dem realen Server **nicht** einzeln geprüft — Repo-Code ist kein Beweis für Discord-Zustand.

## Bekannte Soll/Ist-Abweichung (Code, bestätigt)

Die Klassenrolle (und damit Sichtbarkeit/Zugriff auf den privaten Klassenbereich: Chat, Ankündigungen, Termine, Prüfungen, Berichtsheft, Lernmaterial) wird bereits bei **Schritt 6 „Klassenbestätigung“** vergeben (`classService.assignClass()`, geprüft auch in `assertClassReadAccess()`), nicht erst nach vollständigem Abschluss (Schritt 9 „Mitglied“). Das widerspricht dem Zielmodell „vor vollständigem Abschluss nur Schulhof“.

## Datenbestände

- **Kursinhalte**: 592 Einträge / 34 Kurse, strukturiert, importiert, getestet — fertig.
- **Standorte**: 226 COMCAVE-Standorte, importiert — fertig.
- **IHK-Prüfungsanalyse**: durchgeführt (722 PDFs, FISI 425/FIAE 175/WISO 16/Kernquali 4/Sonstige 91, Themen-Taxonomie, historische Auswertung 1999–2024). Artefakte lagen nur im ephemeren Scratchpad — im Rahmen dieser Übergabe nach `data/ihk-analysis/` gesichert (siehe PROJECT_HANDOVER.md, Abschnitt IHK-Analyse).

## Nächster sinnvoller Schritt

1. Ursache für den fehlenden Schulhof auf dem Zielserver klären, dann `/setup-server` erneut ausführen und die Schulhof-Erzeugung verifizieren.
2. Entscheiden, ob die Klassenrollen-Vergabe auf „erst nach Mitglied“ umgestellt werden soll (Architekturentscheidung, aktuell nicht umgesetzt).
3. IHK-Analyse-Ergebnisse fachlich mit Ausbildungsplan/Kursinhalten verknüpfen (aktuell keine Verknüpfung vorhanden).
