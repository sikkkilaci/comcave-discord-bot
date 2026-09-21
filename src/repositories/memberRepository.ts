import type { Class, ComcaveLocation, Member } from '@prisma/client';
import { prisma } from '../db/client.js';
import type { Fachrichtung, ItExperienceLevel, VerificationStatus } from '../types/domain.js';

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

/**
 * Listet alle Mitglieder, die aktuell einer Klasse zugeordnet sind. Da eine
 * Klassenzuordnung nur fuer verifizierte Mitglieder moeglich ist (siehe
 * assignClass() in classService.ts), sind das automatisch ausschliesslich
 * verifizierte Mitglieder - keine zusaetzliche Statuspruefung noetig.
 */
export async function listMembersByClassId(classId: string): Promise<Member[]> {
  return prisma.member.findMany({ where: { classId } });
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
 * Setzt die Fachrichtung eines Mitglieds (siehe fachrichtungService.ts). Wird
 * nur einmal aufgerufen, solange noch keine gesetzt ist - die Sperre gegen
 * ein spaeteres Selbst-Aendern liegt im Service, nicht hier.
 */
export async function setMemberFachrichtung(
  guildId: string,
  discordId: string,
  fachrichtung: Fachrichtung,
): Promise<Member> {
  await getOrCreateMember(guildId, discordId);
  return prisma.member.update({
    where: { guildId_discordId: { guildId, discordId } },
    data: { fachrichtung },
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

export type MemberWithLocation = Member & { location: ComcaveLocation | null };

/** Wie getMember(), laedt aber zusaetzlich den zugeordneten COMCAVE-Standort (falls vorhanden). */
export async function getMemberWithLocation(
  guildId: string,
  discordId: string,
): Promise<MemberWithLocation | null> {
  return prisma.member.findUnique({
    where: { guildId_discordId: { guildId, discordId } },
    include: { location: true },
  });
}

/**
 * Pflichtangaben des Teilnehmerprofils (siehe memberProfileService.ts).
 * Getrennt von MemberProfileUpdate (Onboarding-Denormalisierung), da
 * inhaltlich ein eigener, vorgelagerter Schritt mit eigenen personenbezogenen
 * Feldern.
 */
export interface PersonalDetailsUpdate {
  firstName?: string;
  lastName?: string;
  age?: number;
  locationId?: string;
  profileCompletedAt?: Date;
}

/** Anzahl verifizierter Mitglieder einer Guild - fuer /regelwerk-status (Zustimmungsquote). */
export async function countVerifiedMembers(guildId: string): Promise<number> {
  return prisma.member.count({ where: { guildId, verificationStatus: 'VERIFIED' } });
}

export async function updatePersonalDetails(
  guildId: string,
  discordId: string,
  data: PersonalDetailsUpdate,
): Promise<Member> {
  await getOrCreateMember(guildId, discordId);
  return prisma.member.update({
    where: { guildId_discordId: { guildId, discordId } },
    data,
  });
}
