import type { DailyReport } from '@prisma/client';
import { prisma } from '../db/client.js';

export interface CreateDailyReportInput {
  guildId: string;
  classId: string;
  date: Date;
  topics: string;
  content: string;
  notes: string;
  relatedMaterials: string | null;
  createdByDiscordId: string;
}

export async function createDailyReport(input: CreateDailyReportInput): Promise<DailyReport> {
  return prisma.dailyReport.create({ data: input });
}

/** Immer nach `guildId` gescoped, damit eine Berichts-ID nie serveruebergreifend Daten preisgibt. */
export async function getDailyReportById(
  guildId: string,
  reportId: string,
): Promise<DailyReport | null> {
  return prisma.dailyReport.findFirst({ where: { id: reportId, guildId } });
}

export type DailyReportUpdate = Partial<
  Pick<DailyReport, 'date' | 'topics' | 'content' | 'notes' | 'relatedMaterials'>
>;

export async function updateDailyReport(
  reportId: string,
  data: DailyReportUpdate,
): Promise<DailyReport> {
  return prisma.dailyReport.update({ where: { id: reportId }, data });
}

export async function deleteDailyReport(reportId: string): Promise<DailyReport> {
  return prisma.dailyReport.delete({ where: { id: reportId } });
}

export async function listDailyReportsByClassId(classId: string): Promise<DailyReport[]> {
  return prisma.dailyReport.findMany({ where: { classId }, orderBy: { date: 'asc' } });
}
