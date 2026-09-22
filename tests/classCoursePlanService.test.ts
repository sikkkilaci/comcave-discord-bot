import { randomUUID } from 'node:crypto';
import type { TextChannel } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import { getOrCreateClass } from '../src/repositories/classRepository.js';
import { upsertCourseEntry } from '../src/repositories/coursePlanRepository.js';
import { replaceCourseContentForCourse } from '../src/repositories/courseContentRepository.js';
import { syncClassCoursePlanChannel } from '../src/services/classCoursePlanService.js';

interface FakeMessage {
  embeds: { footer?: { text: string } | null }[];
  edit: ReturnType<typeof vi.fn>;
}

function fakeTextChannel(): { channel: TextChannel; messages: FakeMessage[] } {
  const messages: FakeMessage[] = [];

  const channel = {
    messages: {
      fetch: vi.fn(async () => ({
        find: (predicate: (message: FakeMessage) => boolean) => messages.find(predicate),
      })),
    },
    send: vi.fn(async (payload: { embeds: Array<{ data: { footer?: { text: string } } }> }) => {
      const message: FakeMessage = {
        embeds: [{ footer: payload.embeds[0]?.data.footer ?? null }],
        edit: vi.fn(),
      };
      message.edit = vi.fn(async (editPayload: typeof payload) => {
        message.embeds = [{ footer: editPayload.embeds[0]?.data.footer ?? null }];
      });
      messages.push(message);
      return message;
    }),
  };

  return { channel: channel as unknown as TextChannel, messages };
}

async function setupClassWithEntries(): Promise<{
  guildId: string;
  classId: string;
  entryIds: string[];
}> {
  const guildId = `guild-${randomUUID()}`;
  await getOrCreateGuildConfig(guildId);
  const klasse = await getOrCreateClass(guildId, 'A');

  const { entry: first } = await upsertCourseEntry({
    guildId,
    classId: klasse.id,
    courseNumber: 'C-1',
    title: 'Erster Kurs',
    trainer: 'Herr Muster',
    startDate: new Date('2026-01-01T00:00:00.000Z'),
    endDate: new Date('2026-01-10T00:00:00.000Z'),
    sourceFile: 'test',
    createdByDiscordId: 'admin-1',
  });
  const { entry: second } = await upsertCourseEntry({
    guildId,
    classId: klasse.id,
    courseNumber: 'C-2',
    title: 'Zweiter Kurs (mit Klausur)',
    trainer: null,
    startDate: new Date('2026-01-11T00:00:00.000Z'),
    endDate: new Date('2026-01-20T00:00:00.000Z'),
    sourceFile: 'test',
    createdByDiscordId: 'admin-1',
  });

  await replaceCourseContentForCourse('C-2', [
    {
      courseNumber: 'C-2',
      courseTitle: 'Zweiter Kurs (mit Klausur)',
      orderIndex: 0,
      numberPath: '1',
      level: 1,
      text: 'Grundlagen',
      sourceFile: 'test',
    },
    {
      courseNumber: 'C-2',
      courseTitle: 'Zweiter Kurs (mit Klausur)',
      orderIndex: 1,
      numberPath: '2',
      level: 1,
      text: 'Klausur',
      sourceFile: 'test',
    },
  ]);

  return { guildId, classId: klasse.id, entryIds: [first.id, second.id] };
}

describe('syncClassCoursePlanChannel', () => {
  it('postet fuer jeden Kurs-Slot eine eigene Nachricht, chronologisch sortiert, mit Klausur-Erkennung', async () => {
    const { classId } = await setupClassWithEntries();
    const { channel, messages } = fakeTextChannel();

    const result = await syncClassCoursePlanChannel(channel, classId);

    expect(result).toEqual({ total: 2, posted: 2, updated: 0 });
    expect(messages).toHaveLength(2);
    expect(messages[0]?.embeds[0]?.footer?.text).toContain('C-1');
    expect(messages[1]?.embeds[0]?.footer?.text).toContain('C-2');
  });

  it('ist idempotent: ein zweiter Sync-Lauf aktualisiert die bestehenden Nachrichten statt sie zu duplizieren', async () => {
    const { classId } = await setupClassWithEntries();
    const { channel, messages } = fakeTextChannel();

    await syncClassCoursePlanChannel(channel, classId);
    const second = await syncClassCoursePlanChannel(channel, classId);

    expect(second).toEqual({ total: 2, posted: 0, updated: 2 });
    expect(messages).toHaveLength(2);
  });

  it('haengt einen neu importierten Kurs-Slot als zusaetzliche Nachricht an, ohne bestehende zu duplizieren', async () => {
    const { guildId, classId } = await setupClassWithEntries();
    const { channel, messages } = fakeTextChannel();
    await syncClassCoursePlanChannel(channel, classId);

    // Dritter Kurs-Slot fuer dieselbe Klasse (simuliert einen erneuten /kursplan-importieren-Lauf
    // mit einer erweiterten Quelle).
    await upsertCourseEntry({
      guildId,
      classId,
      courseNumber: 'C-3',
      title: 'Dritter Kurs',
      trainer: null,
      startDate: new Date('2026-01-21T00:00:00.000Z'),
      endDate: new Date('2026-01-31T00:00:00.000Z'),
      sourceFile: 'test',
      createdByDiscordId: 'admin-1',
    });

    const second = await syncClassCoursePlanChannel(channel, classId);

    expect(second).toEqual({ total: 3, posted: 1, updated: 2 });
    expect(messages).toHaveLength(3);
  });
});
