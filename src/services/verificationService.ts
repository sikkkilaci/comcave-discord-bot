import type { GuildMember } from 'discord.js';
import type { GuildConfig, Member } from '@prisma/client';
import {
  getMember,
  getOrCreateMember,
  setVerificationStatus,
} from '../repositories/memberRepository.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import { addRoleOrThrow, removeRoleOrThrow } from './discordRoleSync.js';
import { PermissionError, ValidationError } from '../utils/errors.js';
import type { VerificationStatus } from '../types/domain.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('verificationService');

const AUDIT_ACTION_BY_STATUS: Record<VerificationStatus, string> = {
  VERIFIED: 'member.verify',
  REJECTED: 'member.reject',
  PENDING: 'member.reset',
};

export interface VerificationChangeResult {
  member: Member;
  /** false, wenn das Mitglied bereits im Zielstatus war (kein DB-/Rollen-Update noetig). */
  changed: boolean;
}

/**
 * Legt bei Bedarf einen Member-Datensatz mit Status PENDING an, ohne Rollen
 * zu vergeben. Wird beim Server-Beitritt aufgerufen, damit jedes Mitglied ab
 * dem ersten Kontakt in der Datenbank nachverfolgt wird.
 */
export async function ensureMemberTracked(guildId: string, discordId: string): Promise<Member> {
  return getOrCreateMember(guildId, discordId);
}

/**
 * Setzt den Verifizierungsstatus eines Mitglieds und vergibt bzw. entzieht
 * dabei die konfigurierte Verifiziert-Rolle auf Discord. Wird sowohl fuer die
 * Selbst-Verifizierung (Button/`/verifizieren`) als auch fuer administrative
 * Korrekturen (`/mitglied-verifizieren`) verwendet.
 *
 * Wirft ValidationError, wenn beim Wechsel zu VERIFIED keine Verifiziert-Rolle
 * konfiguriert ist, oder wenn dem Bot die Berechtigung zur Rollenvergabe fehlt.
 */
export async function setMemberVerification(
  targetMember: GuildMember,
  guildConfig: GuildConfig,
  status: VerificationStatus,
  actorDiscordId: string,
): Promise<VerificationChangeResult> {
  if (status === 'VERIFIED' && !guildConfig.verifiedRoleId) {
    throw new ValidationError(
      'Es ist noch keine Verifiziert-Rolle konfiguriert. Ein Admin muss zuerst /setup-verifizierung ausfuehren.',
    );
  }

  const existing = await getOrCreateMember(guildConfig.id, targetMember.id);
  if (existing.verificationStatus === status) {
    return { member: existing, changed: false };
  }

  if (guildConfig.verifiedRoleId) {
    await syncVerifiedRole(targetMember, guildConfig.verifiedRoleId, status);
  }

  const updated = await setVerificationStatus(guildConfig.id, targetMember.id, status);

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: AUDIT_ACTION_BY_STATUS[status],
    targetDiscordId: targetMember.id,
  });

  logger.info(
    { guildId: guildConfig.id, member: targetMember.id, actor: actorDiscordId, status },
    'Verifizierungsstatus geaendert',
  );

  return { member: updated, changed: true };
}

async function syncVerifiedRole(
  targetMember: GuildMember,
  verifiedRoleId: string,
  status: VerificationStatus,
): Promise<void> {
  const hasRole = targetMember.roles.cache.has(verifiedRoleId);

  if (status === 'VERIFIED' && !hasRole) {
    await addRoleOrThrow(
      targetMember,
      verifiedRoleId,
      'Verifizierung: Status auf VERIFIED gesetzt',
    );
  } else if (status !== 'VERIFIED' && hasRole) {
    await removeRoleOrThrow(
      targetMember,
      verifiedRoleId,
      `Verifizierung: Status auf ${status} gesetzt`,
    );
  }
}

/**
 * Stellt sicher, dass ein Mitglied verifiziert ist, bevor es an Funktionen
 * teilnimmt, die Verifizierung voraussetzen (Onboarding, Klassenauswahl).
 * Zentraler Guard, der bei jedem Zugriff neu prueft statt nur einmalig -
 * ein zwischenzeitlicher Statuswechsel (z. B. Admin setzt ein Mitglied
 * zurueck) sperrt den weiteren Zugriff sofort.
 */
export async function assertMemberVerified(guildId: string, discordId: string): Promise<Member> {
  const member = await getMember(guildId, discordId);
  if (!member || member.verificationStatus !== 'VERIFIED') {
    throw new PermissionError(
      'Bitte verifiziere dich zuerst (Button oder /verifizieren), bevor du diese Funktion nutzt.',
    );
  }
  return member;
}
