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
