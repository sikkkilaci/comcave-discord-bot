import { DiscordAPIError, type GuildMember } from 'discord.js';
import type { GuildConfig, Member } from '@prisma/client';
import { getOrCreateMember, setVerificationStatus } from '../repositories/memberRepository.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import { ValidationError } from '../utils/errors.js';
import type { VerificationStatus } from '../types/domain.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('verificationService');

const AUDIT_ACTION_BY_STATUS: Record<VerificationStatus, string> = {
  VERIFIED: 'member.verify',
  REJECTED: 'member.reject',
  PENDING: 'member.reset',
};

/** Discord-API-Fehlercode fuer "Missing Permissions". */
const DISCORD_MISSING_PERMISSIONS = 50013;

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

  try {
    if (status === 'VERIFIED' && !hasRole) {
      await targetMember.roles.add(verifiedRoleId, 'Verifizierung: Status auf VERIFIED gesetzt');
    } else if (status !== 'VERIFIED' && hasRole) {
      await targetMember.roles.remove(
        verifiedRoleId,
        `Verifizierung: Status auf ${status} gesetzt`,
      );
    }
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === DISCORD_MISSING_PERMISSIONS) {
      throw new ValidationError(
        'Mir fehlt die Berechtigung, die Verifiziert-Rolle zu vergeben oder zu entziehen. ' +
          'Bitte pruefe, ob meine Bot-Rolle in der Rollenhierarchie ueber dieser Rolle steht.',
      );
    }
    throw error;
  }
}
