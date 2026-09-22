import { randomUUID } from 'node:crypto';
import { ChannelType, type Guild } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import {
  getOrCreateGuildConfig,
  updateGuildConfig,
} from '../src/repositories/guildConfigRepository.js';
import { importCourseContentFromFile } from '../src/services/courseContentImportService.js';
import { getCourseCatalog, setupCourseCategories } from '../src/services/courseCategoryService.js';
import { ValidationError } from '../src/utils/errors.js';

const BOT_USER_ID = 'bot-user-1';

interface FakeMessage {
  id: string;
  author: { id: string };
  embeds: unknown[];
  edit: ReturnType<typeof vi.fn>;
  pin: ReturnType<typeof vi.fn>;
}

interface FakeChannel {
  id: string;
  name: string;
  type: ChannelType;
  parentId: string | null;
  permissionOverwrites: { set: ReturnType<typeof vi.fn> };
  setName?: ReturnType<typeof vi.fn>;
  client?: { user: { id: string } };
  messages?: { fetchPinned: ReturnType<typeof vi.fn> };
  send?: ReturnType<typeof vi.fn>;
}

/**
 * Minimaler Fake fuer setupCourseCategories(): unterstuetzt Kategorie-/
 * Kanal-Anlage (guild.channels.create), Namensabgleich per Token (siehe
 * findCategoryByCourseNumber() in courseCategoryService.ts, ueber
 * guild.channels.fetch()), Kanalsuche innerhalb einer Kategorie (guild.
 * channels.cache.find()) sowie das Posten/Aktualisieren/Anpinnen der
 * Kursinhalte-Nachricht (channel.send()/message.edit()/message.pin()).
 */
function fakeGuild(): { guild: Guild; channels: FakeChannel[] } {
  const channels: FakeChannel[] = [];
  let idCounter = 0;

  function makeCategory(name: string): FakeChannel {
    const category: FakeChannel = {
      id: `category-${idCounter++}`,
      name,
      type: ChannelType.GuildCategory,
      parentId: null,
      permissionOverwrites: { set: vi.fn(async () => {}) },
    };
    category.setName = vi.fn(async (newName: string) => {
      category.name = newName;
    });
    return category;
  }

  function makeTextChannel(name: string, parentId: string | null): FakeChannel {
    const pinned: FakeMessage[] = [];
    let messageIdCounter = 0;
    const channel: FakeChannel = {
      id: `channel-${idCounter++}`,
      name,
      type: ChannelType.GuildText,
      parentId,
      permissionOverwrites: { set: vi.fn(async () => {}) },
      client: { user: { id: BOT_USER_ID } },
      messages: {
        fetchPinned: vi.fn(async () => ({
          find: (predicate: (message: FakeMessage) => boolean) => pinned.find(predicate),
        })),
      },
    };
    channel.send = vi.fn(async (payload: { embeds: unknown[] }) => {
      const message: FakeMessage = {
        id: `${channel.id}-msg-${messageIdCounter++}`,
        author: { id: BOT_USER_ID },
        embeds: payload.embeds,
        edit: vi.fn(async (editPayload: { embeds: unknown[] }) => {
          message.embeds = editPayload.embeds;
        }),
        pin: vi.fn(async () => {
          pinned.push(message);
        }),
      };
      return message;
    });
    return channel;
  }

  const create = vi.fn(
    async (opts: {
      name: string;
      type: ChannelType;
      parent?: string;
      permissionOverwrites?: unknown;
      topic?: string;
      reason?: string;
    }) => {
      const channel =
        opts.type === ChannelType.GuildCategory
          ? makeCategory(opts.name)
          : makeTextChannel(opts.name, opts.parent ?? null);
      channels.push(channel);
      return channel;
    },
  );

  const guild = {
    roles: { everyone: { id: 'role-everyone' } },
    channels: {
      create,
      fetch: vi.fn(async () => new Map(channels.map((channel) => [channel.id, channel]))),
      cache: { find: (predicate: (channel: FakeChannel) => boolean) => channels.find(predicate) },
    },
    members: { me: { roles: { highest: { id: 'role-bot' } } } },
  } as unknown as Guild;

  return { guild, channels };
}

async function setupGuildConfig(): Promise<Awaited<ReturnType<typeof getOrCreateGuildConfig>>> {
  const guildId = `guild-${randomUUID()}`;
  await getOrCreateGuildConfig(guildId);
  return updateGuildConfig(guildId, {
    onboardedRoleId: 'role-onboarded',
    adminRoleId: 'role-admin',
    moderatorRoleId: 'role-moderator',
  });
}

describe('getCourseCatalog', () => {
  it('liefert alle 34 Kurse chronologisch sortiert, inkl. Klausur-Erkennung anhand importierter Inhalte', async () => {
    await importCourseContentFromFile();

    const catalog = await getCourseCatalog();

    expect(catalog).toHaveLength(34);
    for (let i = 1; i < catalog.length; i += 1) {
      expect(catalog[i]!.start.getTime()).toBeGreaterThanOrEqual(catalog[i - 1]!.start.getTime());
    }

    // Gegen den realen Datensatz verifizierte Klausur-Kurse (siehe courseCategoryService.ts).
    const exam = catalog.find((entry) => entry.courseNumber === '567472');
    expect(exam?.hasExam).toBe(true);
    expect(exam?.contentItems.length).toBeGreaterThan(0);

    // 567469 hat laut Quelle keine Kursinhalte (contentItems: []) - bleibt trotzdem im Katalog,
    // mit leerem contentItems-Array statt eines Fehlers.
    const withoutContent = catalog.find((entry) => entry.courseNumber === '567469');
    expect(withoutContent).toBeDefined();
    expect(withoutContent?.contentItems).toHaveLength(0);
    expect(withoutContent?.hasExam).toBe(false);
  });
});

describe('setupCourseCategories', () => {
  it('wirft ValidationError, wenn die Grundrollen noch nicht konfiguriert sind', async () => {
    const guildId = `guild-${randomUUID()}`;
    const guildConfig = await getOrCreateGuildConfig(guildId);
    const { guild } = fakeGuild();

    await expect(setupCourseCategories(guild, guildConfig, 'actor-1')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('legt bei Erstanlage 34 Kategorien mit je einem Kanal an und postet die Kursinhalte', async () => {
    await importCourseContentFromFile();
    const guildConfig = await setupGuildConfig();
    const { guild, channels } = fakeGuild();

    const result = await setupCourseCategories(guild, guildConfig, 'actor-1');

    expect(result.totalCourses).toBe(34);
    expect(result.coursesWithExam).toBe(10);
    expect(result.categoriesCreated).toBe(34);
    expect(result.categoriesReused).toBe(0);
    expect(result.categoriesRenamed).toBe(0);
    expect(result.channelsCreated).toBe(34);
    expect(result.contentPosted).toBe(34);
    expect(result.contentUpdated).toBe(0);

    const categories = channels.filter((channel) => channel.type === ChannelType.GuildCategory);
    expect(categories).toHaveLength(34);

    const examCategory = categories.find((channel) => channel.name.includes(' 567472 · '));
    expect(examCategory?.name.startsWith('⚠️')).toBe(true);
    const normalCategory = categories.find((channel) => channel.name.includes(' 567469 · '));
    expect(normalCategory?.name.startsWith('📘')).toBe(true);
  });

  it('ist idempotent: ein zweiter Lauf legt nichts doppelt an, sondern aktualisiert nur', async () => {
    await importCourseContentFromFile();
    const guildConfig = await setupGuildConfig();
    const { guild, channels } = fakeGuild();

    await setupCourseCategories(guild, guildConfig, 'actor-1');
    const second = await setupCourseCategories(guild, guildConfig, 'actor-1');

    expect(second.categoriesCreated).toBe(0);
    expect(second.categoriesReused).toBe(34);
    expect(second.channelsCreated).toBe(0);
    expect(second.contentPosted).toBe(0);
    expect(second.contentUpdated).toBe(34);
    expect(channels.filter((channel) => channel.type === ChannelType.GuildCategory)).toHaveLength(
      34,
    );
  });

  it('findet eine bereits bestehende Kategorie ueber die Kursnummer wieder und benennt sie statt eine zweite anzulegen', async () => {
    await importCourseContentFromFile();
    const guildConfig = await setupGuildConfig();
    const { guild, channels } = fakeGuild();

    // Simuliert eine Kategorie aus einem frueheren Lauf mit veraltetem Titel/ohne Klausur-Symbol.
    await guild.channels.create({
      name: '📘 567472 · Alter Titel',
      type: ChannelType.GuildCategory,
    });

    const result = await setupCourseCategories(guild, guildConfig, 'actor-1');

    expect(result.categoriesCreated).toBe(33);
    expect(result.categoriesRenamed).toBe(1);
    const examCategories = channels.filter(
      (channel) =>
        channel.type === ChannelType.GuildCategory && channel.name.includes(' 567472 · '),
    );
    expect(examCategories).toHaveLength(1);
    expect(examCategories[0]?.name).toBe('⚠️ 567472 · Allgemeine Betriebswirtschaftslehre');
  });
});
