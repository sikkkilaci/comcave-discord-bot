import { randomUUID } from 'node:crypto';
import { ChannelType, Collection, DiscordAPIError, type Guild } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import { getClassByName, updateClassChannels } from '../src/repositories/classRepository.js';
import { listAuditEvents } from '../src/repositories/auditLogRepository.js';
import { isServerAdmin, isVerified } from '../src/permissions/checkPermission.js';
import { bootstrapServer } from '../src/services/serverBootstrapService.js';
import { VERIFY_BUTTON_CUSTOM_ID } from '../src/bot/ui/verificationMessage.js';
import { ValidationError } from '../src/utils/errors.js';
import { CLASS_NAMES } from '../src/types/domain.js';
import type { GuildMember } from 'discord.js';

interface FakeRole {
  id: string;
  name: string;
  position: number;
  permissions: { has: (bit: bigint) => boolean };
}

interface FakeButtonComponent {
  customId?: string;
}

interface FakeMessage {
  id: string;
  components: Array<{ components: FakeButtonComponent[] }>;
}

interface FakeChannel {
  id: string;
  name: string;
  type: ChannelType;
  parentId: string | null;
  send: ReturnType<typeof vi.fn>;
  messages: { fetch: ReturnType<typeof vi.fn> };
  setParent: ReturnType<typeof vi.fn>;
  permissionOverwrites: { set: ReturnType<typeof vi.fn> };
}

interface FakeCreatedRoleOptions {
  name: string;
  permissions: unknown[];
}

interface FakeCreatedChannelOptions {
  name: string;
  type: ChannelType;
  parent?: string;
  permissionOverwrites?: Array<{ id: string; allow?: bigint[]; deny?: bigint[] }>;
  position?: number;
}

function makeMissingPermissionsError(): DiscordAPIError {
  return new DiscordAPIError(
    { code: 50013, message: 'Missing Permissions' },
    50013,
    403,
    'POST',
    '/guilds/x',
    { body: undefined, files: undefined },
  );
}

/**
 * Simuliert den Sende-/Empfangs-Roundtrip: discord.js-Builder (ButtonBuilder
 * etc.) tragen den customId intern als `data.custom_id` (Discord-API-Rohformat),
 * aber eine ueber `channel.messages.fetch()` empfangene Nachricht liefert dafuer
 * ein camelCase `customId`-Property auf dem geparsten Component-Objekt. Ohne
 * diese Umwandlung wuerde die Idempotenz-Erkennung (channelHasMatchingMessage()
 * in serverBootstrapService.ts) eine gerade erst gesendete Nachricht nicht
 * wiedererkennen.
 */
function toReceivedComponents(
  components: Array<{
    components?: Array<{ data?: { custom_id?: string }; customId?: string }>;
  }> = [],
): Array<{ components: FakeButtonComponent[] }> {
  return components.map((row) => ({
    components: (row.components ?? []).map((c) => ({ customId: c.data?.custom_id ?? c.customId })),
  }));
}

function makeFakeChannel(
  id: string,
  name: string,
  type: ChannelType,
  parentId: string | null = null,
): FakeChannel {
  const messages: FakeMessage[] = [];
  const channel: FakeChannel = {
    id,
    name,
    type,
    parentId,
    send: vi.fn(
      async (payload: {
        components?: Array<{
          components?: Array<{ data?: { custom_id?: string }; customId?: string }>;
        }>;
      }) => {
        const message: FakeMessage = {
          id: `message-${messages.length + 1}`,
          components: toReceivedComponents(payload.components),
        };
        messages.push(message);
        return message;
      },
    ),
    messages: {
      fetch: vi.fn(async () => new Collection(messages.map((m) => [m.id, m]))),
    },
    setParent: vi.fn(async (newParentId: string) => {
      channel.parentId = newParentId;
      return channel;
    }),
    permissionOverwrites: {
      set: vi.fn(async () => channel),
      // Simuliert vollen Bot-Zugriff von Anfang an (dieses Testfile deckt den Bootstrap-Ablauf
      // ab, nicht ensureBotAccess()/die Selbstheilungs-Logik aus classAreaService.ts - dafuer
      // gibt es eigene Tests in tests/classAreaService.test.ts).
      cache: { get: () => ({ allow: { has: () => true } }) },
      create: vi.fn(async () => channel),
    },
  };
  return channel;
}

function fakeGuild(options: {
  guildId?: string;
  roles?: Map<string, FakeRole>;
  channels?: Map<string, FakeChannel>;
  botTopRolePosition?: number;
  createRoleImpl?: (opts: FakeCreatedRoleOptions) => Promise<FakeRole>;
  createChannelImpl?: (opts: FakeCreatedChannelOptions) => Promise<FakeChannel>;
}): {
  guild: Guild;
  roles: Map<string, FakeRole>;
  channels: Map<string, FakeChannel>;
  roleCreateCalls: FakeCreatedRoleOptions[];
  channelCreateCalls: FakeCreatedChannelOptions[];
} {
  const roles = options.roles ?? new Map<string, FakeRole>();
  const channels = options.channels ?? new Map<string, FakeChannel>();
  const roleCreateCalls: FakeCreatedRoleOptions[] = [];
  const channelCreateCalls: FakeCreatedChannelOptions[] = [];
  let roleCounter = 0;
  let channelCounter = 0;

  const guildId = options.guildId ?? `guild-${randomUUID()}`;

  const rolesCreate = vi.fn(async (opts: FakeCreatedRoleOptions) => {
    roleCreateCalls.push(opts);
    if (options.createRoleImpl) return options.createRoleImpl(opts);
    roleCounter += 1;
    const role: FakeRole = {
      id: `role-${guildId}-${roleCounter}-${opts.name}`,
      name: opts.name,
      position: 1,
      permissions: { has: () => false },
    };
    roles.set(role.id, role);
    return role;
  });

  const rolesFetch = vi.fn(async (id?: string) => {
    if (id) {
      const role = roles.get(id);
      if (!role) throw new Error('Unknown role');
      return role;
    }
    return new Collection(Array.from(roles.entries()));
  });

  const channelsCreate = vi.fn(async (opts: FakeCreatedChannelOptions) => {
    channelCreateCalls.push(opts);
    if (options.createChannelImpl) {
      const channel = await options.createChannelImpl(opts);
      channels.set(channel.id, channel);
      return channel;
    }
    channelCounter += 1;
    const channel = makeFakeChannel(
      `channel-${guildId}-${channelCounter}-${opts.name}`,
      opts.name,
      opts.type,
      opts.parent ?? null,
    );
    channels.set(channel.id, channel);
    return channel;
  });

  const channelsFetch = vi.fn(async (id?: string) => {
    if (id) {
      const channel = channels.get(id);
      if (!channel) throw new Error('Unknown channel');
      return channel;
    }
    return new Collection(Array.from(channels.entries()));
  });

  const botTopRolePosition = options.botTopRolePosition ?? 100;
  // permissions.has() liefert immer true: diese Tests decken den Bootstrap-Ablauf ab, nicht die
  // Overwrite-Berechtigungspruefung aus classAreaService.ts (siehe dortige eigene Tests dafuer).
  const me = {
    roles: { highest: { id: 'role-bot', position: botTopRolePosition } },
    permissions: { has: () => true },
  };

  const guild = {
    id: guildId,
    roles: {
      everyone: { id: 'role-everyone' },
      create: rolesCreate,
      fetch: rolesFetch,
    },
    channels: {
      create: channelsCreate,
      fetch: channelsFetch,
      get cache(): Collection<string, FakeChannel> {
        return new Collection(Array.from(channels.entries()));
      },
    },
    members: {
      me,
      fetchMe: vi.fn(async () => me),
    },
  } as unknown as Guild;

  return { guild, roles, channels, roleCreateCalls, channelCreateCalls };
}

function fakeMember(roleIds: string[]): GuildMember {
  const ids = new Set(roleIds);
  return {
    id: 'member-1',
    guild: { ownerId: 'someone-else' },
    permissions: { has: () => false },
    roles: { cache: { has: (id: string) => ids.has(id) } },
  } as unknown as GuildMember;
}

describe('serverBootstrapService', () => {
  describe('bootstrapServer - kompletter leerer Server', () => {
    it('legt alle Grund-/Klassenrollen, globalen Kanaele, privaten Klassenbereiche und Nachrichten neu an', async () => {
      const { guild, roleCreateCalls, channelCreateCalls } = fakeGuild({});

      const result = await bootstrapServer(guild, 'actor-1');

      expect(result.verifiedRole.created).toBe(true);
      expect(result.onboardedRole.created).toBe(true);
      expect(result.adminRole.created).toBe(true);
      expect(result.moderatorRole.created).toBe(true);
      for (const name of CLASS_NAMES) {
        expect(result.classes[name].role.created).toBe(true);
        expect(result.classes[name].area.categoryCreated).toBe(true);
        expect(result.classes[name].area.channelsCreated).toHaveLength(8);
      }

      expect(result.verificationChannel.created).toBe(true);
      expect(result.whereAmIChannel.created).toBe(true);
      expect(result.logChannel.created).toBe(true);
      expect(result.schulhofChannel.created).toBe(true);
      expect(result.verificationMessagePosted).toBe(true);
      expect(result.whereAmIMessagePosted).toBe(true);
      expect(result.warnings).toEqual([]);

      // 7 Rollen (Verifiziert/Mitglied/Admin/Moderator/Klasse A/B/C), alle ohne Basis-Berechtigung.
      expect(roleCreateCalls).toHaveLength(7);
      for (const call of roleCreateCalls) {
        expect(call.permissions).toEqual([]);
      }

      // 4 globale Kanaele (Verifizierung/wo-bin-ich/Log/Schulhof) + 3 x (1 Kategorie + 8 Kanaele)
      // = 31, plus die globale COMCAVE-Plattformstruktur (ensureGlobalServerStructure): 8
      // Kategorien + 28 neue Kanaele (31 Kanaele in der Struktur, davon 3 - Verifizierung/
      // wo-bin-ich/Log - wiederverwendet statt neu angelegt) = 36. Gesamt 31 + 36 = 67.
      expect(channelCreateCalls).toHaveLength(67);

      const guildConfig = await getOrCreateGuildConfig(guild.id);
      expect(guildConfig.verifiedRoleId).toBe(result.verifiedRole.id);
      expect(guildConfig.onboardedRoleId).toBe(result.onboardedRole.id);
      expect(guildConfig.adminRoleId).toBe(result.adminRole.id);
      expect(guildConfig.moderatorRoleId).toBe(result.moderatorRole.id);
      expect(guildConfig.whereAmIChannelId).toBe(result.whereAmIChannel.id);
      expect(guildConfig.welcomeChannelId).toBe(result.verificationChannel.id);
      expect(guildConfig.logChannelId).toBe(result.logChannel.id);

      for (const name of CLASS_NAMES) {
        const klasse = await getClassByName(guild.id, name);
        expect(klasse?.roleId).toBe(result.classes[name].role.id);
        expect(klasse?.categoryId).toBeTruthy();
        expect(klasse?.chatChannelId).toBeTruthy();
        expect(klasse?.voiceChannelId).toBeTruthy();
      }

      const auditEntries = await listAuditEvents(guild.id);
      expect(auditEntries.some((e) => e.action === 'server.bootstrap')).toBe(true);
      expect(auditEntries.some((e) => e.action === 'admin.roles.setup')).toBe(true);
      expect(auditEntries.filter((e) => e.action === 'class.area_setup')).toHaveLength(3);
    });

    it(
      'aktualisiert bei den drei reservierten globalen Kanaelen (Verifizierung/wo-bin-ich/Log) ' +
        'zuerst die eigenen Overwrites und erst danach setParent - sonst schlaegt setParent mit ' +
        'DiscordAPIError 50001 "Missing Access" fehl, wenn der Kanal (wie der Log-Kanal) den Bot ' +
        'per @everyone-Deny ohne eigenen Allow-Overwrite "blind" macht',
      async () => {
        const { guild, channels } = fakeGuild({});

        const result = await bootstrapServer(guild, 'actor-1');

        const logChannel = channels.get(result.logChannel.id);
        expect(logChannel).toBeDefined();
        const overwritesCallOrder =
          logChannel?.permissionOverwrites.set.mock.invocationCallOrder[0];
        const setParentCallOrder = logChannel?.setParent.mock.invocationCallOrder[0];
        expect(overwritesCallOrder).toBeDefined();
        expect(setParentCallOrder).toBeDefined();
        expect(overwritesCallOrder as number).toBeLessThan(setParentCallOrder as number);
      },
    );
  });

  describe('bootstrapServer - Idempotenz', () => {
    it('legt bei erneuter Ausfuehrung nichts doppelt an und postet keine zweiten Nachrichten', async () => {
      const shared = fakeGuild({});
      const { guild, roleCreateCalls, channelCreateCalls } = shared;

      await bootstrapServer(guild, 'actor-1');
      const roleCallsAfterFirst = roleCreateCalls.length;
      const channelCallsAfterFirst = channelCreateCalls.length;

      const second = await bootstrapServer(guild, 'actor-1');

      expect(roleCreateCalls.length).toBe(roleCallsAfterFirst);
      expect(channelCreateCalls.length).toBe(channelCallsAfterFirst);

      expect(second.verifiedRole.created).toBe(false);
      expect(second.adminRole.created).toBe(false);
      expect(second.moderatorRole.created).toBe(false);
      for (const name of CLASS_NAMES) {
        expect(second.classes[name].role.created).toBe(false);
        expect(second.classes[name].area.categoryCreated).toBe(false);
        expect(second.classes[name].area.channelsCreated).toHaveLength(0);
      }
      expect(second.verificationChannel.created).toBe(false);
      expect(second.whereAmIChannel.created).toBe(false);
      expect(second.logChannel.created).toBe(false);
      expect(second.verificationMessagePosted).toBe(false);
      expect(second.whereAmIMessagePosted).toBe(false);
      expect(second.warnings).toEqual([]);
    });

    it('verweigert einen parallelen zweiten Aufruf fuer denselben Server, waehrend der erste noch laeuft', async () => {
      let resolveCreate!: (role: FakeRole) => void;
      const pendingRole = new Promise<FakeRole>((resolve) => {
        resolveCreate = resolve;
      });

      const { guild } = fakeGuild({
        createRoleImpl: async (opts) => {
          const role = await pendingRole;
          return { ...role, name: opts.name };
        },
      });

      const firstRun = bootstrapServer(guild, 'actor-1');
      await expect(bootstrapServer(guild, 'actor-2')).rejects.toBeInstanceOf(ValidationError);

      resolveCreate({
        id: 'role-x',
        name: 'x',
        position: 1,
        permissions: { has: () => false },
      });
      await firstRun;
    });
  });

  describe('bootstrapServer - teilweise vorhandene Rollen', () => {
    it('verwendet manuell bereits existierende Rollen mit passendem Namen wieder, statt sie neu anzulegen', async () => {
      const roles = new Map<string, FakeRole>([
        [
          'role-existing-admin',
          {
            id: 'role-existing-admin',
            name: 'Admin',
            position: 1,
            permissions: { has: () => false },
          },
        ],
        [
          'role-existing-klasse-a',
          {
            id: 'role-existing-klasse-a',
            name: 'Klasse A',
            position: 1,
            permissions: { has: () => false },
          },
        ],
      ]);
      const { guild, roleCreateCalls } = fakeGuild({ roles });

      const result = await bootstrapServer(guild, 'actor-1');

      expect(result.adminRole.created).toBe(false);
      expect(result.adminRole.id).toBe('role-existing-admin');
      expect(result.classes.A.role.created).toBe(false);
      expect(result.classes.A.role.id).toBe('role-existing-klasse-a');

      expect(result.verifiedRole.created).toBe(true);
      expect(result.moderatorRole.created).toBe(true);
      expect(result.classes.B.role.created).toBe(true);
      expect(result.classes.C.role.created).toBe(true);

      expect(roleCreateCalls.some((c) => c.name === 'Admin')).toBe(false);
      expect(roleCreateCalls.some((c) => c.name === 'Klasse A')).toBe(false);
    });

    it('wirft ValidationError, wenn eine wiederverwendete Rolle Administrator-Rechte traegt', async () => {
      const roles = new Map<string, FakeRole>([
        [
          'role-existing-admin',
          {
            id: 'role-existing-admin',
            name: 'Verifiziert',
            position: 1,
            permissions: { has: () => true },
          },
        ],
      ]);
      const { guild } = fakeGuild({ roles });

      await expect(bootstrapServer(guild, 'actor-1')).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('bootstrapServer - teilweise vorhandene Kanaele', () => {
    it('verwendet einen bereits existierenden #wo-bin-ich-Kanal wieder und postet die Nachricht, da noch keine existiert', async () => {
      const channels = new Map<string, FakeChannel>([
        [
          'channel-existing-woBinIch',
          makeFakeChannel('channel-existing-woBinIch', '🧭-wo-bin-ich', ChannelType.GuildText),
        ],
      ]);
      const { guild } = fakeGuild({ channels });

      const result = await bootstrapServer(guild, 'actor-1');

      expect(result.whereAmIChannel.created).toBe(false);
      expect(result.whereAmIChannel.id).toBe('channel-existing-woBinIch');
      expect(result.whereAmIMessagePosted).toBe(true);
    });

    it('postet keine zweite Nachricht, wenn der wiederverwendete Kanal bereits eine passende Nachricht enthaelt', async () => {
      const existingChannel = makeFakeChannel(
        'channel-existing-verify',
        '🔐-verifizierung',
        ChannelType.GuildText,
      );
      await existingChannel.send({
        components: [{ components: [{ customId: VERIFY_BUTTON_CUSTOM_ID }] }],
      });
      const channels = new Map<string, FakeChannel>([[existingChannel.id, existingChannel]]);
      const { guild } = fakeGuild({ channels });

      const result = await bootstrapServer(guild, 'actor-1');

      expect(result.verificationChannel.created).toBe(false);
      expect(result.verificationMessagePosted).toBe(false);
      // Der erste send()-Aufruf war die Testvorbereitung oben, kein zweiter durch den Bootstrap.
      expect(existingChannel.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('bootstrapServer - bereits vorhandene Konfiguration', () => {
    it('ist ein reiner No-Op, wenn Server bereits vollstaendig ueber DB-IDs konfiguriert ist', async () => {
      const { guild, roleCreateCalls, channelCreateCalls } = fakeGuild({});

      const first = await bootstrapServer(guild, 'actor-1');
      roleCreateCalls.length = 0;
      channelCreateCalls.length = 0;

      // Simuliert einen komplett neuen Bot-Prozess (In-Process-Lock ist bereits
      // durch den finally-Block des ersten Laufs wieder frei) mit identischem
      // Discord- und DB-Zustand.
      const result = await bootstrapServer(guild, 'actor-2');

      expect(roleCreateCalls).toHaveLength(0);
      expect(channelCreateCalls).toHaveLength(0);
      expect(result.verifiedRole.id).toBe(first.verifiedRole.id);
      expect(result.warnings).toEqual([]);
    });
  });

  describe('bootstrapServer - fehlende Discord-Berechtigungen', () => {
    it('uebersetzt eine fehlende Berechtigung beim Rollen-Anlegen in eine ValidationError', async () => {
      const { guild } = fakeGuild({
        createRoleImpl: async () => {
          throw makeMissingPermissionsError();
        },
      });

      await expect(bootstrapServer(guild, 'actor-1')).rejects.toBeInstanceOf(ValidationError);
    });

    it('uebersetzt eine fehlende Berechtigung beim Kanal-Anlegen in eine ValidationError', async () => {
      const { guild } = fakeGuild({
        createChannelImpl: async () => {
          throw makeMissingPermissionsError();
        },
      });

      await expect(bootstrapServer(guild, 'actor-1')).rejects.toBeInstanceOf(ValidationError);
    });

    it('uebersetzt eine fehlende Berechtigung beim Senden der Verifizierungsnachricht in eine ValidationError', async () => {
      const { guild } = fakeGuild({
        createChannelImpl: async (opts) => {
          const channel = makeFakeChannel(`channel-${opts.name}`, opts.name, opts.type);
          channel.send = vi.fn(async () => {
            throw makeMissingPermissionsError();
          });
          return channel;
        },
      });

      await expect(bootstrapServer(guild, 'actor-1')).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('bootstrapServer - Permission Overwrites', () => {
    it('verweigert @everyone die Sicht auf den Log-Kanal und erlaubt sie nur der Admin-Rolle', async () => {
      const { guild, channelCreateCalls } = fakeGuild({});

      const result = await bootstrapServer(guild, 'actor-1');

      const logCreateCall = channelCreateCalls.find((c) => c.name === '📋-bot-log');
      expect(logCreateCall).toBeDefined();
      const everyoneOverwrite = logCreateCall?.permissionOverwrites?.find(
        (o) => o.id === 'role-everyone',
      );
      expect(everyoneOverwrite?.deny).toContain(BigInt(1) << BigInt(10)); // ViewChannel bit, siehe PermissionFlagsBits
      const adminOverwrite = logCreateCall?.permissionOverwrites?.find(
        (o) => o.id === result.adminRole.id,
      );
      expect(adminOverwrite).toBeDefined();
    });

    it(
      'legt den Schulhof-Kanal ganz oben (position 0) ausserhalb jeder Kategorie an, sichtbar ' +
        'fuer die Verifiziert-Rolle (nicht @everyone, NICHT erst ab der Mitglied-Rolle) - ' +
        'klassenuebergreifender Talk auch fuer Mitglieder mit noch ungeklaerter Klasse',
      async () => {
        const { guild, channelCreateCalls } = fakeGuild({});

        const result = await bootstrapServer(guild, 'actor-1');

        const schulhofCreateCall = channelCreateCalls.find((c) => c.name === '🏫-schulhof');
        expect(schulhofCreateCall).toBeDefined();
        expect(schulhofCreateCall?.parent).toBeUndefined();
        expect(schulhofCreateCall?.position).toBe(0);

        const everyoneOverwrite = schulhofCreateCall?.permissionOverwrites?.find(
          (o) => o.id === 'role-everyone',
        );
        expect(everyoneOverwrite?.deny).toContain(BigInt(1) << BigInt(10));

        const verifiedOverwrite = schulhofCreateCall?.permissionOverwrites?.find(
          (o) => o.id === result.verifiedRole.id,
        );
        expect(verifiedOverwrite?.allow).toContain(BigInt(1) << BigInt(11)); // SendMessages

        // Die Mitglied-Rolle bekommt hier bewusst KEINEN eigenen Overwrite-Eintrag - Schulhof
        // haengt allein an der Verifiziert-Rolle.
        const onboardedOverwrite = schulhofCreateCall?.permissionOverwrites?.find(
          (o) => o.id === result.onboardedRole.id,
        );
        expect(onboardedOverwrite).toBeUndefined();
      },
    );

    it('warnt, wenn die Bot-Rolle nicht ueber den verwalteten Rollen steht', async () => {
      const { guild } = fakeGuild({ botTopRolePosition: 0 });

      const result = await bootstrapServer(guild, 'actor-1');

      expect(result.warnings.some((w) => w.includes('Bot-Rolle'))).toBe(true);
    });
  });

  describe('bootstrapServer - Guild-Isolation', () => {
    it('haelt die Konfiguration zweier Server vollstaendig getrennt', async () => {
      const guildA = fakeGuild({});
      const guildB = fakeGuild({});

      const resultA = await bootstrapServer(guildA.guild, 'actor-1');
      const resultB = await bootstrapServer(guildB.guild, 'actor-2');

      expect(resultA.adminRole.id).not.toBe(resultB.adminRole.id);

      const configA = await getOrCreateGuildConfig(guildA.guild.id);
      const configB = await getOrCreateGuildConfig(guildB.guild.id);
      expect(configA.adminRoleId).toBe(resultA.adminRole.id);
      expect(configB.adminRoleId).toBe(resultB.adminRole.id);
      expect(configA.adminRoleId).not.toBe(configB.adminRoleId);
    });
  });

  describe('bootstrapServer - Klassen A/B/C', () => {
    it('vergibt drei unterschiedliche Klassenrollen mit jeweils vollstaendigem privaten Bereich', async () => {
      const { guild } = fakeGuild({});

      const result = await bootstrapServer(guild, 'actor-1');

      const roleIds = CLASS_NAMES.map((name) => result.classes[name].role.id);
      expect(new Set(roleIds).size).toBe(3);

      for (const name of CLASS_NAMES) {
        expect(result.classes[name].role.name).toBe(`Klasse ${name}`);
        expect(result.classes[name].area.channelsCreated.sort()).toEqual(
          [
            '💬-klassenchat',
            '📢-ankuendigungen',
            '📅-termine',
            '🎓-pruefungen',
            '📝-berichtsheft',
            '📚-lernmaterial',
            '📚-kursplan',
            '🔊-sprachkanal',
          ].sort(),
        );
      }
    });
  });

  describe('bootstrapServer - Verifizierung', () => {
    it('setzt die Verifiziert-Rolle und postet eine Nachricht mit dem echten Verifizierungs-Button', async () => {
      const { guild, channels } = fakeGuild({});

      const result = await bootstrapServer(guild, 'actor-1');

      const channel = channels.get(result.verificationChannel.id);
      expect(channel?.send).toHaveBeenCalledTimes(1);
      const payload = (channel?.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
        components: Array<{ components: Array<{ data?: { custom_id?: string } }> }>;
      };
      const customIds = payload.components.flatMap((row) =>
        row.components.map((c) => c.data?.custom_id),
      );
      expect(customIds).toContain(VERIFY_BUTTON_CUSTOM_ID);
    });
  });

  describe('bootstrapServer - anschliessende Nutzung bestehender Services', () => {
    it('macht ein Mitglied mit der neu angelegten Admin-Rolle sofort ueber isServerAdmin() erkennbar', async () => {
      const { guild } = fakeGuild({});
      const result = await bootstrapServer(guild, 'actor-1');
      const guildConfig = await getOrCreateGuildConfig(guild.id);

      const member = fakeMember([result.adminRole.id]);

      expect(isServerAdmin(member, guildConfig)).toBe(true);
    });

    it('macht ein Mitglied mit der neu angelegten Verifiziert-Rolle sofort ueber isVerified() erkennbar', async () => {
      const { guild } = fakeGuild({});
      const result = await bootstrapServer(guild, 'actor-1');
      const guildConfig = await getOrCreateGuildConfig(guild.id);

      const member = fakeMember([result.verifiedRole.id]);
      expect(isVerified(member, guildConfig)).toBe(true);
    });

    it('liefert eine Klasse mit gesetzter Rolle, wie sie assignClass()/setupClassArea() voraussetzen', async () => {
      const { guild } = fakeGuild({});
      const result = await bootstrapServer(guild, 'actor-1');

      const klasse = await getClassByName(guild.id, 'A');
      expect(klasse?.roleId).toBe(result.classes.A.role.id);

      // updateClassChannels() (von classAreaService.ts genutzt) funktioniert
      // auf dem vom Bootstrap angelegten Datensatz unveraendert weiter.
      const updated = await updateClassChannels(guild.id, 'A', { chatChannelId: 'custom-channel' });
      expect(updated.chatChannelId).toBe('custom-channel');
    });
  });
});
