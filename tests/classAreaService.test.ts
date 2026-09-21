import { randomUUID } from 'node:crypto';
import { ChannelType, DiscordAPIError, PermissionFlagsBits, type Guild } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import {
  getOrCreateGuildConfig,
  updateGuildConfig,
} from '../src/repositories/guildConfigRepository.js';
import { getClassByName, updateClassRole } from '../src/repositories/classRepository.js';
import { listAuditEvents } from '../src/repositories/auditLogRepository.js';
import { setupClassArea } from '../src/services/classAreaService.js';
import { ValidationError } from '../src/utils/errors.js';

interface FakeOverwrite {
  id: string;
  allow?: bigint[];
  deny?: bigint[];
}

interface FakeCreateOptions {
  name: string;
  type: ChannelType;
  parent?: string;
  permissionOverwrites?: FakeOverwrite[];
  topic?: string;
}

const EVERYONE_ID = 'role-everyone';

/** Deterministische Fake-ID, damit Tests Eltern-/Kind-Beziehungen ohne Aufrufreihenfolge pruefen koennen. */
function fakeIdFor(opts: FakeCreateOptions): string {
  return opts.type === ChannelType.GuildCategory ? `category:${opts.name}` : `channel:${opts.name}`;
}

/**
 * Alle Berechtigungs-Bits, die dieses Modul jemals per Overwrite vergibt
 * (siehe buildOverwrites()/CLASS_LEAD_CHANNEL_PERMISSIONS in classAreaService.ts),
 * plus ManageChannels selbst - als Default fuer den Fake-Bot verwendet, damit
 * bestehende Tests (die diese Berechtigungs-Vorabpruefung nicht betreffen)
 * unveraendert weiterlaufen.
 */
const ALL_RELEVANT_BOT_PERMISSIONS = new Set<bigint>([
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.CreatePrivateThreads,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.MentionEveryone,
  PermissionFlagsBits.MuteMembers,
  PermissionFlagsBits.DeafenMembers,
  PermissionFlagsBits.MoveMembers,
  PermissionFlagsBits.ModerateMembers,
]);

function fakeGuild(options: {
  existingChannelIds?: Set<string>;
  createImpl?: (opts: FakeCreateOptions) => Promise<{ id: string }>;
  botPermissions?: Set<bigint>;
  sendImpl?: (channelId: string, text: string) => Promise<unknown>;
}): {
  guild: Guild;
  createCalls: FakeCreateOptions[];
  sendCalls: Array<{ channelId: string; text: string }>;
  pinCalls: string[];
} {
  const existing = options.existingChannelIds ?? new Set<string>();
  const createCalls: FakeCreateOptions[] = [];
  const sendCalls: Array<{ channelId: string; text: string }> = [];
  const pinCalls: string[] = [];
  const botPermissions = options.botPermissions ?? ALL_RELEVANT_BOT_PERMISSIONS;

  function fakeChannel(id: string) {
    return {
      id,
      send: vi.fn(async (text: string) => {
        sendCalls.push({ channelId: id, text });
        if (options.sendImpl) await options.sendImpl(id, text);
        return {
          pin: vi.fn(async () => {
            pinCalls.push(id);
          }),
        };
      }),
    };
  }

  const create = vi.fn(async (opts: FakeCreateOptions) => {
    createCalls.push(opts);
    if (options.createImpl) return options.createImpl(opts);
    return fakeChannel(fakeIdFor(opts));
  });

  const fetch = vi.fn(async (id: string) => {
    if (existing.has(id)) return { id };
    throw new Error('Unknown Channel');
  });

  const me = { permissions: { has: (bit: bigint) => botPermissions.has(bit) } };

  const guild = {
    roles: { everyone: { id: EVERYONE_ID } },
    channels: { create, fetch },
    members: { me, fetchMe: vi.fn(async () => me) },
  } as unknown as Guild;

  return { guild, createCalls, sendCalls, pinCalls };
}

async function setupGuildAndClass(overrides: { adminRoleId?: string } = {}) {
  const guildId = `guild-${randomUUID()}`;
  let guildConfig = await getOrCreateGuildConfig(guildId);
  if (overrides.adminRoleId) {
    guildConfig = await updateGuildConfig(guildId, { adminRoleId: overrides.adminRoleId });
  }
  const roleId = `role-a-${randomUUID()}`;
  await updateClassRole(guildId, 'A', roleId);
  const klasse = (await getClassByName(guildId, 'A'))!;
  return { guildId, guildConfig, klasse, roleId };
}

function overwriteFor(opts: FakeCreateOptions, roleId: string): FakeOverwrite | undefined {
  return opts.permissionOverwrites?.find((o) => o.id === roleId);
}

describe('classAreaService', () => {
  describe('setupClassArea - Validierung', () => {
    it('wirft ValidationError, wenn die Klasse noch keine Rolle hat', async () => {
      const guildId = `guild-${randomUUID()}`;
      const guildConfig = await getOrCreateGuildConfig(guildId);
      const { guild } = fakeGuild({});

      await expect(
        setupClassArea(guild, guildConfig, { name: 'A', roleId: null } as never, 'actor-1'),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('setupClassArea - Erstanlage', () => {
    it('legt Kategorie und alle sieben Kanaele neu an', async () => {
      const { guildConfig, klasse } = await setupGuildAndClass();
      const { guild, createCalls } = fakeGuild({});

      const result = await setupClassArea(guild, guildConfig, klasse, 'actor-1');

      expect(result.categoryCreated).toBe(true);
      expect(result.channelsCreated.sort()).toEqual(
        [
          '💬-klassenchat',
          '📢-ankuendigungen',
          '📅-termine',
          '🎓-pruefungen',
          '📝-berichtsheft',
          '📚-lernmaterial',
          '🔊-sprachkanal',
        ].sort(),
      );
      expect(result.channelsSkipped).toHaveLength(0);
      // 1 Kategorie + 7 Kanaele.
      expect(createCalls).toHaveLength(8);
    });

    it('setzt fuer alle Kanaele den korrekten parent (Kategorie) und Typ', async () => {
      const { guildConfig, klasse } = await setupGuildAndClass();
      const { guild, createCalls } = fakeGuild({});

      await setupClassArea(guild, guildConfig, klasse, 'actor-1');

      const category = createCalls.find((c) => c.type === ChannelType.GuildCategory);
      expect(category?.name).toBe('📁 Klasse A');

      const children = createCalls.filter((c) => c.type !== ChannelType.GuildCategory);
      expect(children).toHaveLength(7);
      for (const child of children) {
        expect(child.parent).toBe(fakeIdFor(category!));
      }

      const voice = createCalls.find((c) => c.name === '🔊-sprachkanal');
      expect(voice?.type).toBe(ChannelType.GuildVoice);
      const textChannels = children.filter((c) => c.name !== '🔊-sprachkanal');
      for (const textChannel of textChannels) {
        expect(textChannel.type).toBe(ChannelType.GuildText);
      }
    });

    it('persistiert Kategorie- und Kanal-IDs in der Datenbank', async () => {
      const { guildId, guildConfig, klasse } = await setupGuildAndClass();
      const { guild } = fakeGuild({});

      await setupClassArea(guild, guildConfig, klasse, 'actor-1');

      const stored = await getClassByName(guildId, 'A');
      expect(stored?.categoryId).toBe('category:📁 Klasse A');
      expect(stored?.chatChannelId).toBe('channel:💬-klassenchat');
      expect(stored?.announcementChannelId).toBe('channel:📢-ankuendigungen');
      expect(stored?.scheduleChannelId).toBe('channel:📅-termine');
      expect(stored?.examChannelId).toBe('channel:🎓-pruefungen');
      expect(stored?.reportChannelId).toBe('channel:📝-berichtsheft');
      expect(stored?.materialChannelId).toBe('channel:📚-lernmaterial');
      expect(stored?.voiceChannelId).toBe('channel:🔊-sprachkanal');
    });

    it('schreibt einen "class.area_setup"-Audit-Log-Eintrag', async () => {
      const { guildId, guildConfig, klasse } = await setupGuildAndClass();
      const { guild } = fakeGuild({});

      await setupClassArea(guild, guildConfig, klasse, 'actor-42');

      const entries = await listAuditEvents(guildId);
      const entry = entries.find((e) => e.action === 'class.area_setup');
      expect(entry).toBeDefined();
      expect(entry?.actorDiscordId).toBe('actor-42');
      const metadata = JSON.parse(entry?.metadata ?? '{}');
      expect(metadata.categoryCreated).toBe(true);
      expect(metadata.channelsCreated).toHaveLength(7);
    });

    it('verweigert der Klassenrolle Schreibrechte nur im Ankuendigungen-Kanal', async () => {
      const { guildConfig, klasse, roleId } = await setupGuildAndClass();
      const { guild, createCalls } = fakeGuild({});

      await setupClassArea(guild, guildConfig, klasse, 'actor-1');

      const announcements = createCalls.find((c) => c.name === '📢-ankuendigungen');
      const chat = createCalls.find((c) => c.name === '💬-klassenchat');

      const announcementsOverwrite = overwriteFor(announcements!, roleId);
      const chatOverwrite = overwriteFor(chat!, roleId);

      expect(announcementsOverwrite?.deny).toContain(PermissionFlagsBits.SendMessages);
      expect(announcementsOverwrite?.allow).not.toContain(PermissionFlagsBits.SendMessages);
      expect(chatOverwrite?.allow).toContain(PermissionFlagsBits.SendMessages);
    });

    it('schliesst @everyone auf jedem Kanal und der Kategorie aus', async () => {
      const { guildConfig, klasse } = await setupGuildAndClass();
      const { guild, createCalls } = fakeGuild({});

      await setupClassArea(guild, guildConfig, klasse, 'actor-1');

      expect(createCalls).toHaveLength(8);
      for (const call of createCalls) {
        const everyoneOverwrite = overwriteFor(call, EVERYONE_ID);
        expect(everyoneOverwrite?.deny).toContain(PermissionFlagsBits.ViewChannel);
      }
    });

    it('gewaehrt der konfigurierten Admin-Rolle Sichtbarkeit auf jedem Kanal', async () => {
      const adminRoleId = `role-admin-${randomUUID()}`;
      const { guildConfig, klasse } = await setupGuildAndClass({ adminRoleId });
      const { guild, createCalls } = fakeGuild({});

      await setupClassArea(guild, guildConfig, klasse, 'actor-1');

      expect(createCalls).toHaveLength(8);
      for (const call of createCalls) {
        const adminOverwrite = overwriteFor(call, adminRoleId);
        expect(adminOverwrite?.allow).toContain(PermissionFlagsBits.ViewChannel);
      }
    });

    it('gewaehrt einer bereits konfigurierten Klassenleitungs-Rolle ManageMessages ueberall, auch in Ankuendigungen', async () => {
      const { guildId, guildConfig } = await setupGuildAndClass();
      await updateClassRole(guildId, 'B', `role-b-${randomUUID()}`);
      const leadRoleId = `role-lead-${randomUUID()}`;
      // Klassenleitungs-Rolle wird direkt ueber Prisma gesetzt, da es noch
      // kein eigenes Setup-Command dafuer gibt (siehe ARCHITECTURE.md).
      await prisma.class.update({
        where: { guildId_name: { guildId, name: 'B' } },
        data: { leadRoleId },
      });
      const klasseB = (await getClassByName(guildId, 'B'))!;

      const { guild, createCalls } = fakeGuild({});
      await setupClassArea(guild, guildConfig, klasseB, 'actor-1');

      const chat = createCalls.find((c) => c.name === '💬-klassenchat');
      expect(overwriteFor(chat!, leadRoleId)?.allow).toContain(PermissionFlagsBits.ManageMessages);

      const announcements = createCalls.find((c) => c.name === '📢-ankuendigungen');
      expect(overwriteFor(announcements!, leadRoleId)?.allow).toContain(
        PermissionFlagsBits.SendMessages,
      );
    });

    it(
      'vergibt reine Sprachkanal-Rechte (Verbinden/Sprechen/Stummschalten/Isolieren/' +
        'Verschieben) ausschliesslich auf dem Sprachkanal, nie auf Textkanaelen - Discord lehnt ' +
        'sonst das Anlegen des Textkanals komplett mit 403/50013 "Missing Permissions" ab, selbst ' +
        'wenn der Bot diese Bits selbst besitzt',
      async () => {
        const adminRoleId = `role-admin-${randomUUID()}`;
        const { guildId, guildConfig, roleId } = await setupGuildAndClass({ adminRoleId });
        const leadRoleId = `role-lead-${randomUUID()}`;
        await prisma.class.update({
          where: { guildId_name: { guildId, name: 'A' } },
          data: { leadRoleId },
        });
        const klasseWithLead = (await getClassByName(guildId, 'A'))!;

        const { guild, createCalls } = fakeGuild({});
        await setupClassArea(guild, guildConfig, klasseWithLead, 'actor-1');

        const voiceOnlyBits = [
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
          PermissionFlagsBits.MuteMembers,
          PermissionFlagsBits.DeafenMembers,
          PermissionFlagsBits.MoveMembers,
        ];

        const textChannels = createCalls.filter(
          (c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildCategory,
        );
        for (const textChannel of textChannels) {
          if (textChannel.type === ChannelType.GuildCategory) continue; // Kategorie darf Sprach-Bits enthalten.
          for (const targetRoleId of [roleId, adminRoleId, leadRoleId]) {
            const overwrite = overwriteFor(textChannel, targetRoleId);
            for (const bit of voiceOnlyBits) {
              expect(overwrite?.allow ?? []).not.toContain(bit);
            }
          }
        }

        const voice = createCalls.find((c) => c.name === '🔊-sprachkanal');
        expect(overwriteFor(voice!, roleId)?.allow).toEqual(
          expect.arrayContaining([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]),
        );
        expect(overwriteFor(voice!, adminRoleId)?.allow).toEqual(
          expect.arrayContaining([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]),
        );
        expect(overwriteFor(voice!, leadRoleId)?.allow).toEqual(
          expect.arrayContaining(voiceOnlyBits),
        );
      },
    );
  });

  describe('setupClassArea - Idempotenz und Selbstheilung', () => {
    it('legt nichts neu an, wenn Kategorie und alle Kanaele bereits existieren', async () => {
      const { guildId, guildConfig, klasse } = await setupGuildAndClass();
      const first = fakeGuild({});
      await setupClassArea(first.guild, guildConfig, klasse, 'actor-1');
      const fullyConfigured = (await getClassByName(guildId, 'A'))!;

      const existingIds = new Set(
        [
          fullyConfigured.categoryId,
          fullyConfigured.chatChannelId,
          fullyConfigured.announcementChannelId,
          fullyConfigured.scheduleChannelId,
          fullyConfigured.examChannelId,
          fullyConfigured.reportChannelId,
          fullyConfigured.materialChannelId,
          fullyConfigured.voiceChannelId,
        ].filter((id): id is string => Boolean(id)),
      );
      const second = fakeGuild({ existingChannelIds: existingIds });

      const result = await setupClassArea(second.guild, guildConfig, fullyConfigured, 'actor-1');

      expect(result.categoryCreated).toBe(false);
      expect(result.channelsCreated).toHaveLength(0);
      expect(result.channelsSkipped).toHaveLength(7);
      expect(second.createCalls).toHaveLength(0);

      const auditEntries = await listAuditEvents(guildId);
      expect(auditEntries.filter((e) => e.action === 'class.area_setup')).toHaveLength(1);
    });

    it('repariert nur den fehlenden Kanal, wenn Kategorie und uebrige Kanaele noch existieren', async () => {
      const { guildId, guildConfig, klasse } = await setupGuildAndClass();
      const first = fakeGuild({});
      await setupClassArea(first.guild, guildConfig, klasse, 'actor-1');
      const configured = (await getClassByName(guildId, 'A'))!;

      // Alles existiert weiterhin ausser dem Klassenchat (z. B. versehentlich geloescht).
      const existingIds = new Set(
        [
          configured.categoryId,
          configured.announcementChannelId,
          configured.scheduleChannelId,
          configured.examChannelId,
          configured.reportChannelId,
          configured.materialChannelId,
          configured.voiceChannelId,
        ].filter((id): id is string => Boolean(id)),
      );
      const second = fakeGuild({ existingChannelIds: existingIds });

      const result = await setupClassArea(second.guild, guildConfig, configured, 'actor-1');

      expect(result.categoryCreated).toBe(false);
      expect(result.channelsCreated).toEqual(['💬-klassenchat']);
      expect(result.channelsSkipped).toHaveLength(6);
      expect(second.createCalls).toHaveLength(1);
      expect(second.createCalls[0]?.name).toBe('💬-klassenchat');

      const repaired = await getClassByName(guildId, 'A');
      expect(repaired?.chatChannelId).toBe('channel:💬-klassenchat');
    });
  });

  describe('setupClassArea - Discord-Fehlerbehandlung', () => {
    it('uebersetzt fehlende Bot-Berechtigungen (Discord-Fehlercode 50013) in eine verstaendliche ValidationError', async () => {
      const { guildConfig, klasse } = await setupGuildAndClass();
      const { guild } = fakeGuild({
        createImpl: async () => {
          throw new DiscordAPIError(
            { code: 50013, message: 'Missing Permissions' },
            50013,
            403,
            'POST',
            '/guilds/x/channels',
            { body: undefined, files: undefined },
          );
        },
      });

      await expect(setupClassArea(guild, guildConfig, klasse, 'actor-1')).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('reicht unbekannte Fehler beim Kanal-Anlegen unveraendert weiter', async () => {
      const { guildConfig, klasse } = await setupGuildAndClass();
      const { guild } = fakeGuild({
        createImpl: async () => {
          throw new Error('Netzwerkfehler');
        },
      });

      await expect(setupClassArea(guild, guildConfig, klasse, 'actor-1')).rejects.toThrow(
        'Netzwerkfehler',
      );
    });
  });

  describe('setupClassArea - Vorab-Pruefung der Bot-Berechtigungen fuer Overwrites', () => {
    it('nennt "Verbinden"/"Sprechen" als fehlende Berechtigung, wenn der Bot "Kanaele verwalten" hat, aber keine Sprachrechte (Regressionstest fuer den realen E2E-Fehler)', async () => {
      const { guildConfig, klasse } = await setupGuildAndClass();
      const botPermissions = new Set(ALL_RELEVANT_BOT_PERMISSIONS);
      botPermissions.delete(PermissionFlagsBits.Connect);
      botPermissions.delete(PermissionFlagsBits.Speak);
      const { guild, createCalls } = fakeGuild({ botPermissions });

      const error = await setupClassArea(guild, guildConfig, klasse, 'actor-1').catch((e) => e);

      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toContain('Verbinden');
      expect((error as ValidationError).message).toContain('Sprechen');
      // Die Meldung darf NICHT faelschlich "Kanaele verwalten" als fehlend nennen,
      // wenn der Bot diese Berechtigung tatsaechlich hat - das war der reale Bug.
      expect((error as ValidationError).message).not.toContain('Kanaele verwalten');
      // Kein einziger Kanal darf angelegt worden sein - Vorab-Pruefung greift vor dem ersten API-Call.
      expect(createCalls).toHaveLength(0);
    });

    it('nennt "Kanaele verwalten" als fehlend, wenn dem Bot genau diese Berechtigung fehlt', async () => {
      const { guildConfig, klasse } = await setupGuildAndClass();
      const botPermissions = new Set(ALL_RELEVANT_BOT_PERMISSIONS);
      botPermissions.delete(PermissionFlagsBits.ManageChannels);
      const { guild } = fakeGuild({ botPermissions });

      const error = await setupClassArea(guild, guildConfig, klasse, 'actor-1').catch((e) => e);

      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toContain('Kanaele verwalten');
    });

    it('legt den Klassenbereich erfolgreich an, wenn der Bot Administrator ist, auch ohne einzelne Basis-Berechtigungen', async () => {
      const { guildConfig, klasse } = await setupGuildAndClass();
      const botPermissions = new Set([PermissionFlagsBits.Administrator]);
      const { guild, createCalls } = fakeGuild({ botPermissions });

      const result = await setupClassArea(guild, guildConfig, klasse, 'actor-1');

      expect(result.categoryCreated).toBe(true);
      expect(createCalls.length).toBeGreaterThan(0);
    });

    it('legt den Klassenbereich weiterhin normal an, wenn der Bot alle benoetigten Berechtigungen hat (kein falsch-positiver Abbruch)', async () => {
      const { guildConfig, klasse } = await setupGuildAndClass();
      const { guild } = fakeGuild({});

      const result = await setupClassArea(guild, guildConfig, klasse, 'actor-1');

      expect(result.categoryCreated).toBe(true);
      expect(result.channelsCreated).toHaveLength(7);
    });
  });

  describe('setupClassArea - Kanal-Politur (Thema + Willkommensnachricht)', () => {
    it('setzt ein Thema und postet+pinnt eine Willkommensnachricht in jedem neu angelegten Textkanal', async () => {
      const { guildConfig, klasse } = await setupGuildAndClass();
      const { guild, createCalls, sendCalls, pinCalls } = fakeGuild({});

      await setupClassArea(guild, guildConfig, klasse, 'actor-1');

      const textChannelCalls = createCalls.filter(
        (c) => c.type === ChannelType.GuildText && c.name !== undefined,
      );
      expect(textChannelCalls).toHaveLength(6);
      for (const call of textChannelCalls) {
        expect(call.topic).toBeTruthy();
      }
      // 6 Textkanaele bekommen je eine gepostete UND angepinnte Willkommensnachricht.
      expect(sendCalls).toHaveLength(6);
      expect(pinCalls).toHaveLength(6);
    });

    it('postet keine Willkommensnachricht in den Sprachkanal', async () => {
      const { guildConfig, klasse } = await setupGuildAndClass();
      const { guild, sendCalls } = fakeGuild({});

      await setupClassArea(guild, guildConfig, klasse, 'actor-1');

      const voiceChannelId = fakeIdFor({ name: '🔊-sprachkanal', type: ChannelType.GuildVoice });
      expect(sendCalls.some((c) => c.channelId === voiceChannelId)).toBe(false);
    });

    it('postet keine Willkommensnachricht in einen wiederverwendeten (bereits vorhandenen) Kanal', async () => {
      const { guildId, guildConfig, klasse } = await setupGuildAndClass();
      const first = fakeGuild({});
      await setupClassArea(first.guild, guildConfig, klasse, 'actor-1');
      const configured = (await getClassByName(guildId, 'A'))!;

      const existingIds = new Set(
        [
          configured.categoryId,
          configured.chatChannelId,
          configured.announcementChannelId,
          configured.scheduleChannelId,
          configured.examChannelId,
          configured.reportChannelId,
          configured.materialChannelId,
          configured.voiceChannelId,
        ].filter((id): id is string => Boolean(id)),
      );
      const second = fakeGuild({ existingChannelIds: existingIds });

      await setupClassArea(second.guild, guildConfig, configured, 'actor-1');

      expect(second.sendCalls).toHaveLength(0);
    });

    it('bricht das Setup nicht ab, wenn Senden/Anpinnen der Willkommensnachricht fehlschlaegt', async () => {
      const { guildConfig, klasse } = await setupGuildAndClass();
      const { guild } = fakeGuild({
        sendImpl: async () => {
          throw new Error('Kanal-Berechtigung fehlt zufaellig fuer diese Nachricht');
        },
      });

      const result = await setupClassArea(guild, guildConfig, klasse, 'actor-1');

      expect(result.categoryCreated).toBe(true);
      expect(result.channelsCreated).toHaveLength(7);
    });
  });
});
