import { EmbedBuilder } from 'discord.js';
import type { Appointment, Exam } from '@prisma/client';
import { CLASS_NAME_LABELS, type ClassName } from '../../types/domain.js';
import { formatGermanDateTime } from '../../utils/dateTime.js';

/** Discord erlaubt maximal 25 Felder pro Embed. */
const MAX_LISTED_ITEMS = 25;

/**
 * Baut die Liste der Pruefungen einer Klasse als Embed. Jede Pruefung zeigt
 * ihre ID mit an, da die Bearbeiten-/Loeschen-Commands die Pruefung ueber
 * genau diese ID identifizieren (kein interaktives Auswahl-Menu fuer diesen
 * ersten Ausbauschritt - siehe ARCHITECTURE.md).
 */
export function buildExamListEmbed(className: ClassName, exams: Exam[]): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`🎓 Pruefungen - ${CLASS_NAME_LABELS[className]}`)
    .setColor(0x2b2d31);

  if (exams.length === 0) {
    return embed.setDescription('Aktuell sind keine Pruefungen eingetragen.');
  }

  for (const exam of exams.slice(0, MAX_LISTED_ITEMS)) {
    const lines = [formatGermanDateTime(exam.scheduledAt), exam.description];
    if (exam.studyNotes) {
      lines.push(`📝 Lernhinweise: ${exam.studyNotes}`);
    }
    lines.push(`ID: \`${exam.id}\``);
    embed.addFields({ name: exam.subject, value: lines.join('\n') });
  }

  if (exams.length > MAX_LISTED_ITEMS) {
    embed.setFooter({ text: `+ ${exams.length - MAX_LISTED_ITEMS} weitere nicht angezeigt` });
  }

  return embed;
}

/** Baut die Liste der Termine einer Klasse als Embed - Aufbau analog zu buildExamListEmbed(). */
export function buildAppointmentListEmbed(
  className: ClassName,
  appointments: Appointment[],
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`📅 Termine - ${CLASS_NAME_LABELS[className]}`)
    .setColor(0x2b2d31);

  if (appointments.length === 0) {
    return embed.setDescription('Aktuell sind keine Termine eingetragen.');
  }

  for (const appointment of appointments.slice(0, MAX_LISTED_ITEMS)) {
    const lines = [
      formatGermanDateTime(appointment.scheduledAt),
      appointment.description,
      `ID: \`${appointment.id}\``,
    ];
    embed.addFields({ name: appointment.title, value: lines.join('\n') });
  }

  if (appointments.length > MAX_LISTED_ITEMS) {
    embed.setFooter({
      text: `+ ${appointments.length - MAX_LISTED_ITEMS} weitere nicht angezeigt`,
    });
  }

  return embed;
}
