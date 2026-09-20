import type { Appointment, GuildConfig } from '@prisma/client';
import type { GuildMember } from 'discord.js';
import { getClassByName, getClassById } from '../repositories/classRepository.js';
import { getMemberWithClass } from '../repositories/memberRepository.js';
import {
  createAppointment as createAppointmentRow,
  deleteAppointment as deleteAppointmentRow,
  getAppointmentById,
  listAppointmentsByClassId,
  updateAppointment as updateAppointmentRow,
  type AppointmentUpdate,
} from '../repositories/appointmentRepository.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import {
  assertClassManagementAccess,
  assertClassReadAccess,
} from '../permissions/checkPermission.js';
import { parseGermanDateTime } from '../utils/dateTime.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import type { ClassName } from '../types/domain.js';

export interface AppointmentCreateInput {
  titel: string;
  beschreibung: string;
  datum: string;
  uhrzeit: string;
}

export interface AppointmentEditInput {
  titel?: string;
  beschreibung?: string;
  datum?: string;
  uhrzeit?: string;
}

function requireNonEmpty(value: string, fieldLabel: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ValidationError(`${fieldLabel} darf nicht leer sein.`);
  }
  return trimmed;
}

/**
 * Legt einen Termin fuer eine Klasse an. Nur Admin oder die Klassenleitung
 * genau dieser Klasse duerfen das (assertClassManagementAccess()) - dieselbe
 * zentrale Pruefung wie bei Pruefungen und den privaten Klassenbereichen.
 */
export async function createAppointmentForClass(
  guildConfig: GuildConfig,
  member: GuildMember,
  className: ClassName,
  input: AppointmentCreateInput,
  actorDiscordId: string,
): Promise<Appointment> {
  const klasse = await getClassByName(guildConfig.id, className);
  if (!klasse) {
    throw new ValidationError(`Klasse ${className} ist noch nicht konfiguriert.`);
  }
  assertClassManagementAccess(member, guildConfig, klasse);

  const title = requireNonEmpty(input.titel, 'Titel');
  const description = requireNonEmpty(input.beschreibung, 'Beschreibung');
  const scheduledAt = parseGermanDateTime(input.datum, input.uhrzeit);

  const appointment = await createAppointmentRow({
    guildId: guildConfig.id,
    classId: klasse.id,
    title,
    description,
    scheduledAt,
    createdByDiscordId: actorDiscordId,
  });

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'appointment.create',
    metadata: {
      appointmentId: appointment.id,
      className,
      title,
      scheduledAt: scheduledAt.toISOString(),
    },
  });

  return appointment;
}

/**
 * Bearbeitet einen bestehenden Termin. Wie bei examService.ts wird die
 * Berechtigung gegen die tatsaechlich in der Datenbank hinterlegte Klasse des
 * Termins geprueft (`appointment.classId` -> getClassById()), niemals gegen
 * einen vom Aufrufer behaupteten Klassennamen.
 */
export async function updateAppointmentForClass(
  guildConfig: GuildConfig,
  member: GuildMember,
  appointmentId: string,
  input: AppointmentEditInput,
  actorDiscordId: string,
): Promise<Appointment> {
  const appointment = await getAppointmentById(guildConfig.id, appointmentId);
  if (!appointment) {
    throw new NotFoundError('Dieser Termin wurde nicht gefunden.');
  }

  const klasse = await getClassById(guildConfig.id, appointment.classId);
  if (!klasse) {
    throw new NotFoundError('Die zugehoerige Klasse wurde nicht gefunden.');
  }
  assertClassManagementAccess(member, guildConfig, klasse);

  const data: AppointmentUpdate = {};
  if (input.titel !== undefined) {
    data.title = requireNonEmpty(input.titel, 'Titel');
  }
  if (input.beschreibung !== undefined) {
    data.description = requireNonEmpty(input.beschreibung, 'Beschreibung');
  }
  if (input.datum !== undefined || input.uhrzeit !== undefined) {
    if (input.datum === undefined || input.uhrzeit === undefined) {
      throw new ValidationError(
        'Datum und Uhrzeit muessen gemeinsam angegeben werden, um den Zeitpunkt zu aendern.',
      );
    }
    data.scheduledAt = parseGermanDateTime(input.datum, input.uhrzeit);
  }

  if (Object.keys(data).length === 0) {
    throw new ValidationError('Es wurde keine Aenderung angegeben.');
  }

  const updated = await updateAppointmentRow(appointmentId, data);

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'appointment.update',
    metadata: { appointmentId, className: klasse.name, changedFields: Object.keys(data) },
  });

  return updated;
}

/** Loescht einen Termin - Berechtigungspruefung wie bei updateAppointmentForClass(). */
export async function deleteAppointmentForClass(
  guildConfig: GuildConfig,
  member: GuildMember,
  appointmentId: string,
  actorDiscordId: string,
): Promise<Appointment> {
  const appointment = await getAppointmentById(guildConfig.id, appointmentId);
  if (!appointment) {
    throw new NotFoundError('Dieser Termin wurde nicht gefunden.');
  }

  const klasse = await getClassById(guildConfig.id, appointment.classId);
  if (!klasse) {
    throw new NotFoundError('Die zugehoerige Klasse wurde nicht gefunden.');
  }
  assertClassManagementAccess(member, guildConfig, klasse);

  await deleteAppointmentRow(appointmentId);

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'appointment.delete',
    metadata: { appointmentId, className: klasse.name, title: appointment.title },
  });

  return appointment;
}

export interface AppointmentListResult {
  className: ClassName;
  appointments: Appointment[];
}

/**
 * Listet die Termine einer Klasse. Ohne explizite Klassenangabe wird die
 * eigene Klasse des Aufrufers verwendet. Lesezugriff ist erlaubt fuer Admin,
 * die Klassenleitung dieser Klasse ODER ein Mitglied der Klasse selbst
 * (assertClassReadAccess()) - jede andere Klasse wird verweigert.
 */
export async function listAppointmentsForClass(
  guildConfig: GuildConfig,
  member: GuildMember,
  requestedClassName: ClassName | null,
): Promise<AppointmentListResult> {
  const memberRow = await getMemberWithClass(guildConfig.id, member.id);
  const ownClassName = (memberRow?.class?.name as ClassName | undefined) ?? null;
  const targetName = requestedClassName ?? ownClassName;

  if (!targetName) {
    throw new ValidationError(
      'Du bist noch keiner Klasse zugeordnet. Bitte gib eine Klasse an oder waehle zuerst eine ' +
        'in #wo-bin-ich.',
    );
  }

  const klasse = await getClassByName(guildConfig.id, targetName);
  if (!klasse) {
    throw new NotFoundError(`Klasse ${targetName} ist noch nicht konfiguriert.`);
  }

  assertClassReadAccess(member, guildConfig, klasse, memberRow?.classId ?? null);

  const appointments = await listAppointmentsByClassId(klasse.id);
  return { className: targetName, appointments };
}
