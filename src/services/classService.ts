import type { GuildMember } from 'discord.js';
import type { GuildConfig, Member } from '@prisma/client';
import { getClassByName } from '../repositories/classRepository.js';
import { getMemberWithClass, setMemberClass } from '../repositories/memberRepository.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import { addRoleOrThrow, removeRoleOrThrow } from './discordRoleSync.js';
import { assertMemberVerified } from './verificationService.js';
import { assertProfileComplete } from './memberProfileService.js';
import { assertFachrichtungChosen } from './fachrichtungService.js';
import { PermissionError, ValidationError } from '../utils/errors.js';
import type { ClassName } from '../types/domain.js';
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

  if (previousClass && previousClass.id !== targetClass.id && previousClass.roleId) {
    if (targetMember.roles.cache.has(previousClass.roleId)) {
      await removeRoleOrThrow(
        targetMember,
        previousClass.roleId,
        `Klassenwechsel: ${previousClass.name} -> ${className}`,
      );
    }
  }

  if (!alreadyHasRole) {
    await addRoleOrThrow(targetMember, targetClass.roleId, `Klassenzuweisung: ${className}`);
  }

  const updatedMember = await setMemberClass(guildConfig.id, targetMember.id, targetClass.id);

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
