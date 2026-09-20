import { randomUUID } from 'node:crypto';
import type { GuildMember } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import { updateClassLead, updateClassRole } from '../src/repositories/classRepository.js';
import { createDailyReportForClass } from '../src/services/dailyReportService.js';
import { createWeeklyReportForClass } from '../src/services/weeklyReportService.js';
import { getBerichtsheftForClass } from '../src/services/berichtsheftService.js';
import { PermissionError } from '../src/utils/errors.js';

function fakeMember(options: {
  id: string;
  isAdministrator?: boolean;
  roleIds?: string[];
}): GuildMember {
  const roleIds = new Set(options.roleIds ?? []);
  return {
    id: options.id,
    guild: { ownerId: 'someone-else' },
    permissions: { has: () => options.isAdministrator ?? false },
    roles: { cache: { has: (roleId: string) => roleIds.has(roleId) } },
  } as unknown as GuildMember;
}

async function setupGuildWithClassA() {
  const guildId = `guild-${randomUUID()}`;
  const guildConfig = await getOrCreateGuildConfig(guildId);
  await updateClassRole(guildId, 'A', `role-a-${randomUUID()}`);
  const leadRoleA = `lead-a-${randomUUID()}`;
  await updateClassLead(guildId, 'A', { leadRoleId: leadRoleA });
  return { guildId, guildConfig, leadRoleA };
}

describe('berichtsheftService', () => {
  it('kombiniert Tages- und Wochenberichte chronologisch sortiert', async () => {
    const { guildConfig } = await setupGuildWithClassA();
    const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

    await createDailyReportForClass(
      guildConfig,
      admin,
      'A',
      {
        datum: '20.03.2026',
        themen: 'Spaeteres Thema',
        lerninhalte: 'Inhalt',
        hinweise: 'Keine',
      },
      admin.id,
    );
    await createWeeklyReportForClass(
      guildConfig,
      admin,
      'A',
      {
        kalenderwoche: 10,
        zeitraumStart: '02.03.2026',
        zeitraumEnde: '06.03.2026',
        themen: 'Frueheres Thema',
        lernfortschritt: 'Fortschritt',
        hinweise: 'Keine',
      },
      admin.id,
    );

    const { className, entries } = await getBerichtsheftForClass(guildConfig, admin, 'A');

    expect(className).toBe('A');
    expect(entries).toHaveLength(2);
    expect(entries[0]?.type).toBe('WOCHENBERICHT');
    expect(entries[0]?.topics).toBe('Frueheres Thema');
    expect(entries[1]?.type).toBe('TAGESBERICHT');
    expect(entries[1]?.topics).toBe('Spaeteres Thema');
  });

  it('verweigert den Zugriff auf eine fremde Klasse (nutzt dieselbe Berechtigungspruefung)', async () => {
    const { guildConfig } = await setupGuildWithClassA();
    await updateClassRole(guildConfig.id, 'B', `role-b-${randomUUID()}`);
    const member = fakeMember({ id: 'member-1' });

    await expect(getBerichtsheftForClass(guildConfig, member, 'A')).rejects.toBeInstanceOf(
      PermissionError,
    );
  });

  it('gibt eine leere Liste zurueck, wenn keine Berichte vorhanden sind', async () => {
    const { guildConfig } = await setupGuildWithClassA();
    const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

    const { entries } = await getBerichtsheftForClass(guildConfig, admin, 'A');

    expect(entries).toEqual([]);
  });
});
