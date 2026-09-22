FISI_TOPICS = {
    'Netzwerktechnik / TCP-IP / Subnetting': [
        r'netzwerk', r'tcp[/\-]?ip', r'subnetz', r'subnetting', r'ip-adress', r'router',
        r'switch', r'vlan', r'topologie', r'übertragungsrate', r'bandbreite',
    ],
    'WLAN / Funknetz': [r'wlan', r'wireless', r'funknetz', r'access[- ]point'],
    'Active Directory / Benutzer- und Rechteverwaltung': [
        r'active directory', r'benutzerverwaltung', r'gruppenrichtlinie', r'berechtigung',
        r'domäne', r'domain controller', r'benutzerkonto',
    ],
    'Virtualisierung': [r'virtualisierung', r'hypervisor', r'vmware', r'hyper-v', r'virtuelle maschine'],
    'Datensicherung / Storage / RAID': [
        r'datensicherung', r'backup', r'raid', r'speicherlösung', r'storage', r'sicherungskonzept',
        r'archivierung',
    ],
    'IT-Sicherheit / Firewall / Verschlüsselung': [
        r'firewall', r'verschlüsselung', r'\bvpn\b', r'sicherheitskonzept', r'virenschutz',
        r'malware', r'zugriffsschutz', r'authentifizierung', r'kryptograph',
    ],
    'Datenschutz': [r'datenschutz', r'dsgvo', r'personenbezogene daten'],
    'Skripting / Automatisierung': [r'skript', r'powershell', r'batch-datei', r'automatisierung'],
    'Cloud Computing': [r'\bcloud\b', r'\bsaas\b', r'\biaas\b', r'\bpaas\b'],
    'Projektmanagement / Wirtschaftlichkeit': [
        r'projektplan', r'netzplan', r'wirtschaftlichkeit', r'angebotsvergleich', r'kalkulation',
        r'nutzwertanalyse', r'lastenheft', r'pflichtenheft', r'amortisation', r'investition',
        r'kostenvergleich',
    ],
    'ITIL / Service-Prozesse': [r'\bitil\b', r'service level', r'incident', r'ticketsystem'],
    'Green IT / Energieeffizienz': [r'green it', r'energieeffizienz', r'stromverbrauch'],
    'DNS / DHCP': [r'\bdns\b', r'\bdhcp\b'],
    'E-Mail- und Kommunikationsdienste': [r'e-mail-server', r'exchange server', r'kommunikationsdienst'],
    'Datenbanken (Grundlagen)': [r'datenbank', r'\bsql\b', r'tabelle.{0,15}datensatz'],
}

FIAE_TOPICS = {
    'Programmierung Grundlagen': [
        r'variable', r'schleife', r'verzweigung', r'kontrollstruktur', r'algorithmus', r'pseudocode',
    ],
    'Objektorientierte Programmierung': [
        r'klassendiagramm', r'vererbung', r'polymorphismus', r'\bmethode\b', r'attribut', r'\buml\b',
        r'objektorientiert',
    ],
    'Datenbanken / SQL': [
        r'datenbank', r'\bsql\b', r'normalisierung', r'entity[- ]relationship', r'primärschlüssel',
        r'fremdschlüssel',
    ],
    'Softwareentwicklungsprozess / Vorgehensmodelle': [
        r'vorgehensmodell', r'\bscrum\b', r'wasserfallmodell', r'\bsprint\b', r'lastenheft',
        r'pflichtenheft', r'anforderung',
    ],
    'Testverfahren / Qualitätssicherung': [r'testfall', r'testverfahren', r'unittest', r'qualitätssicherung'],
    'Versionierung': [r'versionsverwaltung', r'\bgit\b', r'repository'],
    'Webentwicklung / Schnittstellen': [r'schnittstelle', r'\bapi\b', r'webanwendung', r'http'],
    'Projektmanagement / Wirtschaftlichkeit': [
        r'projektplan', r'netzplan', r'wirtschaftlichkeit', r'angebotsvergleich', r'kalkulation',
        r'nutzwertanalyse', r'amortisation',
    ],
    'IT-Sicherheit': [r'firewall', r'verschlüsselung', r'\bvpn\b', r'sicherheitskonzept'],
    'Datenschutz': [r'datenschutz', r'dsgvo', r'personenbezogene daten'],
}

WISO_TOPICS = {
    'Berufsausbildung / Ausbildungsvertrag': [
        r'ausbildungsvertrag', r'berufsausbildung', r'ausbildungsordnung', r'jugendarbeitsschutz',
        r'ausbildungsverhältnis',
    ],
    'Arbeitsrecht / Kündigung': [r'kündigung', r'arbeitsvertrag', r'tarifvertrag', r'arbeitsrecht'],
    'Mitbestimmung': [r'betriebsrat', r'mitbestimmung', r'gewerkschaft'],
    'Sozialversicherung': [
        r'sozialversicherung', r'krankenversicherung', r'rentenversicherung', r'arbeitslosenversicherung',
        r'pflegeversicherung',
    ],
    'Wirtschaftskreislauf / Marktformen': [
        r'wirtschaftskreislauf', r'marktform', r'angebot und nachfrage', r'monopol', r'oligopol',
    ],
    'Unternehmensformen': [r'unternehmensform', r'\bgmbh\b', r'\bag\b', r'personengesellschaft'],
    'Steuern': [r'steuer', r'umsatzsteuer', r'einkommensteuer'],
    'Lohn / Gehalt': [r'lohn', r'gehalt', r'entgelt', r'lohnabrechnung'],
}

KQ_TOPICS = {
    'Netzwerktechnik (gemeinsame Grundlagen)': [r'netzwerk', r'tcp[/\-]?ip', r'subnetz'],
    'Projektmanagement / Wirtschaftlichkeit (gemeinsam)': [
        r'projektplan', r'netzplan', r'wirtschaftlichkeit', r'kalkulation', r'nutzwertanalyse',
    ],
    'IT-Sicherheit / Datenschutz (gemeinsam)': [r'firewall', r'datenschutz', r'dsgvo', r'verschlüsselung'],
    'Datenbanken (gemeinsame Grundlagen)': [r'datenbank', r'\bsql\b'],
    'Rechtliche Grundlagen': [r'ausbildungsvertrag', r'berufsausbildung', r'jugendarbeitsschutz'],
}
