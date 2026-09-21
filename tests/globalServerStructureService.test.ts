import { describe, expect, it } from 'vitest';
import type { Guild, OverwriteResolvable } from 'discord.js';
import { buildOverwrites } from '../src/services/globalServerStructureService.js';

function fakeGuild(): Guild {
  return { roles: { everyone: { id: 'role-everyone' } } } as unknown as Guild;
}

function ids(overwrites: OverwriteResolvable[]): string[] {
  return overwrites.map((o) => o.id as string);
}

describe('globalServerStructureService', () => {
  describe('buildOverwrites - keine doppelten Rollen-IDs im Overwrite-Array', () => {
    it.each(['PUBLIC', 'VERIFIED', 'STAFF'] as const)(
      'liefert fuer Access-Stufe %s jede Rollen-ID nur einmal (sonst lehnt Discord die gesamte Kanal-Aktualisierung mit "Missing Access" ab)',
      (access) => {
        const overwrites = buildOverwrites(
          fakeGuild(),
          access,
          'role-verified',
          'role-admin',
          'role-moderator',
          'role-bot',
          false,
        );

        const idList = ids(overwrites);
        expect(new Set(idList).size).toBe(idList.length);
      },
    );

    it('gibt Admin und Moderator auf STAFF-Kanaelen weiterhin Zugriff (genau ein Overwrite-Eintrag pro Rolle)', () => {
      const overwrites = buildOverwrites(
        fakeGuild(),
        'STAFF',
        'role-verified',
        'role-admin',
        'role-moderator',
        'role-bot',
        false,
      );

      const adminEntries = overwrites.filter((o) => o.id === 'role-admin');
      const moderatorEntries = overwrites.filter((o) => o.id === 'role-moderator');
      expect(adminEntries).toHaveLength(1);
      expect(moderatorEntries).toHaveLength(1);
      expect(adminEntries[0]?.allow).toContain(BigInt(1024));
    });
  });
});
