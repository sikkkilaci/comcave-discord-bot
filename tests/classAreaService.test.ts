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
}

const EVERYONE_ID = 'role-everyone';

/** Deterministische Fake-ID, damit Tests Eltern-/Kind-Beziehungen ohne Aufrufreihenfolge pruefen koennen. */
function fakeIdFor(opts: FakeCreateOptions): string {
  return opts.type === ChannelType.GuildCategory ? `category:${opts.name}` : `channel:${opts.name}`;
}

function fakeGuild(options: {
  existingChannelIds?: Set<string>;
  createImpl?: (opts: FakeCreateOptions) => Promise<{ id: string }>;
}): { guild: Guild; createCalls: FakeCreateOptions[] } {
  const existing = options.existingChannelIds ?? new Set<string>();
  const createCalls: FakeCreateOptions[] = [];

  const create = vi.fn(async (opts: FakeCreateOptions) => {
    createCalls.push(opts);
    if (options.createImpl) return options.createImpl(opts);
    return { id: fakeIdFor(opts) };
  });

  const fetch = vi.fn(async (id: string) => {
    if (existing.has(id)) return { id };
    throw new Error('Unknown Channel');
  });

  const guild = {
    roles: { everyone: { id: EVERYONE_ID } },
    channels: { create, fetch },
  } as unknown as Guild;

  return { guild, createCalls };
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
          'klassenchat',
          'ankuendigungen',
          'termine',
          'pruefungen',
          'berichtsheft',
          'lernmaterial',
          'sprachkanal',
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
      expect(category?.name).toBe('Klasse A');

      const children = createCalls.filter((c) => c.type !== ChannelType.GuildCategory);
      expect(children).toHaveLength(7);
      for (const child of children) {
        expect(child.parent).toBe(fakeIdFor(category!));
      }

      const voice = createCalls.find((c) => c.name === 'sprachkanal');
      expect(voice?.type).toBe(ChannelType.GuildVoice);
      const textChannels = children.filter((c) => c.name !== 'sprachkanal');
      for (const textChannel of textChannels) {
        expect(textChannel.type).toBe(ChannelType.GuildText);
      }
    });

    it('persistiert Kategorie- und Kanal-IDs in der Datenbank', async () => {
      const { guildId, guildConfig, klasse } = await setupGuildAndClass();
      const { guild } = fakeGuild({});

      await setupClassArea(guild, guildConfig, klasse, 'actor-1');

      const stored = await getClassByName(guildId, 'A');
      expect(stored?.categoryId).toBe('category:Klasse A');
      expect(stored?.chatChannelId).toBe('channel:klassenchat');
      expect(stored?.announcementChannelId).toBe('channel:ankuendigungen');
      expect(stored?.scheduleChannelId).toBe('channel:termine');
      expect(stored?.examChannelId).toBe('channel:pruefungen');
      expect(stored?.reportChannelId).toBe('channel:berichtsheft');
      expect(stored?.materialChannelId).toBe('channel:lernmaterial');
      expect(stored?.voiceChannelId).toBe('channel:sprachkanal');
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

      const announcements = createCalls.find((c) => c.name === 'ankuendigungen');
      const chat = createCalls.find((c) => c.name === 'klassenchat');

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

      const chat = createCalls.find((c) => c.name === 'klassenchat');
      expect(overwriteFor(chat!, leadRoleId)?.allow).toContain(PermissionFlagsBits.ManageMessages);

      const announcements = createCalls.find((c) => c.name === 'ankuendigungen');
      expect(overwriteFor(announcements!, leadRoleId)?.allow).toContain(
        PermissionFlagsBits.SendMessages,
      );
    });
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
      expect(result.channelsCreated).toEqual(['klassenchat']);
      expect(result.channelsSkipped).toHaveLength(6);
      expect(second.createCalls).toHaveLength(1);
      expect(second.createCalls[0]?.name).toBe('klassenchat');

      const repaired = await getClassByName(guildId, 'A');
      expect(repaired?.chatChannelId).toBe('channel:klassenchat');
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
});
