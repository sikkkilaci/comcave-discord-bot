import { randomUUID } from 'node:crypto';
import type { GuildMember } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import {
  getClassByName,
  updateClassChannels,
  updateClassLead,
  updateClassRole,
} from '../src/repositories/classRepository.js';
import { setMemberClass } from '../src/repositories/memberRepository.js';
import { listAuditEvents } from '../src/repositories/auditLogRepository.js';
import {
  closeStudyGroup,
  createStudyGroupForClass,
  getStudyGroupStatusForClass,
  joinStudyGroup,
  leaveStudyGroup,
  listStudyGroupsForClass,
  removeStudyGroupMemberByModerator,
} from '../src/services/studyGroupService.js';
import { NotFoundError, PermissionError, ValidationError } from '../src/utils/errors.js';

function fakeMember(options: {
  id: string;
  ownerId?: string;
  isAdministrator?: boolean;
  roleIds?: string[];
}): GuildMember {
  const roleIds = new Set(options.roleIds ?? []);
  return {
    id: options.id,
    guild: { ownerId: options.ownerId ?? 'someone-else' },
    permissions: { has: () => options.isAdministrator ?? false },
    roles: { cache: { has: (roleId: string) => roleIds.has(roleId) } },
  } as unknown as GuildMember;
}

async function setupGuildWithClassesAB() {
  const guildId = `guild-${randomUUID()}`;
  const guildConfig = await getOrCreateGuildConfig(guildId);
  await updateClassRole(guildId, 'A', `role-a-${randomUUID()}`);
  await updateClassRole(guildId, 'B', `role-b-${randomUUID()}`);
  const leadRoleA = `lead-a-${randomUUID()}`;
  const leadRoleB = `lead-b-${randomUUID()}`;
  await updateClassLead(guildId, 'A', { leadRoleId: leadRoleA });
  await updateClassLead(guildId, 'B', { leadRoleId: leadRoleB });
  const classA = (await getClassByName(guildId, 'A'))!;
  const classB = (await getClassByName(guildId, 'B'))!;
  return { guildId, guildConfig, classA, classB, leadRoleA, leadRoleB };
}

describe('createStudyGroupForClass', () => {
  it('ein verifiziertes Mitglied kann eine Lerngruppe fuer die eigene Klasse gruenden', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const member = fakeMember({ id: 'member-1' });
    await setMemberClass(guildId, member.id, classA.id);

    const group = await createStudyGroupForClass(
      guildConfig,
      member,
      null,
      { name: 'Netzwerktechnik-AG' },
      member.id,
    );

    expect(group.name).toBe('Netzwerktechnik-AG');
    expect(group.isActive).toBe(true);
    expect(group.createdByDiscordId).toBe(member.id);
  });

  it('der Ersteller wird automatisch Mitglied der Gruppe', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const member = fakeMember({ id: 'member-1' });
    await setMemberClass(guildId, member.id, classA.id);

    const group = await createStudyGroupForClass(
      guildConfig,
      member,
      null,
      { name: 'Test-Gruppe' },
      member.id,
    );

    const status = await getStudyGroupStatusForClass(
      guildConfig,
      fakeMember({ id: 'admin-1', isAdministrator: true }),
      'A',
    );
    const created = status.groups.find((g) => g.group.id === group.id);
    expect(created?.memberDiscordIds).toEqual([member.id]);
  });

  it('ein unverifiziertes Mitglied (keine Klasse) darf keine Lerngruppe gruenden', async () => {
    const { guildConfig } = await setupGuildWithClassesAB();
    const unverified = fakeMember({ id: 'unverified-1' });

    await expect(
      createStudyGroupForClass(guildConfig, unverified, null, { name: 'X' }, unverified.id),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('ein Mitglied der Klasse A darf keine Lerngruppe fuer Klasse B gruenden', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const member = fakeMember({ id: 'member-1' });
    await setMemberClass(guildId, member.id, classA.id);

    await expect(
      createStudyGroupForClass(guildConfig, member, 'B', { name: 'X' }, member.id),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it('lehnt einen leeren Namen ab', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const member = fakeMember({ id: 'member-1' });
    await setMemberClass(guildId, member.id, classA.id);

    await expect(
      createStudyGroupForClass(guildConfig, member, null, { name: '   ' }, member.id),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('lehnt ein ungueltiges Teilnehmerlimit ab (0 oder > 100)', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const member = fakeMember({ id: 'member-1' });
    await setMemberClass(guildId, member.id, classA.id);

    await expect(
      createStudyGroupForClass(
        guildConfig,
        member,
        null,
        { name: 'X', maxParticipants: 0 },
        member.id,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createStudyGroupForClass(
        guildConfig,
        member,
        null,
        { name: 'X', maxParticipants: 101 },
        member.id,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('schreibt einen "studyGroup.create"-Audit-Log-Eintrag', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const member = fakeMember({ id: 'member-1' });
    await setMemberClass(guildId, member.id, classA.id);

    const group = await createStudyGroupForClass(
      guildConfig,
      member,
      null,
      { name: 'Test' },
      member.id,
    );

    const entries = await listAuditEvents(guildId);
    const entry = entries.find((e) => e.action === 'studyGroup.create');
    expect(entry).toBeDefined();
    const metadata = JSON.parse(entry?.metadata ?? '{}');
    expect(metadata).toMatchObject({ studyGroupId: group.id, className: 'A' });
  });

  it('Klassenleitung kann eine Lerngruppe fuer die eigene Klasse gruenden, auch ohne selbst Mitglied zu sein', async () => {
    const { guildConfig, leadRoleA } = await setupGuildWithClassesAB();
    const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });

    const group = await createStudyGroupForClass(
      guildConfig,
      leadA,
      'A',
      { name: 'Klassenleitungs-Gruppe' },
      leadA.id,
    );

    expect(group.name).toBe('Klassenleitungs-Gruppe');
  });
});

describe('listStudyGroupsForClass', () => {
  it('zeigt nur aktive Gruppen der eigenen Klasse inkl. Teilnehmerzahl', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const member = fakeMember({ id: 'member-1' });
    await setMemberClass(guildId, member.id, classA.id);
    const group = await createStudyGroupForClass(
      guildConfig,
      member,
      null,
      { name: 'Aktiv' },
      member.id,
    );
    await closeStudyGroup(
      guildConfig,
      member,
      (
        await createStudyGroupForClass(
          guildConfig,
          member,
          null,
          { name: 'Geschlossen' },
          member.id,
        )
      ).id,
      member.id,
    );

    const result = await listStudyGroupsForClass(guildConfig, member, null);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.group.id).toBe(group.id);
    expect(result.groups[0]?.memberCount).toBe(1);
  });

  it('liefert den Klassen-Sprachkanal, falls konfiguriert (Voice-Konzept)', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    await updateClassChannels(guildId, 'A', { voiceChannelId: 'voice-channel-a' });
    const member = fakeMember({ id: 'member-1' });
    await setMemberClass(guildId, member.id, classA.id);

    const result = await listStudyGroupsForClass(guildConfig, member, null);

    expect(result.voiceChannelId).toBe('voice-channel-a');
  });

  it('verweigert einem Mitglied einer FREMDEN Klasse den Zugriff (Klassenisolierung)', async () => {
    const { guildId, guildConfig, classB } = await setupGuildWithClassesAB();
    const memberOfB = fakeMember({ id: 'member-b' });
    await setMemberClass(guildId, memberOfB.id, classB.id);

    await expect(listStudyGroupsForClass(guildConfig, memberOfB, 'A')).rejects.toBeInstanceOf(
      PermissionError,
    );
  });

  it('lehnt fail-closed ab, wenn ein unverifiziertes Mitglied keine Klasse angibt', async () => {
    const { guildConfig } = await setupGuildWithClassesAB();
    const unverified = fakeMember({ id: 'unverified-1' });

    await expect(listStudyGroupsForClass(guildConfig, unverified, null)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('joinStudyGroup', () => {
  it('ein Mitglied der eigenen Klasse kann einer Gruppe beitreten', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const creator = fakeMember({ id: 'creator' });
    await setMemberClass(guildId, creator.id, classA.id);
    const group = await createStudyGroupForClass(
      guildConfig,
      creator,
      null,
      { name: 'Gruppe' },
      creator.id,
    );

    const joiner = fakeMember({ id: 'joiner' });
    await setMemberClass(guildId, joiner.id, classA.id);

    const result = await joinStudyGroup(guildConfig, joiner, group.id, joiner.id);

    expect(result.changed).toBe(true);
  });

  it('ein erneuter Beitritt erzeugt keine Duplikate (Duplicate Prevention)', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const member = fakeMember({ id: 'member-1' });
    await setMemberClass(guildId, member.id, classA.id);
    const group = await createStudyGroupForClass(
      guildConfig,
      member,
      null,
      { name: 'Gruppe' },
      member.id,
    );

    const joiner = fakeMember({ id: 'joiner' });
    await setMemberClass(guildId, joiner.id, classA.id);
    const first = await joinStudyGroup(guildConfig, joiner, group.id, joiner.id);
    const second = await joinStudyGroup(guildConfig, joiner, group.id, joiner.id);

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);

    const status = await getStudyGroupStatusForClass(
      guildConfig,
      fakeMember({ id: 'admin-1', isAdministrator: true }),
      'A',
    );
    const found = status.groups.find((g) => g.group.id === group.id);
    expect(found?.memberDiscordIds.filter((id) => id === joiner.id)).toHaveLength(1);
  });

  it('ein Mitglied der Klasse B kann KEINER Gruppe der Klasse A beitreten (Klassenisolierung)', async () => {
    const { guildId, guildConfig, classA, classB } = await setupGuildWithClassesAB();
    const creatorA = fakeMember({ id: 'creator-a' });
    await setMemberClass(guildId, creatorA.id, classA.id);
    const group = await createStudyGroupForClass(
      guildConfig,
      creatorA,
      null,
      { name: 'Gruppe A' },
      creatorA.id,
    );

    const memberB = fakeMember({ id: 'member-b' });
    await setMemberClass(guildId, memberB.id, classB.id);

    await expect(joinStudyGroup(guildConfig, memberB, group.id, memberB.id)).rejects.toBeInstanceOf(
      PermissionError,
    );
  });

  it('lehnt den Beitritt zu einer bereits vollen Gruppe ab (Teilnehmerlimit serverseitig durchgesetzt)', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const creator = fakeMember({ id: 'creator' });
    await setMemberClass(guildId, creator.id, classA.id);
    const group = await createStudyGroupForClass(
      guildConfig,
      creator,
      null,
      { name: 'Kleine Gruppe', maxParticipants: 1 },
      creator.id,
    );

    const joiner = fakeMember({ id: 'joiner' });
    await setMemberClass(guildId, joiner.id, classA.id);

    await expect(joinStudyGroup(guildConfig, joiner, group.id, joiner.id)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('lehnt den Beitritt zu einer bereits geschlossenen Gruppe ab', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const creator = fakeMember({ id: 'creator' });
    await setMemberClass(guildId, creator.id, classA.id);
    const group = await createStudyGroupForClass(
      guildConfig,
      creator,
      null,
      { name: 'Gruppe' },
      creator.id,
    );
    await closeStudyGroup(guildConfig, creator, group.id, creator.id);

    const joiner = fakeMember({ id: 'joiner' });
    await setMemberClass(guildId, joiner.id, classA.id);

    await expect(joinStudyGroup(guildConfig, joiner, group.id, joiner.id)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('lehnt eine manipulierte/unbekannte Gruppen-ID mit NotFoundError ab', async () => {
    const { guildConfig } = await setupGuildWithClassesAB();
    const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

    await expect(
      joinStudyGroup(guildConfig, admin, 'does-not-exist', admin.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lehnt eine Gruppen-ID aus einer FREMDEN Guild ab (Guild-Isolation)', async () => {
    const {
      guildId: guildIdA,
      guildConfig: guildConfigA,
      classA,
    } = await setupGuildWithClassesAB();
    const creator = fakeMember({ id: 'creator' });
    await setMemberClass(guildIdA, creator.id, classA.id);
    const group = await createStudyGroupForClass(
      guildConfigA,
      creator,
      null,
      { name: 'Gruppe' },
      creator.id,
    );

    const { guildConfig: guildConfigB } = await setupGuildWithClassesAB();
    const adminOfB = fakeMember({ id: 'admin-b', isAdministrator: true });

    await expect(
      joinStudyGroup(guildConfigB, adminOfB, group.id, adminOfB.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('schreibt einen "studyGroup.join"-Audit-Log-Eintrag', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const creator = fakeMember({ id: 'creator' });
    await setMemberClass(guildId, creator.id, classA.id);
    const group = await createStudyGroupForClass(
      guildConfig,
      creator,
      null,
      { name: 'Gruppe' },
      creator.id,
    );
    const joiner = fakeMember({ id: 'joiner' });
    await setMemberClass(guildId, joiner.id, classA.id);

    await joinStudyGroup(guildConfig, joiner, group.id, joiner.id);

    const entries = await listAuditEvents(guildId);
    expect(entries.some((e) => e.action === 'studyGroup.join')).toBe(true);
  });
});

describe('leaveStudyGroup', () => {
  it('ein Mitglied kann eine Gruppe verlassen, der es beigetreten ist', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const creator = fakeMember({ id: 'creator' });
    await setMemberClass(guildId, creator.id, classA.id);
    const group = await createStudyGroupForClass(
      guildConfig,
      creator,
      null,
      { name: 'Gruppe' },
      creator.id,
    );
    const joiner = fakeMember({ id: 'joiner' });
    await setMemberClass(guildId, joiner.id, classA.id);
    await joinStudyGroup(guildConfig, joiner, group.id, joiner.id);

    await leaveStudyGroup(guildConfig, joiner, group.id, joiner.id);

    const status = await getStudyGroupStatusForClass(
      guildConfig,
      fakeMember({ id: 'admin-1', isAdministrator: true }),
      'A',
    );
    const found = status.groups.find((g) => g.group.id === group.id);
    expect(found?.memberDiscordIds).not.toContain(joiner.id);
  });

  it('wirft NotFoundError, wenn das Mitglied gar nicht Teil der Gruppe ist', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const creator = fakeMember({ id: 'creator' });
    await setMemberClass(guildId, creator.id, classA.id);
    const group = await createStudyGroupForClass(
      guildConfig,
      creator,
      null,
      { name: 'Gruppe' },
      creator.id,
    );
    const outsider = fakeMember({ id: 'outsider' });
    await setMemberClass(guildId, outsider.id, classA.id);

    await expect(
      leaveStudyGroup(guildConfig, outsider, group.id, outsider.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lehnt das Verlassen einer bereits geschlossenen Gruppe ab', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const creator = fakeMember({ id: 'creator' });
    await setMemberClass(guildId, creator.id, classA.id);
    const group = await createStudyGroupForClass(
      guildConfig,
      creator,
      null,
      { name: 'Gruppe' },
      creator.id,
    );
    await closeStudyGroup(guildConfig, creator, group.id, creator.id);

    await expect(
      leaveStudyGroup(guildConfig, creator, group.id, creator.id),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('schreibt einen "studyGroup.leave"-Audit-Log-Eintrag', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const creator = fakeMember({ id: 'creator' });
    await setMemberClass(guildId, creator.id, classA.id);
    const group = await createStudyGroupForClass(
      guildConfig,
      creator,
      null,
      { name: 'Gruppe' },
      creator.id,
    );

    await leaveStudyGroup(guildConfig, creator, group.id, creator.id);

    const entries = await listAuditEvents(guildId);
    expect(entries.some((e) => e.action === 'studyGroup.leave')).toBe(true);
  });
});

describe('closeStudyGroup', () => {
  it('die Ersteller:in darf die eigene Gruppe schliessen', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const creator = fakeMember({ id: 'creator' });
    await setMemberClass(guildId, creator.id, classA.id);
    const group = await createStudyGroupForClass(
      guildConfig,
      creator,
      null,
      { name: 'Gruppe' },
      creator.id,
    );

    const closed = await closeStudyGroup(guildConfig, creator, group.id, creator.id);

    expect(closed.isActive).toBe(false);
    expect(closed.closedByDiscordId).toBe(creator.id);
  });

  it('Klassenleitung darf eine fremd erstellte Gruppe der eigenen Klasse schliessen', async () => {
    const { guildId, guildConfig, classA, leadRoleA } = await setupGuildWithClassesAB();
    const creator = fakeMember({ id: 'creator' });
    await setMemberClass(guildId, creator.id, classA.id);
    const group = await createStudyGroupForClass(
      guildConfig,
      creator,
      null,
      { name: 'Gruppe' },
      creator.id,
    );
    const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });

    const closed = await closeStudyGroup(guildConfig, leadA, group.id, leadA.id);

    expect(closed.isActive).toBe(false);
  });

  it('Admin darf jede Gruppe schliessen', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const creator = fakeMember({ id: 'creator' });
    await setMemberClass(guildId, creator.id, classA.id);
    const group = await createStudyGroupForClass(
      guildConfig,
      creator,
      null,
      { name: 'Gruppe' },
      creator.id,
    );
    const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

    const closed = await closeStudyGroup(guildConfig, admin, group.id, admin.id);

    expect(closed.isActive).toBe(false);
  });

  it('ein normales Mitglied (weder Ersteller:in noch Klassenleitung/Admin) darf NICHT schliessen', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const creator = fakeMember({ id: 'creator' });
    await setMemberClass(guildId, creator.id, classA.id);
    const group = await createStudyGroupForClass(
      guildConfig,
      creator,
      null,
      { name: 'Gruppe' },
      creator.id,
    );
    const other = fakeMember({ id: 'other' });
    await setMemberClass(guildId, other.id, classA.id);

    await expect(closeStudyGroup(guildConfig, other, group.id, other.id)).rejects.toBeInstanceOf(
      PermissionError,
    );
  });

  it('Klassenleitung B darf KEINE Gruppe der Klasse A schliessen', async () => {
    const { guildId, guildConfig, classA, leadRoleB } = await setupGuildWithClassesAB();
    const creator = fakeMember({ id: 'creator' });
    await setMemberClass(guildId, creator.id, classA.id);
    const group = await createStudyGroupForClass(
      guildConfig,
      creator,
      null,
      { name: 'Gruppe' },
      creator.id,
    );
    const leadB = fakeMember({ id: 'lead-b', roleIds: [leadRoleB] });

    await expect(closeStudyGroup(guildConfig, leadB, group.id, leadB.id)).rejects.toBeInstanceOf(
      PermissionError,
    );
  });

  it('eine bereits geschlossene Gruppe kann nicht erneut geschlossen werden', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const creator = fakeMember({ id: 'creator' });
    await setMemberClass(guildId, creator.id, classA.id);
    const group = await createStudyGroupForClass(
      guildConfig,
      creator,
      null,
      { name: 'Gruppe' },
      creator.id,
    );
    await closeStudyGroup(guildConfig, creator, group.id, creator.id);

    await expect(
      closeStudyGroup(guildConfig, creator, group.id, creator.id),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('schreibt einen "studyGroup.close"-Audit-Log-Eintrag', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const creator = fakeMember({ id: 'creator' });
    await setMemberClass(guildId, creator.id, classA.id);
    const group = await createStudyGroupForClass(
      guildConfig,
      creator,
      null,
      { name: 'Gruppe' },
      creator.id,
    );

    await closeStudyGroup(guildConfig, creator, group.id, creator.id);

    const entries = await listAuditEvents(guildId);
    expect(entries.some((e) => e.action === 'studyGroup.close')).toBe(true);
  });
});

describe('removeStudyGroupMemberByModerator', () => {
  it('Klassenleitung kann ein Mitglied aus einer Gruppe der eigenen Klasse entfernen', async () => {
    const { guildId, guildConfig, classA, leadRoleA } = await setupGuildWithClassesAB();
    const creator = fakeMember({ id: 'creator' });
    await setMemberClass(guildId, creator.id, classA.id);
    const group = await createStudyGroupForClass(
      guildConfig,
      creator,
      null,
      { name: 'Gruppe' },
      creator.id,
    );
    const joiner = fakeMember({ id: 'joiner' });
    await setMemberClass(guildId, joiner.id, classA.id);
    await joinStudyGroup(guildConfig, joiner, group.id, joiner.id);
    const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });

    await removeStudyGroupMemberByModerator(guildConfig, leadA, group.id, joiner.id, leadA.id);

    const status = await getStudyGroupStatusForClass(guildConfig, leadA, 'A');
    const found = status.groups.find((g) => g.group.id === group.id);
    expect(found?.memberDiscordIds).not.toContain(joiner.id);
  });

  it('Admin kann ein Mitglied aus jeder Gruppe entfernen', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const creator = fakeMember({ id: 'creator' });
    await setMemberClass(guildId, creator.id, classA.id);
    const group = await createStudyGroupForClass(
      guildConfig,
      creator,
      null,
      { name: 'Gruppe' },
      creator.id,
    );
    const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

    await removeStudyGroupMemberByModerator(guildConfig, admin, group.id, creator.id, admin.id);

    const status = await getStudyGroupStatusForClass(guildConfig, admin, 'A');
    const found = status.groups.find((g) => g.group.id === group.id);
    expect(found?.memberDiscordIds).not.toContain(creator.id);
  });

  it('ein normales Mitglied darf KEIN anderes Mitglied entfernen (nur Klassenleitung/Admin)', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const creator = fakeMember({ id: 'creator' });
    await setMemberClass(guildId, creator.id, classA.id);
    const group = await createStudyGroupForClass(
      guildConfig,
      creator,
      null,
      { name: 'Gruppe' },
      creator.id,
    );
    const joiner = fakeMember({ id: 'joiner' });
    await setMemberClass(guildId, joiner.id, classA.id);
    await joinStudyGroup(guildConfig, joiner, group.id, joiner.id);

    await expect(
      removeStudyGroupMemberByModerator(guildConfig, creator, group.id, joiner.id, creator.id),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it('Klassenleitung B darf KEIN Mitglied aus einer Gruppe der Klasse A entfernen', async () => {
    const { guildId, guildConfig, classA, leadRoleB } = await setupGuildWithClassesAB();
    const creator = fakeMember({ id: 'creator' });
    await setMemberClass(guildId, creator.id, classA.id);
    const group = await createStudyGroupForClass(
      guildConfig,
      creator,
      null,
      { name: 'Gruppe' },
      creator.id,
    );
    const leadB = fakeMember({ id: 'lead-b', roleIds: [leadRoleB] });

    await expect(
      removeStudyGroupMemberByModerator(guildConfig, leadB, group.id, creator.id, leadB.id),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it('wirft NotFoundError, wenn das Zielmitglied gar nicht in der Gruppe ist', async () => {
    const { guildId, guildConfig, classA, leadRoleA } = await setupGuildWithClassesAB();
    const creator = fakeMember({ id: 'creator' });
    await setMemberClass(guildId, creator.id, classA.id);
    const group = await createStudyGroupForClass(
      guildConfig,
      creator,
      null,
      { name: 'Gruppe' },
      creator.id,
    );
    const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });

    await expect(
      removeStudyGroupMemberByModerator(guildConfig, leadA, group.id, 'not-a-member', leadA.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lehnt die Mitgliederverwaltung einer bereits geschlossenen Gruppe ab', async () => {
    const { guildId, guildConfig, classA, leadRoleA } = await setupGuildWithClassesAB();
    const creator = fakeMember({ id: 'creator' });
    await setMemberClass(guildId, creator.id, classA.id);
    const group = await createStudyGroupForClass(
      guildConfig,
      creator,
      null,
      { name: 'Gruppe' },
      creator.id,
    );
    await closeStudyGroup(guildConfig, creator, group.id, creator.id);
    const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });

    await expect(
      removeStudyGroupMemberByModerator(guildConfig, leadA, group.id, creator.id, leadA.id),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('schreibt einen "studyGroup.memberRemoved"-Audit-Log-Eintrag mit targetDiscordId', async () => {
    const { guildId, guildConfig, classA, leadRoleA } = await setupGuildWithClassesAB();
    const creator = fakeMember({ id: 'creator' });
    await setMemberClass(guildId, creator.id, classA.id);
    const group = await createStudyGroupForClass(
      guildConfig,
      creator,
      null,
      { name: 'Gruppe' },
      creator.id,
    );
    const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });

    await removeStudyGroupMemberByModerator(guildConfig, leadA, group.id, creator.id, leadA.id);

    const entries = await listAuditEvents(guildId);
    const entry = entries.find((e) => e.action === 'studyGroup.memberRemoved');
    expect(entry).toBeDefined();
    expect(entry?.targetDiscordId).toBe(creator.id);
  });
});

describe('getStudyGroupStatusForClass', () => {
  it('Klassenleitung sieht alle Gruppen (aktiv und geschlossen) der eigenen Klasse', async () => {
    const { guildId, guildConfig, classA, leadRoleA } = await setupGuildWithClassesAB();
    const creator = fakeMember({ id: 'creator' });
    await setMemberClass(guildId, creator.id, classA.id);
    const activeGroup = await createStudyGroupForClass(
      guildConfig,
      creator,
      null,
      { name: 'Aktiv' },
      creator.id,
    );
    const closedGroup = await createStudyGroupForClass(
      guildConfig,
      creator,
      null,
      { name: 'Geschlossen' },
      creator.id,
    );
    await closeStudyGroup(guildConfig, creator, closedGroup.id, creator.id);
    const leadA = fakeMember({ id: 'lead-a', roleIds: [leadRoleA] });

    const status = await getStudyGroupStatusForClass(guildConfig, leadA, 'A');

    expect(status.groups.map((g) => g.group.id).sort()).toEqual(
      [activeGroup.id, closedGroup.id].sort(),
    );
  });

  it('Klassenleitung B darf NICHT den Status von Klasse A einsehen', async () => {
    const { guildConfig, leadRoleB } = await setupGuildWithClassesAB();
    const leadB = fakeMember({ id: 'lead-b', roleIds: [leadRoleB] });

    await expect(getStudyGroupStatusForClass(guildConfig, leadB, 'A')).rejects.toBeInstanceOf(
      PermissionError,
    );
  });

  it('ein normales Mitglied darf den Verwaltungsstatus NICHT einsehen', async () => {
    const { guildId, guildConfig, classA } = await setupGuildWithClassesAB();
    const member = fakeMember({ id: 'member-1' });
    await setMemberClass(guildId, member.id, classA.id);

    await expect(getStudyGroupStatusForClass(guildConfig, member, 'A')).rejects.toBeInstanceOf(
      PermissionError,
    );
  });

  it('Admin darf den Status jeder Klasse einsehen', async () => {
    const { guildConfig } = await setupGuildWithClassesAB();
    const admin = fakeMember({ id: 'admin-1', isAdministrator: true });

    const status = await getStudyGroupStatusForClass(guildConfig, admin, 'A');

    expect(status.className).toBe('A');
  });
});
