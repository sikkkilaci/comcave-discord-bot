import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getOrCreateGuildConfig } from '../src/repositories/guildConfigRepository.js';
import {
  getClassByName,
  getOrCreateClass,
  listClasses,
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
