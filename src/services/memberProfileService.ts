import type { GuildConfig, Member } from '@prisma/client';
import type { GuildMember } from 'discord.js';
import {
  getMember,
  updatePersonalDetails,
  type PersonalDetailsUpdate,
} from '../repositories/memberRepository.js';
import { getLocationById } from '../repositories/locationRepository.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import { isServerAdmin } from '../permissions/checkPermission.js';
import { assertMemberVerified } from './verificationService.js';
import { trySetNickname } from './discordNicknameSync.js';
import { NotFoundError, PermissionError, ValidationError } from '../utils/errors.js';
import { ageSchema, personNameSchema } from '../types/domain.js';

/** Discord erlaubt maximal 32 Zeichen fuer einen Server-Nickname. */
const DISCORD_NICKNAME_MAX_LENGTH = 32;

function validateName(value: string, fieldLabel: string): string {
  const result = personNameSchema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(`${fieldLabel}: ${result.error.issues[0]?.message ?? 'ungueltig.'}`);
  }
  return result.data;
}

function validateAge(value: number): number {
  const result = ageSchema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(`Alter: ${result.error.issues[0]?.message ?? 'ungueltig.'}`);
  }
  return result.data;
}

function buildNickname(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.slice(0, DISCORD_NICKNAME_MAX_LENGTH);
}

/**
 * Stellt sicher, dass ein Mitglied die Pflichtangaben (Vorname, Nachname,
 * Alter, COMCAVE-Standort) bereits vollstaendig gemacht hat, bevor es an
 * nachgelagerten Funktionen (Regelzustimmung, Onboarding, Klassenwahl)
 * teilnimmt. Zentraler Guard nach demselben Prinzip wie
 * assertMemberVerified() - wird bei jedem Zugriff frisch geprueft, damit ein
 * direkter Aufruf von z. B. /onboarding vor Abschluss des Profils fail-closed
 * abgelehnt wird.
 */
export async function assertProfileComplete(guildId: string, discordId: string): Promise<Member> {
  const member = await getMember(guildId, discordId);
  if (!member || !member.profileCompletedAt) {
    throw new PermissionError(
      'Bitte vervollstaendige zuerst dein Teilnehmerprofil (Vorname, Nachname, Alter, ' +
        'COMCAVE-Standort), bevor du fortfaehrst.',
    );
  }
  return member;
}

export interface PersonalDetailsInput {
  vorname: string;
  nachname: string;
  alter: number;
}

/**
 * Speichert Vorname/Nachname/Alter eines verifizierten Mitglieds (erster
 * Teil des Pflichtprofils, siehe Modal in profileMessage.ts). Setzt noch
 * NICHT `profileCompletedAt` - das geschieht erst in
 * completeProfileAndSetNickname(), sobald zusaetzlich ein Standort gewaehlt
 * wurde.
 */
export async function submitPersonalDetails(
  guildConfig: GuildConfig,
  targetMember: GuildMember,
  input: PersonalDetailsInput,
  actorDiscordId: string,
): Promise<Member> {
  await assertMemberVerified(guildConfig.id, targetMember.id);

  const firstName = validateName(input.vorname, 'Vorname');
  const lastName = validateName(input.nachname, 'Nachname');
  const age = validateAge(input.alter);

  const updated = await updatePersonalDetails(guildConfig.id, targetMember.id, {
    firstName,
    lastName,
    age,
  });

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'member.profile_details_set',
    targetDiscordId: targetMember.id,
    metadata: { fieldsChanged: ['firstName', 'lastName', 'age'] },
  });

  return updated;
}

/**
 * Setzt den COMCAVE-Standort eines Mitglieds (zweiter Teil des
 * Pflichtprofils, siehe `/standort-waehlen`). Die `locationId` wird immer
 * gegen die Datenbank aufgeloest (getLocationById()) und muss aktiv sein -
 * eine manipulierte/veraltete ID aus einer Autocomplete-Antwort wird dadurch
 * fail-closed abgelehnt.
 */
export async function selectLocation(
  guildConfig: GuildConfig,
  targetMember: GuildMember,
  locationId: string,
  actorDiscordId: string,
): Promise<Member> {
  await assertMemberVerified(guildConfig.id, targetMember.id);

  const location = await getLocationById(locationId);
  if (!location || !location.isActive) {
    throw new ValidationError(
      'Dieser Standort ist nicht (mehr) gueltig. Bitte waehle einen aktuellen Standort ueber ' +
        'die Vorschlagsliste aus.',
    );
  }

  const updated = await updatePersonalDetails(guildConfig.id, targetMember.id, {
    locationId: location.id,
  });

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'member.location_set',
    targetDiscordId: targetMember.id,
    metadata: { fieldsChanged: ['locationId'] },
  });

  return updated;
}

export interface ProfileCompletionResult {
  member: Member;
  nickname: string;
  nicknameChanged: boolean;
  nicknameSkipped: boolean;
}

/**
 * Schliesst das Pflichtprofil ab, sobald sowohl die persoenlichen Angaben
 * (submitPersonalDetails()) als auch der Standort (selectLocation()) gesetzt
 * sind: setzt `profileCompletedAt` und synchronisiert den Server-Nickname zu
 * "Vorname Nachname" (niemals den globalen Discord-Username - siehe
 * discordNicknameSync.ts). Ein Fehlschlag beim Nickname-Setzen (fehlende
 * Berechtigung, Server-Owner) blockiert den Profilabschluss NICHT - siehe
 * trySetNickname().
 */
export async function completeProfileAndSetNickname(
  guildConfig: GuildConfig,
  targetMember: GuildMember,
  actorDiscordId: string,
): Promise<ProfileCompletionResult> {
  const memberRow = await getMember(guildConfig.id, targetMember.id);
  if (!memberRow) {
    throw new NotFoundError('Mitglied wurde nicht gefunden.');
  }
  if (!memberRow.firstName || !memberRow.lastName || memberRow.age === null) {
    throw new ValidationError(
      'Bitte fuelle zuerst deine persoenlichen Angaben (Vorname/Nachname/Alter) aus.',
    );
  }
  if (!memberRow.locationId) {
    throw new ValidationError('Bitte waehle zuerst deinen COMCAVE-Standort aus.');
  }

  const nickname = buildNickname(memberRow.firstName, memberRow.lastName);
  const nicknameResult = await trySetNickname(
    targetMember,
    nickname,
    'Teilnehmerprofil abgeschlossen',
  );

  const alreadyCompleted = memberRow.profileCompletedAt !== null;
  const updated = alreadyCompleted
    ? memberRow
    : await updatePersonalDetails(guildConfig.id, targetMember.id, {
        profileCompletedAt: new Date(),
      });

  if (!alreadyCompleted) {
    await logAuditEvent({
      guildId: guildConfig.id,
      actorDiscordId,
      action: 'member.profile_completed',
      targetDiscordId: targetMember.id,
      metadata: {
        fieldsChanged: ['profileCompletedAt'],
        nicknameSet: nicknameResult.changed,
        nicknameSkipped: nicknameResult.skipped,
      },
    });
  }

  return {
    member: updated,
    nickname,
    nicknameChanged: nicknameResult.changed,
    nicknameSkipped: nicknameResult.skipped,
  };
}

export interface AdminProfileEditInput {
  vorname?: string;
  nachname?: string;
  alter?: number;
  standortId?: string;
}

export interface AdminProfileEditResult {
  member: Member;
  nicknameChanged: boolean;
  nicknameSkipped: boolean;
}

/**
 * Kontrollierter Korrekturprozess fuer bereits erfasste Profildaten (siehe
 * `/mitglied-profil-bearbeiten`) - ADMIN-only, da Aenderungen an Namen/Alter/
 * Standort eines Mitglieds nicht selbstbedienbar sein sollen (verhindert
 * z. B. wiederholtes, unkontrolliertes Aendern des Alters). Aktualisiert bei
 * einer Namensaenderung automatisch auch den Server-Nickname.
 */
export async function updatePersonalDetailsAsAdmin(
  guildConfig: GuildConfig,
  actingMember: GuildMember,
  targetMember: GuildMember,
  input: AdminProfileEditInput,
  actorDiscordId: string,
): Promise<AdminProfileEditResult> {
  if (!isServerAdmin(actingMember, guildConfig)) {
    throw new PermissionError('Nur globale Admins duerfen Teilnehmerprofile bearbeiten.');
  }

  const data: PersonalDetailsUpdate = {};
  const fieldsChanged: string[] = [];

  if (input.vorname !== undefined) {
    data.firstName = validateName(input.vorname, 'Vorname');
    fieldsChanged.push('firstName');
  }
  if (input.nachname !== undefined) {
    data.lastName = validateName(input.nachname, 'Nachname');
    fieldsChanged.push('lastName');
  }
  if (input.alter !== undefined) {
    data.age = validateAge(input.alter);
    fieldsChanged.push('age');
  }
  if (input.standortId !== undefined) {
    const location = await getLocationById(input.standortId);
    if (!location || !location.isActive) {
      throw new ValidationError('Dieser Standort ist nicht (mehr) gueltig.');
    }
    data.locationId = location.id;
    fieldsChanged.push('locationId');
  }

  if (fieldsChanged.length === 0) {
    throw new ValidationError('Es wurde keine Aenderung angegeben.');
  }

  const updated = await updatePersonalDetails(guildConfig.id, targetMember.id, data);

  let nicknameChanged = false;
  let nicknameSkipped = false;
  if (
    updated.firstName &&
    updated.lastName &&
    (input.vorname !== undefined || input.nachname !== undefined)
  ) {
    const result = await trySetNickname(
      targetMember,
      buildNickname(updated.firstName, updated.lastName),
      'Teilnehmerprofil administrativ aktualisiert',
    );
    nicknameChanged = result.changed;
    nicknameSkipped = result.skipped;
  }

  await logAuditEvent({
    guildId: guildConfig.id,
    actorDiscordId,
    action: 'member.profile_updated_by_admin',
    targetDiscordId: targetMember.id,
    metadata: { fieldsChanged },
  });

  return { member: updated, nicknameChanged, nicknameSkipped };
}
