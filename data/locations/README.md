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
- **Stand der Datei:** 2026-09-21 (zweite Erhebungsrunde, siehe "Warum nicht
  alle 300+ Standorte?" unten).
- **Abdeckung:** Diese Datei enthaelt **226 verifizierte Standorte** (Stadt +
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
  Ortsnamens) daraus zwingend folgen. `postalCode` ist nur bei **8 von 226**
  Standorten gesetzt - ausschliesslich dort, wo die PLZ explizit in einer
  solchen Trefferzusammenfassung genannt wurde. Fuer alle anderen Standorte
  wurde das Feld bewusst weggelassen statt geraten. Adressen (Strasse/Hausnr.)
  wurden nicht mit ausreichender Sicherheit ermittelt und sind daher in dieser
  Datei generell nicht enthalten. Fuer Berlin und Bremen wurde eine zunaechst
  gesetzte PLZ in der zweiten Erhebungsrunde wieder entfernt, siehe unten.

### Warum nicht alle 300+ Standorte?

Ein direkter Abruf von `www.comcave.de` (auch `robots.txt`/`sitemap.xml`) ist
in dieser Entwicklungsumgebung durch eine Netzwerk-Egress-Restriktion
vollstaendig blockiert (bestaetigt kein Proxy-Fehler, sondern eine bewusste
Sperre). Die einzige verfuegbare Methode ist eine auf `comcave.de`/
`www.comcave.de` beschraenkte Websuche, die nicht wie ein klassischer
Sitemap-Crawler jede Unterseite liefert, sondern nur das, was fuer eine
konkrete Suchanfrage indexiert/zusammengefasst wird. In der ersten
Erhebungsrunde wurden vor allem einzelne Staedte-Suchanfragen gestellt, was
nur 110 Standorte ergab. In einer zweiten Runde wurde zusaetzlich gezielt
nach den offiziellen Bundesland-Sammelseiten (`comcave.de/standorte/
<bundesland>`, z. B. `.../nordrhein-westfalen`) gesucht und jede darin
genannte Stadt einzeln ueber eine eigene Suchanfrage bestaetigt (d. h. nur
uebernommen, wenn dabei eine echte, indexierte `comcave.de/standorte/<slug>`-
Seite als Treffer zurueckkam) - das brachte die Abdeckung auf 226. Bei diesem
zweiten Durchlauf sind zwei Fehler in unbestaetigten KI-generierten
Fliesstext-Zusammenfassungen aufgefallen, die deshalb NICHT uebernommen
wurden: ein Standort "Salzgitter" wurde faelschlich unter Baden-Württemberg
aufgefuehrt (Salzgitter liegt tatsaechlich in Niedersachsen - dort per
eigener Suchanfrage bestaetigt und entsprechend einsortiert), und ein Eintrag
"Monschau am Rhein" duerfte eine Verwechslung/Vermischung mit dem
benachbarten echten Eintrag "Monheim am Rhein" sein. Aus diesem Grund gilt
fuer diese Datei die Regel: **eine Stadt wird nur uebernommen, wenn eine
eigene Suchanfrage dafuer eine echte `comcave.de/standorte/<slug>`-Seite als
Treffer liefert** - eine reine Erwaehnung in einer Fliesstext-Zusammenfassung
reicht nicht. Mehrere so gepruefte Kandidaten (u. a. Wuppertal-Nachbarorte
wie Marl beim ersten Versuch, Erlangen, Schweinfurt, Weiden, Straubing,
Fulda, Ruesselsheim, Bautzen, Freiberg, Riesa, Trier, Speyer, Worms,
Ravensburg, Boeblingen, Rottweil) lieferten **keinen** bestaetigten Treffer
und wurden deshalb bewusst NICHT aufgenommen, auch wenn COMCAVE dort
moeglicherweise ebenfalls vertreten ist. Aus demselben Grund wurde bei
Berlin und Bremen die urspruenglich gesetzte PLZ wieder entfernt: beide
Staedte haben nachweislich mehrere COMCAVE-Zweigstellen mit unterschiedlichen
Adressen/PLZ, sodass keine einzelne PLZ eindeutig "der" Standort Berlin/
Bremen waere. Eine vollstaendige Abdeckung aller 300+ Standorte ist mit
dieser Suchmethode praktisch nicht erreichbar, da nicht jede Kombination aus
Bundesland und Ort im Voraus bekannt/erraten werden kann; sie erfordert
echten Lesezugriff auf `https://www.comcave.de/standorte` (z. B. durch die
Administration ausserhalb dieser Egress-Restriktion) oder eine offizielle
COMCAVE-Standort-Exportdatei/-API.

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
