import { describe, expect, it } from 'vitest';
import { loadCommands } from '../src/bot/handlers/commandLoader.js';
import { PermissionLevel } from '../src/permissions/PermissionLevel.js';

describe('commandLoader', () => {
  it('laedt alle Verifizierungs-Commands mit gueltiger Struktur und korrekten Berechtigungsstufen', async () => {
    const commands = await loadCommands();

    const expected: Record<string, PermissionLevel> = {
      ping: PermissionLevel.EVERYONE,
      konfiguration: PermissionLevel.ADMIN,
      'setup-verifizierung': PermissionLevel.ADMIN,
      verifizieren: PermissionLevel.EVERYONE,
      'mitglied-verifizieren': PermissionLevel.ADMIN,
      'verifizierung-status': PermissionLevel.EVERYONE,
      onboarding: PermissionLevel.EVERYONE,
      'setup-klassen': PermissionLevel.ADMIN,
      'wo-bin-ich': PermissionLevel.EVERYONE,
      'setup-klassenbereiche': PermissionLevel.KLASSENLEITUNG,
      'setup-klassenleitung': PermissionLevel.ADMIN,
      'entferne-klassenleitung': PermissionLevel.ADMIN,
      'pruefung-erstellen': PermissionLevel.KLASSENLEITUNG,
      'pruefung-bearbeiten': PermissionLevel.KLASSENLEITUNG,
      'pruefung-loeschen': PermissionLevel.KLASSENLEITUNG,
      'pruefungen-anzeigen': PermissionLevel.VERIFIED,
      'termin-erstellen': PermissionLevel.KLASSENLEITUNG,
      'termin-bearbeiten': PermissionLevel.KLASSENLEITUNG,
      'termin-loeschen': PermissionLevel.KLASSENLEITUNG,
      'termine-anzeigen': PermissionLevel.VERIFIED,
      'tagesbericht-erstellen': PermissionLevel.KLASSENLEITUNG,
      'tagesbericht-bearbeiten': PermissionLevel.KLASSENLEITUNG,
      'tagesbericht-loeschen': PermissionLevel.KLASSENLEITUNG,
      'tagesberichte-anzeigen': PermissionLevel.VERIFIED,
      'wochenbericht-erstellen': PermissionLevel.KLASSENLEITUNG,
      'wochenbericht-bearbeiten': PermissionLevel.KLASSENLEITUNG,
      'wochenbericht-loeschen': PermissionLevel.KLASSENLEITUNG,
      'wochenberichte-anzeigen': PermissionLevel.VERIFIED,
      'berichtsheft-anzeigen': PermissionLevel.VERIFIED,
      'lernmaterial-erstellen': PermissionLevel.KLASSENLEITUNG,
      'lernmaterial-bearbeiten': PermissionLevel.KLASSENLEITUNG,
      'lernmaterial-loeschen': PermissionLevel.KLASSENLEITUNG,
      'lernmaterial-anzeigen': PermissionLevel.VERIFIED,
      'pruefung-lernmaterial': PermissionLevel.VERIFIED,
      'setup-admin-rollen': PermissionLevel.ADMIN,
      'audit-log': PermissionLevel.ADMIN,
      kursplan: PermissionLevel.VERIFIED,
      'kursplan-status': PermissionLevel.KLASSENLEITUNG,
      'kursplan-importieren': PermissionLevel.ADMIN,
      'lerngruppe-erstellen': PermissionLevel.VERIFIED,
      'lerngruppen-anzeigen': PermissionLevel.VERIFIED,
      'lerngruppe-beitreten': PermissionLevel.VERIFIED,
      'lerngruppe-verlassen': PermissionLevel.VERIFIED,
      'lerngruppe-schliessen': PermissionLevel.VERIFIED,
      'lerngruppe-status': PermissionLevel.KLASSENLEITUNG,
      'lerngruppe-mitglied-entfernen': PermissionLevel.KLASSENLEITUNG,
      'standort-waehlen': PermissionLevel.EVERYONE,
      regeln: PermissionLevel.EVERYONE,
      'regelwerk-aktualisieren': PermissionLevel.ADMIN,
      'regelwerk-status': PermissionLevel.ADMIN,
      'mitglied-profil-bearbeiten': PermissionLevel.ADMIN,
      'setup-standorte-importieren': PermissionLevel.ADMIN,
      'setup-server': PermissionLevel.ADMIN,
    };

    for (const [name, level] of Object.entries(expected)) {
      const command = commands.get(name);
      expect(command, `Command "${name}" wurde nicht geladen`).toBeDefined();
      expect(command?.permissionLevel).toBe(level);
      // toJSON() wirft bei ungueltiger Slash-Command-Definition (z. B. Namenskonflikte,
      // ungueltige Optionsnamen) - erfolgreicher Aufruf validiert die Struktur.
      expect(() => command?.data.toJSON()).not.toThrow();
    }
  });
});
