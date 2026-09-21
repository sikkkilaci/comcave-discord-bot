# COMCAVE-Standort-Quelldatei

Dieses Verzeichnis enthaelt die versionierte Quelldatei fuer den
Standort-Katalog (`ComcaveLocation`), analog zur Kursplan-Quelldatei unter
`data/course-plans/`.

**Es liegt hier absichtlich noch KEINE echte Standortliste.** Diese Datei
muss von der Administration mit der offiziellen COMCAVE-Standortliste
befuellt werden, bevor `/setup-standorte-importieren` bzw.
`npm run standorte:import` sinnvolle Daten importieren kann.

## Erwartetes Dateiformat

Erwarteter Dateiname: `comcave-standorte.json`

Ein JSON-Array aus Objekten mit genau diesen vier Feldern:

```json
[
  {
    "code": "eindeutiger-interner-schluessel",
    "name": "COMCAVE <Standortname>",
    "city": "<Stadt>",
    "postalCode": "<PLZ>"
  }
]
```

- `code`: stabiler, eindeutiger Schluessel je Standort (z. B. ein offizieller
  COMCAVE-Standort-Code, falls vorhanden, sonst ein sprechender Slug). Wird
  fuer den idempotenten Import verwendet - **darf sich zwischen zwei
  Importen nicht aendern**, sonst wird ein Standort als neu statt als
  Aktualisierung erkannt.
- `name`, `city`, `postalCode`: Anzeige-/Suchfelder (Grundlage der
  Autocomplete-Suche unter `/standort-waehlen`).

## Import

- Discord (Admin, im Zielserver): `/setup-standorte-importieren`
- Kommandozeile: `npm run standorte:import`

Beide Wege sind idempotent: ein wiederholter Import mit unveraenderter Datei
erzeugt keine Duplikate. Standorte, die in einer neuen Version der Datei
fehlen, werden automatisch deaktiviert (nicht geloescht) - bestehende
Mitglieder-Zuordnungen bleiben dadurch gueltig, der Standort taucht aber
nicht mehr in der Suche auf.
