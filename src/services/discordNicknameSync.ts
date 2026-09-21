import { DiscordAPIError, type GuildMember } from 'discord.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('discordNicknameSync');

/**
 * Discord-API-Fehlercode fuer "Missing Permissions" - deckt sowohl eine
 * fehlende `ManageNicknames`-Berechtigung des Bots als auch den Sonderfall ab,
 * dass das Zielmitglied (z. B. der Server-Owner) nicht umbenannt werden darf.
 */
const DISCORD_MISSING_PERMISSIONS = 50013;

export interface SetNicknameResult {
  changed: boolean;
  /** true, wenn Discord das Setzen abgelehnt hat (fehlende Berechtigung/Owner-Sonderfall) - kein Fehler, nur uebersprungen. */
  skipped: boolean;
}

/**
 * Setzt den SERVERBEZOGENEN Nicknamen eines Mitglieds - niemals den globalen
 * Discord-Username/Gamertag (dafuer besitzt weder discord.js noch die
 * Discord-API ueberhaupt eine Bot-Berechtigung; `GuildMember.setNickname()`
 * wirkt ausschliesslich auf den serverbezogenen Anzeigenamen).
 *
 * Faengt eine fehlende `ManageNicknames`-Berechtigung UND den Sonderfall
 * "Zielmitglied ist der Server-Owner" (dessen Nickname niemand ausser ihm
 * selbst aendern kann) einheitlich ab: in beiden Faellen wird NICHT
 * geworfen, sondern `skipped: true` zurueckgegeben - ein fehlender Nickname
 * darf niemals den restlichen Eintrittsflow (Regeln/Onboarding/Klassenwahl)
 * blockieren oder den Bot abstuerzen lassen (Fail-safe statt Fail-closed,
 * da eine kosmetische Nickname-Aenderung kein Sicherheitsmerkmal ist).
 */
export async function trySetNickname(
  member: GuildMember,
  nickname: string,
  reason: string,
): Promise<SetNicknameResult> {
  if (member.nickname === nickname) {
    return { changed: false, skipped: false };
  }

  try {
    await member.setNickname(nickname, reason);
    return { changed: true, skipped: false };
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === DISCORD_MISSING_PERMISSIONS) {
      logger.warn(
        { guildId: member.guild.id, member: member.id },
        'Konnte Server-Nickname nicht setzen (fehlende Berechtigung oder Server-Owner) - ' +
          'Flow laeuft ohne Nickname-Aenderung weiter.',
      );
      return { changed: false, skipped: true };
    }
    throw error;
  }
}
