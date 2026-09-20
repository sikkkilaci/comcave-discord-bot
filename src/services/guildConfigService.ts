import type { GuildConfig } from '@prisma/client';
import type { APIRole, Role } from 'discord.js';
import { updateGuildConfig } from '../repositories/guildConfigRepository.js';
import { logAuditEvent } from '../repositories/auditLogRepository.js';
import { roleHasAdministrator } from '../bot/discordHelpers.js';
import { ValidationError } from '../utils/errors.js';

export interface AdminRolesInput {
  adminRole: Role | APIRole;
  /** undefined = unveraendert lassen, null = Moderator-Rolle entfernen. */
  moderatorRole?: Role | APIRole | null;
}

/**
 * Konfiguriert die Rollen-IDs fuer das Berechtigungssystem (adminRoleId/
 * moderatorRoleId, siehe GuildConfig in prisma/schema.prisma). Beide Rollen
 * duerfen selbst niemals globale Discord-Administratorrechte tragen -
 * dasselbe Defense-in-Depth-Muster wie bei der Verifiziert-Rolle und den
 * Klassenrollen (roleHasAdministrator()), auch wenn diese Rollen (anders als
 * dort) nicht automatisch vom Bot vergeben werden: eine als Bot-Admin
 * referenzierte Rolle soll nicht gleichzeitig eine zweite, unkontrollierte
 * Rechtequelle ausserhalb des Bot-eigenen Berechtigungssystems sein.
 *
 * Hinweis: `adminRoleId` wird bereits aktiv in checkPermission.ts
 * (isServerAdmin()) und classAreaService.ts ausgewertet. `moderatorRoleId`
 * ist aktuell ausschliesslich Konfiguration ohne Wirkung - es gibt noch keine
 * PermissionLevel.MODERATOR und keine Moderationsfunktionen, die sie
 * auswerten wuerden (siehe ARCHITECTURE.md). Das Feld wird hier dennoch
 * konfigurierbar gemacht, damit es fuer eine spaetere Moderationsfunktion
 * bereitsteht, ohne dass dafuer ein zweiter Setup-Befehl noetig wird.
 */
export async function configureAdminRoles(
  guildId: string,
  input: AdminRolesInput,
  actorDiscordId: string,
): Promise<GuildConfig> {
  if (roleHasAdministrator(input.adminRole)) {
    throw new ValidationError(
      `Die Rolle ${input.adminRole.name} hat Administrator-Rechte. Die Admin-Rolle des Bots darf ` +
        'keine globalen Administratorrechte haben - bitte eine andere Rolle waehlen.',
    );
  }
  if (input.moderatorRole && roleHasAdministrator(input.moderatorRole)) {
    throw new ValidationError(
      `Die Rolle ${input.moderatorRole.name} hat Administrator-Rechte. Die Moderator-Rolle des ` +
        'Bots darf keine globalen Administratorrechte haben - bitte eine andere Rolle waehlen.',
    );
  }

  const updated = await updateGuildConfig(guildId, {
    adminRoleId: input.adminRole.id,
    ...(input.moderatorRole !== undefined
      ? { moderatorRoleId: input.moderatorRole?.id ?? null }
      : {}),
  });

  await logAuditEvent({
    guildId,
    actorDiscordId,
    action: 'admin.roles.setup',
    metadata: {
      adminRoleId: input.adminRole.id,
      ...(input.moderatorRole !== undefined
        ? { moderatorRoleId: input.moderatorRole?.id ?? null }
        : {}),
    },
  });

  return updated;
}
