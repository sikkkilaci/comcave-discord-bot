import { randomUUID } from 'node:crypto';
import type { ButtonInteraction, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { Collection } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import event from '../src/bot/events/interactionCreate.js';
import type { Command } from '../src/types/command.js';
import type { BotClient } from '../src/types/client.js';
import { PermissionLevel } from '../src/permissions/PermissionLevel.js';
import { PermissionError } from '../src/utils/errors.js';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import { updateClassRole } from '../src/repositories/classRepository.js';
import {
  getMemberWithClass,
  setMemberFachrichtung,
  setVerificationStatus,
  updatePersonalDetails,
} from '../src/repositories/memberRepository.js';
import { listAuditEvents } from '../src/repositories/auditLogRepository.js';
import { assignClass } from '../src/services/classService.js';
import {
  buildClassConfirmCustomId,
  buildClassCustomId,
  CLASS_BACK_CUSTOM_ID,
  CLASS_HELP_CUSTOM_ID,
} from '../src/bot/ui/classMessage.js';

function fakeMember(options: {
  id: string;
  ownerId?: string;
  isAdministrator?: boolean;
}): GuildMember {
  return {
    id: options.id,
    guild: { ownerId: options.ownerId ?? 'someone-else' },
    permissions: { has: () => options.isAdministrator ?? false },
    roles: { cache: { has: () => false } },
  } as unknown as GuildMember;
}

function fakeCommand(overrides: Partial<Command> = {}): Command {
  return {
    data: { name: 'test-command', toJSON: () => ({ name: 'test-command' }) as never },
    permissionLevel: PermissionLevel.EVERYONE,
    execute: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

interface FakeInteractionOptions {
  guildId?: string;
  commandName?: string;
  member: GuildMember;
  commands?: Collection<string, Command>;
  inGuild?: boolean;
}

function fakeChatInputInteraction(options: FakeInteractionOptions): ChatInputCommandInteraction & {
  reply: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
} {
  const guildId = options.guildId ?? `guild-${randomUUID()}`;
  const reply = vi.fn().mockResolvedValue(undefined);
  const followUp = vi.fn().mockResolvedValue(undefined);
  const client = {
    commands: options.commands ?? new Collection<string, Command>(),
  } as unknown as BotClient;

  return {
    isChatInputCommand: () => true,
    isButton: () => false,
    isStringSelectMenu: () => false,
    inGuild: () => options.inGuild ?? true,
    guild: options.inGuild === false ? null : { id: guildId },
    client,
    commandName: options.commandName ?? 'test-command',
    member: options.member,
    user: { id: options.member.id },
    deferred: false,
    replied: false,
    reply,
    followUp,
  } as unknown as ChatInputCommandInteraction & {
    reply: ReturnType<typeof vi.fn>;
    followUp: ReturnType<typeof vi.fn>;
  };
}

describe('interactionCreate - handleChatInputCommand', () => {
  it('lehnt eine Interaktion ausserhalb eines Servers ab und fuehrt keinen Befehl aus', async () => {
    const command = fakeCommand();
    const commands = new Collection<string, Command>([['test-command', command]]);
    const member = fakeMember({ id: 'user-1' });
    const interaction = fakeChatInputInteraction({ member, commands, inGuild: false });

    await event.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('nur innerhalb des COMCAVE-Servers'),
      }),
    );
    expect(command.execute).not.toHaveBeenCalled();
  });

  it('lehnt einen unbekannten Befehl ab', async () => {
    const member = fakeMember({ id: 'user-1' });
    const interaction = fakeChatInputInteraction({ member, commands: new Collection() });

    await event.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('nicht verfuegbar') }),
    );
  });

  it('verweigert die Ausfuehrung, wenn die Berechtigungsstufe nicht erreicht wird - der Befehl wird NICHT ausgefuehrt', async () => {
    const command = fakeCommand({ permissionLevel: PermissionLevel.ADMIN });
    const commands = new Collection<string, Command>([['test-command', command]]);
    const member = fakeMember({ id: 'user-1', isAdministrator: false });
    const interaction = fakeChatInputInteraction({ member, commands });

    await event.execute(interaction);

    expect(command.execute).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('keine Berechtigung') }),
    );
  });

  it('fuehrt den Befehl aus, wenn die Berechtigungsstufe erreicht wird', async () => {
    const command = fakeCommand({ permissionLevel: PermissionLevel.EVERYONE });
    const commands = new Collection<string, Command>([['test-command', command]]);
    const member = fakeMember({ id: 'user-1' });
    const interaction = fakeChatInputInteraction({ member, commands });

    await event.execute(interaction);

    expect(command.execute).toHaveBeenCalledWith(interaction);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('fuehrt den Befehl fuer einen globalen Admin auch bei hoeherer Berechtigungsstufe aus', async () => {
    const command = fakeCommand({ permissionLevel: PermissionLevel.ADMIN });
    const commands = new Collection<string, Command>([['test-command', command]]);
    const member = fakeMember({ id: 'admin-1', isAdministrator: true });
    const interaction = fakeChatInputInteraction({ member, commands });

    await event.execute(interaction);

    expect(command.execute).toHaveBeenCalledWith(interaction);
  });

  it('antwortet mit der Fehlermeldung eines AppError, wenn der Befehl fehlschlaegt', async () => {
    const command = fakeCommand({
      execute: vi.fn().mockRejectedValue(new PermissionError('Spezifische Berechtigungsmeldung')),
    });
    const commands = new Collection<string, Command>([['test-command', command]]);
    const member = fakeMember({ id: 'user-1' });
    const interaction = fakeChatInputInteraction({ member, commands });

    await event.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Spezifische Berechtigungsmeldung' }),
    );
  });

  it('antwortet mit einer generischen Fehlermeldung bei einem unerwarteten Fehler (kein AppError)', async () => {
    const command = fakeCommand({
      execute: vi.fn().mockRejectedValue(new Error('interner Datenbankfehler')),
    });
    const commands = new Collection<string, Command>([['test-command', command]]);
    const member = fakeMember({ id: 'user-1' });
    const interaction = fakeChatInputInteraction({ member, commands });

    await event.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('unerwarteter Fehler') }),
    );
    const replyContent = interaction.reply.mock.calls[0][0].content as string;
    expect(replyContent).not.toContain('interner Datenbankfehler');
  });

  it('nutzt followUp() statt reply(), wenn die Interaktion bereits beantwortet/deferred wurde', async () => {
    const command = fakeCommand({
      execute: vi.fn().mockRejectedValue(new PermissionError('Fehler nach Defer')),
    });
    const commands = new Collection<string, Command>([['test-command', command]]);
    const member = fakeMember({ id: 'user-1' });
    const interaction = fakeChatInputInteraction({ member, commands });
    Object.assign(interaction, { deferred: true });

    await event.execute(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Fehler nach Defer' }),
    );
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});

function fakeGuildMemberForButton(
  discordId: string,
  guildId: string,
  roleIds: string[] = [],
): GuildMember {
  const roles = new Set(roleIds);
  return {
    id: discordId,
    guild: { id: guildId },
    roles: {
      cache: { has: (roleId: string) => roles.has(roleId) },
      add: vi.fn(async (roleId: string) => {
        roles.add(roleId);
      }),
      remove: vi.fn(async (roleId: string) => {
        roles.delete(roleId);
      }),
    },
  } as unknown as GuildMember;
}

function fakeButtonInteraction(options: {
  customId: string;
  member: GuildMember;
  ephemeralSource?: boolean;
}): ButtonInteraction & {
  update: ReturnType<typeof vi.fn>;
  reply: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
} {
  const update = vi.fn().mockResolvedValue(undefined);
  const reply = vi.fn().mockResolvedValue(undefined);
  const followUp = vi.fn().mockResolvedValue(undefined);

  return {
    customId: options.customId,
    isChatInputCommand: () => false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    isAutocomplete: () => false,
    inGuild: () => true,
    guild: (options.member as unknown as { guild: { id: string } }).guild,
    member: options.member,
    user: { id: options.member.id },
    deferred: false,
    replied: false,
    message: {
      flags: { has: () => options.ephemeralSource ?? true },
    },
    update,
    reply,
    followUp,
  } as unknown as ButtonInteraction & {
    update: ReturnType<typeof vi.fn>;
    reply: ReturnType<typeof vi.fn>;
    followUp: ReturnType<typeof vi.fn>;
  };
}

/** Verifiziert + Profil vollstaendig + Fachrichtung gewaehlt - der "startklar fuer Klassenwahl"-Zustand. */
async function createClassReadyDiscordId(guildId: string): Promise<string> {
  const discordId = `discord-${randomUUID()}`;
  await setVerificationStatus(guildId, discordId, 'VERIFIED');
  await updatePersonalDetails(guildId, discordId, { profileCompletedAt: new Date() });
  await setMemberFachrichtung(guildId, discordId, 'SYSTEMINTEGRATION');
  return discordId;
}

async function setupGuildWithClassRoles(): Promise<{
  guildId: string;
  roleA: string;
  roleB: string;
}> {
  const guildId = `guild-${randomUUID()}`;
  await getOrCreateGuildConfig(guildId);
  const roleA = `role-a-${randomUUID()}`;
  const roleB = `role-b-${randomUUID()}`;
  await updateClassRole(guildId, 'A', roleA);
  await updateClassRole(guildId, 'B', roleB);
  return { guildId, roleA, roleB };
}

describe('interactionCreate - zweistufiger Klassenauswahl-Flow', () => {
  it('ein Klick auf eine Klasse (tentativ) persistiert nichts, sondern zeigt nur den Bestaetigungs-Screen', async () => {
    const { guildId } = await setupGuildWithClassRoles();
    const discordId = await createClassReadyDiscordId(guildId);
    const member = fakeGuildMemberForButton(discordId, guildId);
    const interaction = fakeButtonInteraction({
      customId: buildClassCustomId('A'),
      member,
      ephemeralSource: false,
    });

    await event.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.anything()]),
        flags: expect.anything(),
      }),
    );
    const replyPayload = interaction.reply.mock.calls[0]?.[0];
    expect(replyPayload.embeds[0].toJSON().title).toContain('Klasse A ausgewählt');

    const stored = await getMemberWithClass(guildId, discordId);
    expect(stored?.classId).toBeNull();

    const auditEntries = await listAuditEvents(guildId, { targetDiscordId: discordId });
    expect(auditEntries).toHaveLength(0);
  });

  it('erst die ausdrueckliche Bestaetigung persistiert die Klassenzuordnung und vergibt die Rolle', async () => {
    const { guildId, roleA } = await setupGuildWithClassRoles();
    const discordId = await createClassReadyDiscordId(guildId);
    const member = fakeGuildMemberForButton(discordId, guildId);
    const interaction = fakeButtonInteraction({
      customId: buildClassConfirmCustomId('A'),
      member,
      ephemeralSource: true,
    });

    await event.execute(interaction);

    expect(interaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('🎉') }),
    );
    expect(member.roles.add).toHaveBeenCalledWith(roleA, expect.any(String));

    const stored = await getMemberWithClass(guildId, discordId);
    expect(stored?.class?.name).toBe('A');

    const auditEntries = await listAuditEvents(guildId, {
      targetDiscordId: discordId,
      action: 'class.assign',
    });
    expect(auditEntries).toHaveLength(1);
  });

  it('"Zurueck" verwirft die tentative Auswahl und zeigt wieder die volle Uebersicht, ohne etwas zu persistieren', async () => {
    const { guildId } = await setupGuildWithClassRoles();
    const discordId = await createClassReadyDiscordId(guildId);
    const member = fakeGuildMemberForButton(discordId, guildId);
    const interaction = fakeButtonInteraction({ customId: CLASS_BACK_CUSTOM_ID, member });

    await event.execute(interaction);

    expect(interaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        content: null,
        embeds: expect.arrayContaining([expect.anything()]),
      }),
    );
    const updatePayload = interaction.update.mock.calls[0]?.[0];
    expect(updatePayload.embeds[0].toJSON().title).toContain('Erkennst du deine Klasse wieder?');

    const stored = await getMemberWithClass(guildId, discordId);
    expect(stored?.classId).toBeNull();
  });

  it('"Hilfe" meldet die Anfrage per Audit-Log, ohne eine Klassenzuordnung zu erzwingen', async () => {
    const { guildId } = await setupGuildWithClassRoles();
    const discordId = await createClassReadyDiscordId(guildId);
    const member = fakeGuildMemberForButton(discordId, guildId);
    const interaction = fakeButtonInteraction({ customId: CLASS_HELP_CUSTOM_ID, member });

    await event.execute(interaction);

    expect(interaction.update).toHaveBeenCalled();

    const stored = await getMemberWithClass(guildId, discordId);
    expect(stored?.classId).toBeNull();

    const auditEntries = await listAuditEvents(guildId, {
      targetDiscordId: discordId,
      action: 'class.help_requested',
    });
    expect(auditEntries).toHaveLength(1);
  });

  it('ein bereits zugeordnetes Mitglied kann seine Klasse nicht selbst wechseln - kein Bestaetigungs-Screen', async () => {
    const { guildId } = await setupGuildWithClassRoles();
    const discordId = await createClassReadyDiscordId(guildId);
    const member = fakeGuildMemberForButton(discordId, guildId);
    await assignClass(member, await getOrCreateGuildConfig(guildId), 'A', discordId);

    const interaction = fakeButtonInteraction({
      customId: buildClassCustomId('B'),
      member,
      ephemeralSource: false,
    });

    await event.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('kann nicht selbst gewechselt werden'),
      }),
    );
    const replyPayload = interaction.reply.mock.calls[0]?.[0];
    expect(replyPayload.embeds).toBeUndefined();

    const stored = await getMemberWithClass(guildId, discordId);
    expect(stored?.class?.name).toBe('A');
  });
});
