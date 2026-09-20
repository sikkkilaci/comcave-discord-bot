import type { LearningMaterial } from '@prisma/client';
import { prisma } from '../db/client.js';

export interface CreateLearningMaterialInput {
  guildId: string;
  classId: string;
  title: string;
  description: string;
  subject: string;
  category: string;
  url: string | null;
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentContentType: string | null;
  linkedType: string | null;
  linkedId: string | null;
  createdByDiscordId: string;
}

export async function createLearningMaterial(
  input: CreateLearningMaterialInput,
): Promise<LearningMaterial> {
  return prisma.learningMaterial.create({ data: input });
}

/** Immer nach `guildId` gescoped, damit eine Material-ID nie serveruebergreifend Daten preisgibt. */
export async function getLearningMaterialById(
  guildId: string,
  materialId: string,
): Promise<LearningMaterial | null> {
  return prisma.learningMaterial.findFirst({ where: { id: materialId, guildId } });
}

export type LearningMaterialUpdate = Partial<
  Pick<
    LearningMaterial,
    | 'title'
    | 'description'
    | 'subject'
    | 'category'
    | 'url'
    | 'attachmentUrl'
    | 'attachmentName'
    | 'attachmentContentType'
    | 'linkedType'
    | 'linkedId'
  >
>;

export async function updateLearningMaterial(
  materialId: string,
  data: LearningMaterialUpdate,
): Promise<LearningMaterial> {
  return prisma.learningMaterial.update({ where: { id: materialId }, data });
}

export async function deleteLearningMaterial(materialId: string): Promise<LearningMaterial> {
  return prisma.learningMaterial.delete({ where: { id: materialId } });
}

/** Sortiert nach Kategorie und Titel, damit die Anzeige uebersichtlich gruppiert bleibt. */
export async function listLearningMaterialsByClassId(classId: string): Promise<LearningMaterial[]> {
  return prisma.learningMaterial.findMany({
    where: { classId },
    orderBy: [{ category: 'asc' }, { title: 'asc' }],
  });
}
