import { randomUUID } from 'node:crypto';
import type { ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { Collection } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import event from '../src/bot/events/interactionCreate.js';
import type { Command } from '../src/types/command.js';
import type { BotClient } from '../src/types/client.js';
import { PermissionLevel } from '../src/permissions/PermissionLevel.js';
import { PermissionError } from '../src/utils/errors.js';

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
