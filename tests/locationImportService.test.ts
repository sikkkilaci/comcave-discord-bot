import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { unlink, writeFile } from 'node:fs/promises';
import type { GuildMember } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import { listAuditEvents } from '../src/repositories/auditLogRepository.js';
import { searchActiveLocations } from '../src/repositories/locationRepository.js';
import {
  importLocationsAsAdmin,
  importLocationsFromFile,
  parseLocationSource,
} from '../src/services/locationImportService.js';
import { PermissionError, ValidationError } from '../src/utils/errors.js';

function fakeMember(options: { id: string; isAdministrator?: boolean }): GuildMember {
  return {
    id: options.id,
    guild: { ownerId: 'someone-else' },
    permissions: { has: () => options.isAdministrator ?? false },
    roles: { cache: { has: () => false } },
  } as unknown as GuildMember;
}

/** Schreibt eine temporaere Standort-Quelldatei unter data/locations/ und liefert ihren repo-relativen Pfad. */
async function writeTempLocationFile(entries: unknown): Promise<{
  relativePath: string;
  cleanup: () => Promise<void>;
}> {
  const relativePath = `data/locations/.tmp-test-${randomUUID()}.json`;
  const absolutePath = path.join(process.cwd(), relativePath);
  await writeFile(absolutePath, JSON.stringify(entries), 'utf-8');
  return { relativePath, cleanup: () => unlink(absolutePath) };
}

describe('parseLocationSource', () => {
  it('parst ein gueltiges Array aus Standort-Eintraegen', () => {
    const result = parseLocationSource(
      JSON.stringify([{ code: 'a', name: 'COMCAVE A', city: 'A-Stadt', postalCode: '11111' }]),
    );

    expect(result).toEqual([
      { code: 'a', name: 'COMCAVE A', city: 'A-Stadt', postalCode: '11111' },
    ]);
  });

  it('wirft ValidationError bei ungueltigem JSON', () => {
    expect(() => parseLocationSource('{ das ist kein json')).toThrow(ValidationError);
  });

  it('wirft ValidationError, wenn ein Eintrag Pflichtfelder vermissen laesst', () => {
    expect(() => parseLocationSource(JSON.stringify([{ code: 'a', name: 'COMCAVE A' }]))).toThrow(
      ValidationError,
    );
  });

  it('wirft ValidationError bei doppelten code-Werten', () => {
    const entries = [
      { code: 'dup', name: 'COMCAVE A', city: 'A-Stadt', postalCode: '11111' },
      { code: 'dup', name: 'COMCAVE B', city: 'B-Stadt', postalCode: '22222' },
    ];

    expect(() => parseLocationSource(JSON.stringify(entries))).toThrow(ValidationError);
  });
});

describe('importLocationsFromFile', () => {
  it('importiert neue Standorte aus einer Quelldatei', async () => {
    const uniqueCity = `Importstadt-${randomUUID()}`;
    const { relativePath, cleanup } = await writeTempLocationFile([
      {
        code: `code-${randomUUID()}`,
        name: 'COMCAVE Import',
        city: uniqueCity,
        postalCode: '11111',
      },
    ]);

    try {
      const summary = await importLocationsFromFile(relativePath);

      expect(summary.created).toBe(1);
      expect(summary.updated).toBe(0);
      expect(await searchActiveLocations(uniqueCity)).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });

  it('ist idempotent: ein zweiter Import derselben Datei aktualisiert statt zu duplizieren', async () => {
    const code = `code-${randomUUID()}`;
    const uniqueCity = `Idempotenzstadt-${randomUUID()}`;
    const { relativePath, cleanup } = await writeTempLocationFile([
      { code, name: 'COMCAVE Idempotent', city: uniqueCity, postalCode: '11111' },
    ]);

    try {
      const first = await importLocationsFromFile(relativePath);
      const second = await importLocationsFromFile(relativePath);

      expect(first.created).toBe(1);
      expect(second.created).toBe(0);
      expect(second.updated).toBe(1);
      expect(await searchActiveLocations(uniqueCity)).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });

  it('deaktiviert Standorte, die in einer aktualisierten Quelldatei fehlen', async () => {
    const keptCode = `code-${randomUUID()}`;
    const droppedCode = `code-${randomUUID()}`;
    const keptCity = `Bleibtstadt-${randomUUID()}`;
    const droppedCity = `Faelltwegstadt-${randomUUID()}`;

    const first = await writeTempLocationFile([
      { code: keptCode, name: 'Bleibt', city: keptCity, postalCode: '11111' },
      { code: droppedCode, name: 'Faellt weg', city: droppedCity, postalCode: '22222' },
    ]);
    await importLocationsFromFile(first.relativePath);
    await first.cleanup();

    const second = await writeTempLocationFile([
      { code: keptCode, name: 'Bleibt', city: keptCity, postalCode: '11111' },
    ]);

    try {
      const summary = await importLocationsFromFile(second.relativePath);

      expect(summary.deactivated).toBeGreaterThanOrEqual(1);
      expect(await searchActiveLocations(keptCity)).toHaveLength(1);
      expect(await searchActiveLocations(droppedCity)).toHaveLength(0);
    } finally {
      await second.cleanup();
    }
  });

  it('wirft eine verstaendliche ValidationError, wenn die Quelldatei nicht existiert', async () => {
    await expect(
      importLocationsFromFile(`data/locations/.does-not-exist-${randomUUID()}.json`),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('importLocationsAsAdmin - Berechtigung', () => {
  it('ein globaler Admin kann den Standort-Import ausloesen und es wird ein Audit-Log-Eintrag geschrieben', async () => {
    const guildId = `guild-${randomUUID()}`;
    const guildConfig = await getOrCreateGuildConfig(guildId);
    const admin = fakeMember({ id: 'admin-1', isAdministrator: true });
    const uniqueCity = `Adminstadt-${randomUUID()}`;
    const { relativePath, cleanup } = await writeTempLocationFile([
      {
        code: `code-${randomUUID()}`,
        name: 'COMCAVE Admin',
        city: uniqueCity,
        postalCode: '33333',
      },
    ]);

    try {
      await importLocationsAsAdmin(guildConfig, admin, admin.id, relativePath);

      const entries = await listAuditEvents(guildId, { actorDiscordId: admin.id });
      expect(entries.some((entry) => entry.action === 'location.import')).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('ein normales Mitglied darf den Standort-Import nicht ausloesen', async () => {
    const guildId = `guild-${randomUUID()}`;
    const guildConfig = await getOrCreateGuildConfig(guildId);
    const member = fakeMember({ id: 'member-1' });

    await expect(importLocationsAsAdmin(guildConfig, member, member.id)).rejects.toBeInstanceOf(
      PermissionError,
    );
  });
});
