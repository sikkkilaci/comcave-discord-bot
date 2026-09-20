import { DiscordAPIError, type GuildMember } from 'discord.js';
import { ValidationError } from '../utils/errors.js';

/** Discord-API-Fehlercode fuer "Missing Permissions". */
const DISCORD_MISSING_PERMISSIONS = 50013;

/**
 * Vergibt bzw. entzieht eine Rolle und uebersetzt eine fehlende Bot-
 * Berechtigung (Discord-Fehlercode 50013, typischerweise weil die Bot-Rolle
 * in der Rollenhierarchie zu niedrig steht) in eine verstaendliche
 * ValidationError statt einen kryptischen DiscordAPIError durchzureichen.
 * Wird von allen Services verwendet, die Rollen vergeben (Verifizierung,
 * Klassenzuweisung, kuenftig Interessenrollen), damit diese Uebersetzung
 * nur an einer Stelle gepflegt werden muss.
 */
export async function addRoleOrThrow(
  member: GuildMember,
  roleId: string,
  reason: string,
): Promise<void> {
  try {
    await member.roles.add(roleId, reason);
  } catch (error) {
    throw translateRoleError(error);
  }
}

export async function removeRoleOrThrow(
  member: GuildMember,
  roleId: string,
  reason: string,
): Promise<void> {
  try {
    await member.roles.remove(roleId, reason);
  } catch (error) {
    throw translateRoleError(error);
  }
}

function translateRoleError(error: unknown): unknown {
  if (error instanceof DiscordAPIError && error.code === DISCORD_MISSING_PERMISSIONS) {
    return new ValidationError(
      'Mir fehlt die Berechtigung, diese Rolle zu vergeben oder zu entziehen. ' +
        'Bitte pruefe, ob meine Bot-Rolle in der Rollenhierarchie ueber dieser Rolle steht.',
    );
  }
  return error;
}
