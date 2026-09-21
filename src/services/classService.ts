import { EmbedBuilder, type GuildMember } from 'discord.js';
import type { GuildConfig, Member } from '@prisma/client';
import { getClassByName } from '../repositories/classRepository.js';
import {
  claimFirstClassAssignment,
  getMemberWithClass,
  listMembersByClassId,
  setMemberClass,
} from '../repositories/memberRepository.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import { addRoleOrThrow, removeRoleOrThrow } from './discordRoleSync.js';
import { assertMemberVerified } from './verificationService.js';
import { assertProfileComplete } from './memberProfileService.js';
import { assertFachrichtungChosen } from './fachrichtungService.js';
import { PermissionError, ValidationError } from '../utils/errors.js';
import { CLASS_NAMES, type ClassName } from '../types/domain.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('classService');

export interface ClassAssignmentResult {
  member: Member;
  previousClassName: ClassName | null;
  newClassName: ClassName;
  /** false, wenn das Mitglied bereits vollstaendig (DB + Discord-Rolle) in dieser Klasse war. */
  changed: boolean;
}

/**
 * Weist einem verifizierten Mitglied eine Klasse zu (oder wechselt sie).
 * Ein Mitglied gehoert laut Datenmodell immer nur einer Klasse gleichzeitig
 * an (`Member.classId` ist ein Einzelfeld) - bei einem Wechsel wird daher
 * zuerst die alte Klassenrolle entfernt, dann die neue vergeben, dann die DB
 * aktualisiert und zuletzt ein Audit-Log-Eintrag geschrieben.
 *
 * Selbstbedienung ist bewusst NUR EINMALIG moeglich (siehe
 * PermissionError-Wurf unten): ein Mitglied, das bereits einer Klasse
 * zugeordnet ist, kann diese nicht selbst per Klick aendern - Klassenwechsel
 * laufen ueber die Klassenleitung/Verwaltung (`/mitglied-klasse-aendern`,
 * ADMIN-only), die `options.allowChange: true` setzt. Ohne diese Sperre
 * koennte ein Mitglied beliebig zwischen Klassen hin- und herspringen, was
 * die Klassenbereiche/-mitgliederlisten inkonsistent machen wuerde.
 *
 * Wirft PermissionError, wenn das Mitglied nicht verifiziert ist, noch keine
 * Fachrichtung gewaehlt hat, oder (bei Selbstbedienung) bereits einer anderen
 * Klasse zugeordnet ist. Wirft ValidationError, wenn die Zielklasse nicht
 * existiert oder noch keine Rolle konfiguriert ist (siehe /setup-klassen)
 * bzw. wenn dem Bot die Berechtigung zur Rollenvergabe fehlt.
 */
export async function assignClass(
  targetMember: GuildMember,
  guildConfig: GuildConfig,
  className: ClassName,
  actorDiscordId: string,
  options: { allowChange?: boolean } = {},
): Promise<ClassAssignmentResult> {
  await assertMemberVerified(guildConfig.id, targetMember.id);
  await assertProfileComplete(guildConfig.id, targetMember.id);
  await assertFachrichtungChosen(guildConfig.id, targetMember.id);

  const targetClass = await getClassByName(guildConfig.id, className);
  if (!targetClass || !targetClass.roleId) {
    throw new ValidationError(
      `Klasse ${className} ist noch nicht konfiguriert. Ein Admin muss zuerst /setup-klassen ausfuehren.`,
    );
  }

  const memberRow = await getMemberWithClass(guildConfig.id, targetMember.id);
  if (!memberRow) {
    // Unerreichbar: assertMemberVerified() oben hat den Member-Datensatz bereits gefunden.
    throw new ValidationError('Mitglied konnte nicht gefunden werden.');
  }

  const previousClass = memberRow.class;
  const previousClassName = (previousClass?.name as ClassName | undefined) ?? null;

  const alreadyHasRole = targetMember.roles.cache.has(targetClass.roleId);
  const alreadyAssignedInDb = previousClass?.id === targetClass.id;

  if (alreadyAssignedInDb && alreadyHasRole) {
    return {
      member: memberRow,
      previousClassName,
      newClassName: className,
      changed: false,
    };
  }

  if (previousClass && previousClass.id !== targetClass.id && !options.allowChange) {
    throw new PermissionError(
      `Deine Klasse ist bereits auf ${previousClassName} festgelegt und kann nicht selbst ` +
        'gewechselt werden. Bitte wende dich an deine Klassenleitung oder die Verwaltung.',
    );
  }

  let updatedMember: Member;

  if (previousClass) {
    // Wechsel - nur per Admin-Override erreichbar (siehe Sperre oben), daher hier keine
    // zusaetzliche Atomaritaet noetig (ein Admin fuehrt das sequentiell/selten aus).
    if (previousClass.roleId && targetMember.roles.cache.has(previousClass.roleId)) {
      await removeRoleOrThrow(
        targetMember,
        previousClass.roleId,
        `Klassenwechsel: ${previousClass.name} -> ${className}`,
      );
    }
    if (!alreadyHasRole) {
      await addRoleOrThrow(targetMember, targetClass.roleId, `Klassenzuweisung: ${className}`);
    }
    updatedMember = await setMemberClass(guildConfig.id, targetMember.id, targetClass.id);
  } else {
    // Erstzuweisung - atomarer Compare-and-Swap (claimFirstClassAssignment()) statt Read-then-
    // Write, damit zwei gleichzeitige Erst-Bestaetigungsklicks (z. B. Doppelklick oder zwei
    // offene Tabs desselben Mitglieds) nicht beide durchlaufen und dadurch inkonsistent
    // sowohl die DB als auch die vergebenen Discord-Rollen hinterlassen.
    const claimed = await claimFirstClassAssignment(
      guildConfig.id,
      targetMember.id,
      targetClass.id,
    );

    if (!claimed) {
      const concurrent = await getMemberWithClass(guildConfig.id, targetMember.id);
      if (concurrent?.classId !== targetClass.id) {
        throw new PermissionError(
          'Deine Klasse wurde inzwischen bereits festgelegt (z. B. durch einen doppelten Klick). ' +
            'Bitte pruefe deine aktuelle Klasse mit /wo-bin-ich.',
        );
      }
      // Derselbe Klick kam doppelt an (z. B. Netzwerk-Retry) - der GEWINNENDE Aufruf hat
      // classId bereits identisch gesetzt, hier nur noch die Rolle nachtragen, falls dessen
      // eigener addRoleOrThrow()-Aufruf noch nicht durchgelaufen ist.
      updatedMember = concurrent;
    } else {
      updatedMember = (await getMemberWithClass(guildConfig.id, targetMember.id)) as Member;
    }

    if (!targetMember.roles.cache.has(targetClass.roleId)) {
      await addRoleOrThrow(targetMember, targetClass.roleId, `Klassenzuweisung: ${className}`);
    }
  }

  const isChange = previousClass !== null && previousClass.id !== targetClass.id;

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: isChange ? 'class.change' : 'class.assign',
    targetDiscordId: targetMember.id,
    metadata: { from: previousClassName, to: className },
  });

  logger.info(
    {
      guildId: guildConfig.id,
      member: targetMember.id,
      actor: actorDiscordId,
      from: previousClassName,
      to: className,
    },
    'Klassenzuweisung geaendert',
  );

  return { member: updatedMember, previousClassName, newClassName: className, changed: true };
}

/**
 * Liefert die aktuell zugeordnete Klasse eines Mitglieds (oder null). Prueft
 * wie assignClass() bei jedem Aufruf erneut die Verifizierung, damit
 * #wo-bin-ich nur verifizierten Mitgliedern zugaenglich ist.
 */
export async function getCurrentClassName(
  guildId: string,
  discordId: string,
): Promise<ClassName | null> {
  await assertMemberVerified(guildId, discordId);
  await assertProfileComplete(guildId, discordId);
  await assertFachrichtungChosen(guildId, discordId);
  const memberRow = await getMemberWithClass(guildId, discordId);
  return (memberRow?.class?.name as ClassName | undefined) ?? null;
}

/**
 * Zentraler Guard: stellt sicher, dass ein Mitglied bereits einer Klasse
 * zugeordnet ist, bevor es am Onboarding-Fragebogen oder der
 * Regelzustimmung teilnimmt (siehe memberJourneyService.ts - Klassenwahl
 * kommt jetzt vor beiden Schritten).
 */
export async function assertClassChosen(guildId: string, discordId: string): Promise<void> {
  const memberRow = await getMemberWithClass(guildId, discordId);
  if (!memberRow?.classId) {
    throw new PermissionError('Bitte waehle zuerst deine Klasse.');
  }
}

/** Vornamen der aktuell BESTAETIGT einer Klasse zugeordneten Mitglieder, je Klassenname. */
export type ClassMemberOverview = Record<ClassName, string[]>;

/**
 * Liefert je Klasse (A/B/C) die Vornamen der aktuell bestaetigten Mitglieder
 * - Grundlage fuer die "Erkennst du deine Klasse wieder?"-Uebersicht (siehe
 * classMessage.ts). Zeigt AUSSCHLIESSLICH Mitglieder mit tatsaechlich
 * gesetztem `Member.classId` (also nur nach abgeschlossener Bestaetigung
 * ueber assignClass(), siehe dortige Compare-and-Swap-Logik) - reine
 * Onboarding-Angaben ohne bestaetigte Klassenzuordnung tauchen hier nie auf.
 * Sortiert nach Beitrittszeitpunkt (aeltester Eintrag zuerst) fuer eine
 * stabile, nachvollziehbare Reihenfolge statt zufaelliger DB-Reihenfolge.
 * Eine Klasse ohne bestaetigte Mitglieder liefert ein leeres Array (siehe
 * classMessage.ts fuer die "Noch keine bestaetigten Teilnehmer"-Anzeige).
 */
export async function getConfirmedClassOverview(guildId: string): Promise<ClassMemberOverview> {
  const entries = await Promise.all(
    CLASS_NAMES.map(async (name): Promise<[ClassName, string[]]> => {
      const klasse = await getClassByName(guildId, name);
      if (!klasse) return [name, []];

      const members = await listMembersByClassId(klasse.id);
      const firstNames = members
        .slice()
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((member) => member.firstName)
        .filter((firstName): firstName is string => Boolean(firstName?.trim()));

      return [name, firstNames];
    }),
  );

  return Object.fromEntries(entries) as ClassMemberOverview;
}

/**
 * Meldet, dass ein Mitglied seine Klasse in der Uebersicht nicht erkennt und
 * Unterstuetzung braucht (Klick auf "Klasse nicht erkannt / Hilfe" - siehe
 * classMessage.ts). Es existiert im Projekt bewusst noch keine eigene
 * Ticket-/Support-Architektur (siehe ARCHITECTURE.md); daher die
 * kleinstmoegliche Ergaenzung: ein Audit-Log-Eintrag (ohne PII in den
 * Metadaten - nur die Discord-ID als `targetDiscordId`, wie bei jeder
 * anderen Audit-Aktion in diesem Projekt) plus ein Hinweis im bereits
 * bestehenden, bislang ungenutzten Log-Kanal (`GuildConfig.logChannelId`,
 * "📋-bot-log" - laut dessen eigenem Topic-Text explizit "reserviert fuer
 * Bot-Ausgaben"), auf den nur Admins/Moderatoren Zugriff haben. Kein neuer
 * Kanal, kein neues Datenmodell, keine parallele Insellösung.
 *
 * Der Postversuch selbst ist bewusst nicht-blockierend: schlaegt er fehl
 * (z. B. Kanal geloescht, fehlende Berechtigung), bleibt die Anfrage trotzdem
 * im Audit-Log nachvollziehbar - dieselbe "Komfortfunktion darf den
 * Kernablauf nicht sprengen"-Haltung wie an anderen Stellen im Projekt
 * (siehe z. B. trySetNickname() in discordNicknameSync.ts).
 */
export async function requestClassHelp(
  guildConfig: GuildConfig,
  targetMember: GuildMember,
  actorDiscordId: string,
): Promise<void> {
  await assertMemberVerified(guildConfig.id, targetMember.id);
  await assertProfileComplete(guildConfig.id, targetMember.id);
  await assertFachrichtungChosen(guildConfig.id, targetMember.id);

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'class.help_requested',
    targetDiscordId: targetMember.id,
  });

  logger.info(
    { guildId: guildConfig.id, member: targetMember.id },
    'Hilfe bei Klassenzuordnung angefragt',
  );

  if (!guildConfig.logChannelId) return;

  try {
    const channel = await targetMember.guild.channels.fetch(guildConfig.logChannelId);
    if (!channel?.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setTitle('🎫 Hilfe bei Klassenzuordnung angefragt')
      .setDescription(
        `${targetMember} erkennt die eigene Klasse in der Uebersicht nicht und braucht ` +
          'Unterstuetzung. Bitte einmal klaeren und die Klasse dann per ' +
          '`/mitglied-klasse-aendern` zuordnen.',
      )
      .setColor(0xf5a623);

    await channel.send({ embeds: [embed] });
  } catch (error) {
    logger.warn(
      { err: error, guildId: guildConfig.id, member: targetMember.id },
      'Konnte Hilfe-Hinweis nicht in den Log-Kanal posten',
    );
  }
}
