import type { Class, Member } from '@prisma/client';
import { prisma } from '../db/client.js';
import type { ItExperienceLevel, VerificationStatus } from '../types/domain.js';

/**
 * Liefert den Member-Datensatz eines Discord-Nutzers auf einem Server und
 * legt bei Bedarf einen neuen mit Status PENDING an (z. B. beim Server-Beitritt
 * oder bei der ersten Interaktion mit einem Verifizierungs-Befehl).
 */
export async function getOrCreateMember(guildId: string, discordId: string): Promise<Member> {
  return prisma.member.upsert({
    where: { guildId_discordId: { guildId, discordId } },
    update: {},
    create: { guildId, discordId },
  });
}

export async function getMember(guildId: string, discordId: string): Promise<Member | null> {
  return prisma.member.findUnique({
    where: { guildId_discordId: { guildId, discordId } },
  });
}

export type MemberWithClass = Member & { class: Class | null };

/** Wie getMember(), laedt aber zusaetzlich die aktuell zugeordnete Klasse (falls vorhanden). */
export async function getMemberWithClass(
  guildId: string,
  discordId: string,
): Promise<MemberWithClass | null> {
  return prisma.member.findUnique({
    where: { guildId_discordId: { guildId, discordId } },
    include: { class: true },
  });
}

/**
 * Setzt (oder loescht mit `null`) die Klassenzuordnung eines Mitglieds. Ein
 * Mitglied kann laut Datenmodell (`Member.classId`, einzelnes Feld statt
 * Liste) immer nur einer Klasse gleichzeitig angehoeren.
 */
export async function setMemberClass(
  guildId: string,
  discordId: string,
  classId: string | null,
): Promise<Member> {
  await getOrCreateMember(guildId, discordId);
  return prisma.member.update({
    where: { guildId_discordId: { guildId, discordId } },
    data: { classId },
  });
}

/**
 * Setzt den Verifizierungsstatus eines Mitglieds. `verifiedAt` wird beim
 * Wechsel zu VERIFIED gesetzt und bei jedem anderen Status zurueckgesetzt,
 * damit es immer den Zeitpunkt der zuletzt *aktiven* Verifizierung abbildet.
 */
export async function setVerificationStatus(
  guildId: string,
  discordId: string,
  status: VerificationStatus,
): Promise<Member> {
  await getOrCreateMember(guildId, discordId);
  return prisma.member.update({
    where: { guildId_discordId: { guildId, discordId } },
    data: {
      verificationStatus: status,
      verifiedAt: status === 'VERIFIED' ? new Date() : null,
    },
  });
}

export interface MemberProfileUpdate {
  itExperienceLevel?: ItExperienceLevel;
  /** Bereits JSON-kodierte Interessen-Liste (siehe onboardingService). */
  interests?: string;
}

/**
 * Aktualisiert die aus dem Onboarding denormalisierten Profilfelder auf
 * Member. Diese Felder sind ein Lese-Komfort fuer kuenftige Rollen-/Klassen-
 * logik; die vollstaendige Antworthistorie bleibt unabhaengig davon in
 * OnboardingAnswer erhalten (siehe onboardingRepository).
 */
export async function updateMemberProfile(
  guildId: string,
  discordId: string,
  data: MemberProfileUpdate,
): Promise<Member> {
  await getOrCreateMember(guildId, discordId);
  return prisma.member.update({
    where: { guildId_discordId: { guildId, discordId } },
    data,
  });
}
