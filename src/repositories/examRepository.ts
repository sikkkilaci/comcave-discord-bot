import type { Exam } from '@prisma/client';
import { prisma } from '../db/client.js';

export interface CreateExamInput {
  guildId: string;
  classId: string;
  subject: string;
  description: string;
  studyNotes: string | null;
  scheduledAt: Date;
  createdByDiscordId: string;
}

export async function createExam(input: CreateExamInput): Promise<Exam> {
  return prisma.exam.create({ data: input });
}

/** Immer nach `guildId` gescoped, damit eine Pruefungs-ID nie serveruebergreifend Daten preisgibt. */
export async function getExamById(guildId: string, examId: string): Promise<Exam | null> {
  return prisma.exam.findFirst({ where: { id: examId, guildId } });
}

export type ExamUpdate = Partial<
  Pick<Exam, 'subject' | 'description' | 'studyNotes' | 'scheduledAt'>
>;

export async function updateExam(examId: string, data: ExamUpdate): Promise<Exam> {
  return prisma.exam.update({ where: { id: examId }, data });
}

export async function deleteExam(examId: string): Promise<Exam> {
  return prisma.exam.delete({ where: { id: examId } });
}

export async function listExamsByClassId(classId: string): Promise<Exam[]> {
  return prisma.exam.findMany({ where: { classId }, orderBy: { scheduledAt: 'asc' } });
}
