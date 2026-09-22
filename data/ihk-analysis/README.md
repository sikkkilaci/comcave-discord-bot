# IHK-Prüfungsanalyse — gesicherte Ergebnisse

Diese Ergebnisse wurden aus dem temporären Scratchpad einer früheren Sitzung gesichert (Analyse ursprünglich durchgeführt am 21.09.2026). Details siehe `PROJECT_HANDOVER.md`, Abschnitt 15.

## Enthalten
- `classification.json` — Zuordnung der 722 IHK-Prüfungsdateien zu Kategorien (FISI/FIAE/WISO/Kernqualifikationen/Sonstige), nur Dateinamen/Pfade + Kategorie.
- `topic_results.json` — Themenhäufigkeit je Analysestufe (FISI historisch 1999–2024, FISI/FIAE AO2020, WISO, Kernqualifikationen).
- `analysis_records.json` — Rohdatensätze je Dokument (Metadaten, keine Volltexte).
- `scripts/` — die verwendeten Python-Skripte (Extraktion, Klassifikation, Themen-Taxonomie, Auswertung) für Nachvollziehbarkeit/Reproduzierbarkeit.

## Bewusst NICHT enthalten
- Original-PDFs und extrahierte Volltexte der IHK-Prüfungen (Vervielfältigungsverbot, siehe `PROJECT_HANDOVER.md` Abschnitt 14).
- `analysis_records.pkl` (Python-Pickle-Binärformat) — inhaltlich identisch zur `.json`-Fassung, Pickle-Deserialisierung ist ein Sicherheitsrisiko.

## Nutzung
Aktuell **keine** Verknüpfung mit Bot-Funktionen oder Discord-Inhalten. Historische IHK-Daten dienen als Evidenz für Themenrelevanz, nicht als Vorhersage künftiger Prüfungen (siehe Produktvision in `PROJECT_HANDOVER.md`).
