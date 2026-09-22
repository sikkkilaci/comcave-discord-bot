# TASKS.md

Nur echte Produkt-/Projektaufgaben. Bugfixes/Reparaturen (TypeScript-, Lint-, CI-, Build-, Race-Condition-, Permission-Fixes) sind **nicht** einzeln als Produktaufgaben gelistet — sie stecken bereits im aktuellen, funktionierenden Code (siehe PROJECT_HANDOVER.md, Abschnitt „Reparaturen").

## AKTUELL

- Erweiterte Tests für den zweistufigen Klassenauswahl-Flow (Klassenübersicht + Bestätigungs-Screen) fertigstellen und volle Verifikation (Test/Lint/Format/Typecheck/Build) abschließen.

## ALS NÄCHSTES

- Ursache für den auf dem Zielserver fehlenden 🏫 Schulhof klären (siehe PROJECT_STATE.md) und danach `/setup-server` erneut ausführen.
- Architekturentscheidung treffen und umsetzen: Klassenrolle/Klassenbereichs-Zugriff erst nach vollständigem Onboarding-Abschluss (Rolle „Mitglied") statt bereits bei Klassenbestätigung vergeben.
- IHK-Analyseergebnisse dauerhaft und dokumentiert im Repository halten (Grundsicherung in dieser Übergabe erledigt, siehe `data/ihk-analysis/`) und fachlich mit Ausbildungsplan/Kursinhalten verknüpfen (aktuell keine Verknüpfung).

## SPÄTER

- Kursplan-Datenquelle für Klasse B/C ergänzen (aktuell nur Klasse A hat echte Kursplan-Daten).
- Die strukturell bereits angelegten, aber inhaltlich leeren Plattformkanäle mit echter Bot-Logik hinterlegen: Lern-Cockpit, Selbsttests, Lernfortschritt-Tracking, Prüfungs-Cockpit, Prüfungsvorbereitung, Prüfungsfragen, Fragen-und-Antworten, Wichtige Informationen, Heute, Austausch, Projekte.
- Fachliche Verknüpfung „historische Prüfungsrelevanz → individueller Lernfokus" (Ausbildungsplan/Kursinhalt/Lernmaterial/Selbsttest/IHK-Themenhäufigkeit) als zusammenhängendes Feature konzipieren und umsetzen.

## BLOCKIERT

- Keine bekannten blockierten Aufgaben.

## ERLEDIGT

- Verifizierung neuer Mitglieder (Service, Button, Commands, Audit-Log).
- Teilnehmerprofil (Name/Alter), COMCAVE-Standorte (226, Suche, Import), Fachrichtungswahl.
- Klassenwahl A/B/C inkl. Einmal-Sperre, Admin-Override (`/mitglied-klasse-aendern`), zweistufige Bestätigung mit Teilnehmerübersicht, Race-Condition-Schutz.
- Private Klassenbereiche je Klasse (Kanäle + Berechtigungen) und Klassenleitung (klassenbezogene Admin-Rechte ohne globale Admin-Rechte).
- Onboarding-Fragebogen (dynamisch, IT-Erfahrung/Interessen).
- Regelwerk mit Versionierung und Zustimmungspflicht.
- Vollständiges Zugangs-Gate (Verifizierung → Profil → Standort → Fachrichtung → Klasse → Bestätigung → Onboarding → Regeln → Mitglied) inkl. Schulhof-Konzept im Code.
- Globale COMCAVE-Plattformstruktur (8 Kategorien, Kanalgerüst) im Code angelegt.
- Prüfungen und Termine (klassenbezogen), Berichtsheft (Tages-/Wochenberichte), Lernmaterial (klassenbezogen, mit Prüfungsbezug), Lerngruppen (klassenbezogen, mit Voice-Kanal).
- Kursplan-Modul für Klasse A (Import, aktueller/nächster Kurs, Kenntnisnahme, 7-Tage-Hinweis).
- Kursinhalte-Katalog (592 Einträge/34 Kurse, aus eCampus-Extraktion importiert).
- Admin-/Moderator-Rollen konfigurierbar, zentrales Audit-Log mit `/audit-log`.
- Zentraler `/setup-server`-Bootstrap-Befehl (Rollen, globale Struktur, Klassenbereiche in einem Schritt).
- Historische IHK-Prüfungsanalyse durchgeführt (722 PDFs klassifiziert, Themen-Taxonomie, Häufigkeitsauswertung 1999–2024).
