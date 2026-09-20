import type { Class } from '@prisma/client';
import { prisma } from '../db/client.js';
import type { ClassName } from '../types/domain.js';

/**
 * Liefert eine Klasse und legt sie bei Bedarf an (ohne Rolle - die wird
 * separat ueber updateClassRole() gesetzt). So kann /setup-klassen die drei
 * Klassen anlegen, ohne dass vorher eine manuelle Ersteinrichtung noetig ist.
 */
export async function getOrCreateClass(guildId: string, name: ClassName): Promise<Class> {
  return prisma.class.upsert({
    where: { guildId_name: { guildId, name } },
    update: {},
    create: { guildId, name },
  });
}

export async function getClassByName(guildId: string, name: ClassName): Promise<Class | null> {
  return prisma.class.findUnique({
    where: { guildId_name: { guildId, name } },
  });
}

export async function listClasses(guildId: string): Promise<Class[]> {
  return prisma.class.findMany({
    where: { guildId },
    orderBy: { name: 'asc' },
  });
}

/** Setzt die Discord-Rolle einer Klasse (siehe /setup-klassen). */
export async function updateClassRole(
  guildId: string,
  name: ClassName,
  roleId: string,
): Promise<Class> {
  await getOrCreateClass(guildId, name);
  return prisma.class.update({
    where: { guildId_name: { guildId, name } },
    data: { roleId },
  });
}

export type ClassChannelUpdate = Partial<
  Pick<
    Class,
    | 'categoryId'
    | 'chatChannelId'
    | 'announcementChannelId'
    | 'scheduleChannelId'
    | 'examChannelId'
    | 'reportChannelId'
    | 'materialChannelId'
    | 'voiceChannelId'
  >
>;

/** Persistiert die Kanal-/Kategorie-IDs des privaten Klassenbereichs (siehe classAreaService.ts). */
export async function updateClassChannels(
  guildId: string,
  name: ClassName,
  data: ClassChannelUpdate,
): Promise<Class> {
  await getOrCreateClass(guildId, name);
  return prisma.class.update({
    where: { guildId_name: { guildId, name } },
    data,
  });
}

export type ClassLeadUpdate = Partial<Pick<Class, 'leadRoleId' | 'leadDiscordId'>>;

/** Persistiert Klassenleitungs-Rolle und/oder aktuell zugewiesene Person (siehe classLeadService.ts). */
export async function updateClassLead(
  guildId: string,
  name: ClassName,
  data: ClassLeadUpdate,
): Promise<Class> {
  await getOrCreateClass(guildId, name);
  return prisma.class.update({
    where: { guildId_name: { guildId, name } },
    data,
  });
}

/**
 * Findet die Klasse, deren Klassenleitung aktuell dem angegebenen Mitglied
 * zugewiesen ist (falls vorhanden). Wird bei einer Neuzuweisung genutzt, um
 * eine bestehende andere Klassenleitungszuweisung derselben Person sauber
 * aufzuloesen - eine Person ist immer nur Klassenleitung genau einer Klasse.
 */
export async function getClassLedByMember(
  guildId: string,
  discordId: string,
  excludeClassId?: string,
): Promise<Class | null> {
  return prisma.class.findFirst({
    where: {
      guildId,
      leadDiscordId: discordId,
      ...(excludeClassId ? { NOT: { id: excludeClassId } } : {}),
    },
  });
}
