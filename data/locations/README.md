# COMCAVE-Standort-Quelldatei

Dieses Verzeichnis enthaelt die versionierte Quelldatei fuer den
Standort-Katalog (`ComcaveLocation`), analog zur Kursplan-Quelldatei unter
`data/course-plans/`.

## Quelle und Stand

- **Offizielle Quelle:** <https://www.comcave.de/standorte> (COMCAVE listet
  dort bundesweit ueber 300 Standorte, gegliedert nach Bundesland und Ort).
- **Erhebungsmethode:** In der Entwicklungsumgebung, in der diese Datei
  erstellt wurde, ist ein direkter Abruf von `www.comcave.de` netzwerkseitig
  blockiert (Egress-Restriktion). Die Daten wurden stattdessen ueber eine auf
  die Domains `comcave.de`/`www.comcave.de` beschraenkte Websuche ermittelt,
  sodass ausschliesslich von COMCAVE selbst stammende Inhalte (Standort-Unter-
  seiten unter `comcave.de/standorte/<ort>` und deren Textausschnitte)
  ausgewertet wurden - **keine** Daten von Google Maps, Wikipedia,
  Branchenverzeichnissen oder anderen Drittquellen.
- **Stand der Datei:** 2026-09-21.
- **Abdeckung:** Diese Datei enthaelt **110 verifizierte Standorte** (Stadt +
  Bundesland, teils PLZ) - einen ehrlich belegten Teilbestand der insgesamt
  ueber 300 offiziellen COMCAVE-Standorte, **keine** erschoepfende Liste.
  Eine vollstaendige Erfassung aller 300+ Standorte erfordert direkten Zugriff
  auf `https://www.comcave.de/standorte` (z. B. durch die Administration
  ausserhalb dieser Umgebung) und eine entsprechende Erweiterung dieser Datei.
  Der Import bleibt dabei unveraendert idempotent: neue Eintraege ergaenzen
  den Katalog, ohne bestehende `code`-Werte zu beruehren.
- **Genauigkeit der Felder:** Fuer jeden Standort sind `city` (Ort) und
  `state` (Bundesland) sicher belegt, da beide entweder woertlich aus einer
  domain-beschraenkten Trefferzusammenfassung stammen oder (bei eindeutiger,
  unstrittiger deutscher Verwaltungsgeographie eines von COMCAVE bestaetigten
  Ortsnamens) daraus zwingend folgen. `postalCode` ist nur bei **9 von 110**
  Standorten gesetzt - ausschliesslich dort, wo die PLZ explizit in einer
  solchen Trefferzusammenfassung genannt wurde. Fuer alle anderen Standorte
  wurde das Feld bewusst weggelassen statt geraten. Adressen (Strasse/Hausnr.)
  wurden nicht mit ausreichender Sicherheit ermittelt und sind daher in dieser
  Datei generell nicht enthalten.
- **Keine Teilnehmerdaten:** Diese Datei enthaelt ausschliesslich
  Standort-Stammdaten (Ort/Bundesland/PLZ), keine Personen- oder
  Teilnehmerdaten.

## Erwartetes Dateiformat

Erwarteter Dateiname: `comcave-standorte.json`

Ein JSON-Array aus Objekten mit folgenden Feldern:

```json
[
  {
    "code": "eindeutiger-interner-schluessel",
    "name": "COMCAVE <Standortname>",
    "state": "<Bundesland>",
    "city": "<Stadt>",
    "postalCode": "<PLZ>"
  }
]
```

- `code`: stabiler, eindeutiger Schluessel je Standort (z. B. ein offizieller
  COMCAVE-Standort-Code, falls vorhanden, sonst ein sprechender Slug, siehe
  unten). Wird fuer den idempotenten Import verwendet - **darf sich zwischen
  zwei Importen nicht aendern**, sonst wird ein Standort als neu statt als
  Aktualisierung erkannt.
- `name`, `state`, `city`: Pflichtfelder, Anzeige-/Suchfelder (Grundlage der
  Autocomplete-Suche unter `/standort-waehlen`).
- `postalCode`: **optional**. Nur setzen, wenn die PLZ eindeutig auf einer
  offiziellen COMCAVE-Seite verifiziert werden kann - sonst weglassen statt
  zu erfinden.

Fuer `code` wird in dieser Datei eine ASCII-Transliteration nach COMCAVEs
eigenem URL-Slug-Schema verwendet (ü→ue, ö→oe, ä→ae, ß→ss, Leerzeichen→
Bindestrich, z. B. `muenchen`, `koeln`, `wuerzburg`, `goettingen`). Bei
mehreren gleichnamigen Orten in unterschiedlichen Bundeslaendern (z. B.
Frankfurt am Main vs. Frankfurt (Oder)) wird der Ortsname im `code`
disambiguiert (`frankfurt-am-main` / `frankfurt-oder`).

## Umlaute und Sonderzeichen

`name`, `city` und `state` behalten echte deutsche Umlaute/Sonderzeichen bei
(z. B. `"München"`, `"Köln"`, `"Baden-Württemberg"`) - die Datei ist UTF-8
kodiert. Nur der interne `code` wird ASCII-transliteriert (s. o.), da er nie
angezeigt, sondern nur als stabiler Importschluessel verwendet wird.

## Import

- Discord (Admin, im Zielserver): `/setup-standorte-importieren`
- Kommandozeile: `npm run standorte:import`

Beide Wege sind idempotent: ein wiederholter Import mit unveraenderter Datei
erzeugt keine Duplikate. Standorte, die in einer neuen Version der Datei
fehlen, werden automatisch deaktiviert (nicht geloescht) - bestehende
Mitglieder-Zuordnungen bleiben dadurch gueltig, der Standort taucht aber
nicht mehr in der Suche auf.

## Diese Liste erweitern

Weitere offizielle Standorte koennen jederzeit ergaenzt werden: neuen
Eintrag mit eindeutigem `code` anhaengen und erneut importieren. Bestehende
Eintraege duerfen dabei nicht "geraten" korrigiert werden - eine Aenderung an
`postalCode` o. Ae. ist nur zulaessig, wenn sie auf einer offiziellen
COMCAVE-Seite eindeutig verifiziert werden kann (siehe oben).
