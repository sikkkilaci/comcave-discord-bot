import { ChannelType, DiscordAPIError, type Guild } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { postAdminPanel } from '../src/services/adminPanelService.js';
import { ADMIN_PANEL_KLASSENBEREICHE_CUSTOM_ID } from '../src/bot/ui/adminPanelMessage.js';
import { ValidationError } from '../src/utils/errors.js';

interface FakeRow {
  components: Array<{ customId?: string | null }>;
}

interface FakeMessage {
  components: FakeRow[];
}

function fakeGuild(options: {
  hasChannel?: boolean;
  existingMessages?: FakeMessage[];
  sendImpl?: () => Promise<unknown>;
}): { guild: Guild; sendCalls: unknown[] } {
  const sendCalls: unknown[] = [];
  const channel =
    options.hasChannel === false
      ? null
      : {
          id: 'channel-verwaltung',
          type: ChannelType.GuildText,
          name: '⚙️-verwaltung',
          toString: () => '#⚙️-verwaltung',
          messages: {
            fetch: vi.fn(
              async () =>
                new Map(
                  (options.existingMessages ?? []).map((message, index) => [
                    `msg-${index}`,
                    message,
                  ]),
                ),
            ),
          },
          send: vi.fn(async (payload: unknown) => {
            sendCalls.push(payload);
            if (options.sendImpl) return options.sendImpl();
            return { id: 'sent-msg' };
          }),
        };

  const channels = channel ? [channel] : [];
  const guild = {
    channels: {
      fetch: vi.fn(async () => new Map(channels.map((c) => [c.id, c]))),
    },
  } as unknown as Guild;

  return { guild, sendCalls };
}

describe('postAdminPanel', () => {
  it('wirft ValidationError, wenn der Verwaltungskanal noch nicht existiert', async () => {
    const { guild } = fakeGuild({ hasChannel: false });

    await expect(postAdminPanel(guild)).rejects.toBeInstanceOf(ValidationError);
  });

  it('postet das Panel, wenn noch keine passende Nachricht existiert', async () => {
    const { guild, sendCalls } = fakeGuild({ existingMessages: [] });

    const result = await postAdminPanel(guild);

    expect(result).toEqual({ posted: true, channelId: 'channel-verwaltung' });
    expect(sendCalls).toHaveLength(1);
  });

  it('postet das Panel nicht erneut, wenn bereits eine Panel-Nachricht vorhanden ist', async () => {
    const { guild, sendCalls } = fakeGuild({
      existingMessages: [
        { components: [{ components: [{ customId: ADMIN_PANEL_KLASSENBEREICHE_CUSTOM_ID }] }] },
      ],
    });

    const result = await postAdminPanel(guild);

    expect(result).toEqual({ posted: false, channelId: 'channel-verwaltung' });
    expect(sendCalls).toHaveLength(0);
  });

  it('wirft eine verstaendliche ValidationError, wenn dem Bot die Sende-Berechtigung fehlt', async () => {
    const { guild } = fakeGuild({
      existingMessages: [],
      sendImpl: async () => {
        throw new DiscordAPIError(
          { code: 50013, message: 'Missing Permissions' },
          50013,
          403,
          'POST',
          '/channels/channel-verwaltung/messages',
          { body: undefined, files: undefined },
        );
      },
    });

    await expect(postAdminPanel(guild)).rejects.toBeInstanceOf(ValidationError);
  });
});
