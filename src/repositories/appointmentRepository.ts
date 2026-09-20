import type { Appointment } from '@prisma/client';
import { prisma } from '../db/client.js';

export interface CreateAppointmentInput {
  guildId: string;
  classId: string;
  title: string;
  description: string;
  scheduledAt: Date;
  createdByDiscordId: string;
}

export async function createAppointment(input: CreateAppointmentInput): Promise<Appointment> {
  return prisma.appointment.create({ data: input });
}

/** Immer nach `guildId` gescoped, damit eine Termin-ID nie serveruebergreifend Daten preisgibt. */
export async function getAppointmentById(
  guildId: string,
  appointmentId: string,
): Promise<Appointment | null> {
  return prisma.appointment.findFirst({ where: { id: appointmentId, guildId } });
}

export type AppointmentUpdate = Partial<Pick<Appointment, 'title' | 'description' | 'scheduledAt'>>;

export async function updateAppointment(
  appointmentId: string,
  data: AppointmentUpdate,
): Promise<Appointment> {
  return prisma.appointment.update({ where: { id: appointmentId }, data });
}

export async function deleteAppointment(appointmentId: string): Promise<Appointment> {
  return prisma.appointment.delete({ where: { id: appointmentId } });
}

export async function listAppointmentsByClassId(classId: string): Promise<Appointment[]> {
  return prisma.appointment.findMany({ where: { classId }, orderBy: { scheduledAt: 'asc' } });
}
