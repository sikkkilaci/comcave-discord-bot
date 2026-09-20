import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { getClassByName } from '../../../repositories/classRepository.js';
import { setupClassArea } from '../../../services/classAreaService.js';
import {
  assertClassManagementAccess,
  isServerAdmin,
} from '../../../permissions/checkPermission.js';
import { ValidationError } from '../../../utils/errors.js';
import {
  CLASS_NAMES,
  CLASS_NAME_LABELS,
  classNameSchema,
  type ClassName,
} from '../../../types/domain.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('setup-klassenbereiche')
    .setDescription(
      '🏫 Richtet private Kanaele je Klasse ein (Admins: alle, Klassenleitung: nur die eigene).',
    )
    .addStringOption((option) =>
      option
        .setName('klasse')
        .setDescription('Klasse (Klassenleitung: eigene Klasse angeben; Admin-Standard: alle)')
        .setRequired(false)
        .addChoices(...CLASS_NAMES.map((name) => ({ name: CLASS_NAME_LABELS[name], value: name }))),
    ),
  // Klassenleitung darf den Befehl fuer die eigene Klasse ausfuehren (siehe
  // assertClassManagementAccess() unten), Admins fuer alle Klassen - die
  // eigentliche Einschraenkung auf "nur die eigene Klasse" erfolgt daher nicht
  // ueber diese globale Stufe, sondern gezielt pro Klasse in der Schleife.
  permissionLevel: PermissionLevel.KLASSENLEITUNG,
  async execute(interaction) {
    if (!interaction.guild) return;

    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);
    const requested = interaction.options.getString('klasse');

    if (!requested && !isServerAdmin(member, guildConfig)) {
      throw new ValidationError(
        'Als Klassenleitung musst du die Klasse angeben, fuer die du den Klassenbereich einrichten willst.',
      );
    }

    const targetNames: ClassName[] = requested
      ? [classNameSchema.parse(requested)]
      : [...CLASS_NAMES];

    const lines: string[] = [];

    for (const name of targetNames) {
      const klasse = await getClassByName(interaction.guild.id, name);

      // Fail-closed: verweigert Klassenleitung den Zugriff auf jede Klasse,
      // deren leadRoleId sie nicht besitzt - inklusive Klassen, die noch gar
      // nicht existieren (leadRoleId dann implizit null). Ohne diese Pruefung
      // koennte eine manipulierte "klasse"-Angabe eine fremde Klasse treffen.
      assertClassManagementAccess(member, guildConfig, klasse ?? { name, leadRoleId: null });

      if (!klasse || !klasse.roleId) {
        lines.push(
          `${CLASS_NAME_LABELS[name]}: übersprungen - noch keine Rolle konfiguriert (siehe /setup-klassen).`,
        );
        continue;
      }

      try {
        const result = await setupClassArea(
          interaction.guild,
          guildConfig,
          klasse,
          interaction.user.id,
        );
        const summary = result.categoryCreated
          ? `Kategorie und ${result.channelsCreated.length} Kanaele neu angelegt`
          : result.channelsCreated.length > 0
            ? `${result.channelsCreated.length} fehlende Kanaele ergaenzt (${result.channelsSkipped.length} bereits vorhanden)`
            : 'bereits vollstaendig eingerichtet';
        lines.push(`${CLASS_NAME_LABELS[name]}: ${summary}.`);
      } catch (error) {
        if (error instanceof ValidationError) {
          lines.push(`${CLASS_NAME_LABELS[name]}: Fehler - ${error.message}`);
          continue;
        }
        throw error;
      }
    }

    await interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
  },
};

export default command;
