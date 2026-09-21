import type { GuildMember } from 'discord.js';
import type { GuildConfig, Member } from '@prisma/client';
import { getClassByName } from '../repositories/classRepository.js';
import { getMemberWithClass, setMemberClass } from '../repositories/memberRepository.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import { addRoleOrThrow, removeRoleOrThrow } from './discordRoleSync.js';
import { assertMemberVerified } from './verificationService.js';
import { assertProfileComplete } from './memberProfileService.js';
import { assertRulesAccepted } from './ruleService.js';
import { ValidationError } from '../utils/errors.js';
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
 * Wirft PermissionError, wenn das Mitglied nicht verifiziert ist, und
 * ValidationError, wenn die Zielklasse nicht existiert oder noch keine Rolle
 * konfiguriert ist (siehe /setup-klassen) bzw. wenn dem Bot die Berechtigung
 * zur Rollenvergabe fehlt.
 */
export async function assignClass(
  targetMember: GuildMember,
  guildConfig: GuildConfig,
  className: ClassName,
  actorDiscordId: string,
): Promise<ClassAssignmentResult> {
  await assertMemberVerified(guildConfig.id, targetMember.id);
  await assertProfileComplete(guildConfig.id, targetMember.id);
  await assertRulesAccepted(guildConfig.id, targetMember.id);

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
  await assertRulesAccepted(guildId, discordId);
  const memberRow = await getMemberWithClass(guildId, discordId);
  return (memberRow?.class?.name as ClassName | undefined) ?? null;
}
