import { PermissionFlagsBits, type APIRole, type GuildMember, type Role } from 'discord.js';

/** Minimale Teilmenge von discord.js' `Guild`, die fuer die Mitgliedersuche noetig ist. */
export interface GuildMemberFetchable {
  members: { fetch(userId: string): Promise<GuildMember> };
}

/**
 * Sucht ueber alle Server, auf denen der Bot aktiv ist, nach einem Mitglied
 * mit der angegebenen Discord-User-ID. Wird gebraucht, wenn eine Interaktion
 * per DM eintrifft (z. B. Klick auf den Verifizierungs-Button aus der
 * Beitritts-DM) und daher kein Guild-Kontext mitgeliefert wird
 * (`interaction.guild` ist dort `null`).
 *
 * Fuer den primaeren Einsatzzweck (ein einzelner privater Server) reicht die
 * einfache Suche voellig aus; bei mehreren gemeinsamen Servern wird der erste
 * Treffer verwendet.
 */
export async function findGuildMemberAcrossGuilds(
  guilds: Iterable<GuildMemberFetchable>,
  userId: string,
): Promise<GuildMember | null> {
  for (const guild of guilds) {
    try {
      const member = await guild.members.fetch(userId);
      if (member) return member;
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Prueft, ob eine Rolle die Administrator-Berechtigung traegt. Wird von
 * Setup-Commands verwendet, um zu verhindern, dass eine Rolle mit globalen
 * Admin-Rechten versehentlich als Klassen-/Interessenrolle konfiguriert wird.
 *
 * `interaction.options.getRole()` liefert typseitig `Role | APIRole`: bei
 * einer echten Guild-Interaktion ist es praktisch immer ein voll aufgeloestes
 * `Role`-Objekt, aber `APIRole` traegt Berechtigungen nur als rohen
 * String-Bitfeld statt eines `PermissionsBitField` - daher die Fallunterscheidung.
 */
export function roleHasAdministrator(role: Role | APIRole): boolean {
  if (typeof role.permissions === 'string') {
    return (
      (BigInt(role.permissions) & PermissionFlagsBits.Administrator) ===
      PermissionFlagsBits.Administrator
    );
  }
  return role.permissions.has(PermissionFlagsBits.Administrator);
}
