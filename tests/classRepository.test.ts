import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import {
  getClassByName,
  getClassLedByMember,
  getOrCreateClass,
  listClasses,
  updateClassChannels,
  updateClassLead,
  updateClassRole,
} from '../src/repositories/classRepository.js';

function uniqueGuildId(): string {
  return `guild-${randomUUID()}`;
}

describe('classRepository', () => {
  describe('getOrCreateClass / getClassByName', () => {
    it('legt eine neue Klasse ohne Rolle an', async () => {
      const guildId = uniqueGuildId();
      await getOrCreateGuildConfig(guildId);

      const klasse = await getOrCreateClass(guildId, 'A');

      expect(klasse.name).toBe('A');
      expect(klasse.roleId).toBeNull();
    });

    it('ist idempotent und legt bei wiederholtem Aufruf keine zweite Klasse an', async () => {
      const guildId = uniqueGuildId();
      await getOrCreateGuildConfig(guildId);

      const first = await getOrCreateClass(guildId, 'B');
      const second = await getOrCreateClass(guildId, 'B');

      expect(second.id).toBe(first.id);
    });

    it('gibt null zurueck, wenn die Klasse noch nicht existiert', async () => {
      const guildId = uniqueGuildId();
      await getOrCreateGuildConfig(guildId);

      const klasse = await getClassByName(guildId, 'C');

      expect(klasse).toBeNull();
    });

    it('unterscheidet Klassen mit gleichem Namen auf unterschiedlichen Servern', async () => {
      const guildA = uniqueGuildId();
      const guildB = uniqueGuildId();
      await getOrCreateGuildConfig(guildA);
      await getOrCreateGuildConfig(guildB);

      const classA = await getOrCreateClass(guildA, 'A');
      const classB = await getOrCreateClass(guildB, 'A');

      expect(classA.id).not.toBe(classB.id);
    });
  });

  describe('updateClassRole', () => {
    it('setzt die Rolle einer neuen Klasse (legt sie bei Bedarf an)', async () => {
      const guildId = uniqueGuildId();
      await getOrCreateGuildConfig(guildId);

      const klasse = await updateClassRole(guildId, 'A', 'role-a');

      expect(klasse.roleId).toBe('role-a');
    });

    it('ueberschreibt eine bereits gesetzte Rolle', async () => {
      const guildId = uniqueGuildId();
      await getOrCreateGuildConfig(guildId);
      await updateClassRole(guildId, 'A', 'role-a-alt');

      const klasse = await updateClassRole(guildId, 'A', 'role-a-neu');

      expect(klasse.roleId).toBe('role-a-neu');
    });
  });

  describe('updateClassChannels', () => {
    it('setzt Kategorie- und Kanal-IDs (legt die Klasse bei Bedarf an)', async () => {
      const guildId = uniqueGuildId();
      await getOrCreateGuildConfig(guildId);

      const klasse = await updateClassChannels(guildId, 'A', {
        categoryId: 'cat-1',
        chatChannelId: 'chat-1',
        voiceChannelId: 'voice-1',
      });

      expect(klasse.categoryId).toBe('cat-1');
      expect(klasse.chatChannelId).toBe('chat-1');
      expect(klasse.voiceChannelId).toBe('voice-1');
      expect(klasse.announcementChannelId).toBeNull();
    });

    it('aktualisiert nur die uebergebenen Felder, andere bleiben unveraendert', async () => {
      const guildId = uniqueGuildId();
      await getOrCreateGuildConfig(guildId);
      await updateClassChannels(guildId, 'A', { categoryId: 'cat-1', chatChannelId: 'chat-1' });

      const klasse = await updateClassChannels(guildId, 'A', { examChannelId: 'exam-1' });

      expect(klasse.categoryId).toBe('cat-1');
      expect(klasse.chatChannelId).toBe('chat-1');
      expect(klasse.examChannelId).toBe('exam-1');
    });
  });

  describe('updateClassLead / getClassLedByMember', () => {
    it('setzt Klassenleitungs-Rolle und zugewiesene Person', async () => {
      const guildId = uniqueGuildId();
      await getOrCreateGuildConfig(guildId);

      const klasse = await updateClassLead(guildId, 'A', {
        leadRoleId: 'role-lead-a',
        leadDiscordId: 'member-1',
      });

      expect(klasse.leadRoleId).toBe('role-lead-a');
      expect(klasse.leadDiscordId).toBe('member-1');
    });

    it('findet die Klasse, deren Klassenleitung einer bestimmten Person zugewiesen ist', async () => {
      const guildId = uniqueGuildId();
      await getOrCreateGuildConfig(guildId);
      await updateClassLead(guildId, 'A', { leadRoleId: 'role-lead-a', leadDiscordId: 'member-1' });
      await updateClassLead(guildId, 'B', { leadRoleId: 'role-lead-b', leadDiscordId: 'member-2' });

      const found = await getClassLedByMember(guildId, 'member-1');

      expect(found?.name).toBe('A');
    });

    it('gibt null zurueck, wenn die Person keine Klassenleitung ist', async () => {
      const guildId = uniqueGuildId();
      await getOrCreateGuildConfig(guildId);

      const found = await getClassLedByMember(guildId, 'member-unbekannt');

      expect(found).toBeNull();
    });

    it('schliesst die uebergebene Klasse ueber excludeClassId aus (fuer Wechsel-Erkennung)', async () => {
      const guildId = uniqueGuildId();
      await getOrCreateGuildConfig(guildId);
      const classA = await updateClassLead(guildId, 'A', {
        leadRoleId: 'role-lead-a',
        leadDiscordId: 'member-1',
      });

      const found = await getClassLedByMember(guildId, 'member-1', classA.id);

      expect(found).toBeNull();
    });

    it('das Entfernen der Zuweisung (leadDiscordId: null) belaesst die Rolle', async () => {
      const guildId = uniqueGuildId();
      await getOrCreateGuildConfig(guildId);
      await updateClassLead(guildId, 'A', { leadRoleId: 'role-lead-a', leadDiscordId: 'member-1' });

      const klasse = await updateClassLead(guildId, 'A', { leadDiscordId: null });

      expect(klasse.leadDiscordId).toBeNull();
      expect(klasse.leadRoleId).toBe('role-lead-a');
    });
  });

  describe('listClasses', () => {
    it('listet alle Klassen eines Servers alphabetisch sortiert', async () => {
      const guildId = uniqueGuildId();
      await getOrCreateGuildConfig(guildId);
      await getOrCreateClass(guildId, 'C');
      await getOrCreateClass(guildId, 'A');
      await getOrCreateClass(guildId, 'B');

      const klassen = await listClasses(guildId);

      expect(klassen.map((k) => k.name)).toEqual(['A', 'B', 'C']);
    });

    it('gibt eine leere Liste zurueck, wenn keine Klassen existieren', async () => {
      const guildId = uniqueGuildId();
      await getOrCreateGuildConfig(guildId);

      const klassen = await listClasses(guildId);

      expect(klassen).toEqual([]);
    });
  });
});
