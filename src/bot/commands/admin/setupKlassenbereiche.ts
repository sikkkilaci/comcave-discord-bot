import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { getClassByName } from '../../../repositories/classRepository.js';
import { setupClassArea } from '../../../services/classAreaService.js';
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
      '🏫 Richtet private Kanaele (Chat, Ankuendigungen, Termine, ...) je Klasse ein (nur Admins).',
    )
    .addStringOption((option) =>
      option
        .setName('klasse')
        .setDescription(
          'Nur eine bestimmte Klasse einrichten (Standard: alle konfigurierten Klassen)',
        )
        .setRequired(false)
        .addChoices(...CLASS_NAMES.map((name) => ({ name: CLASS_NAME_LABELS[name], value: name }))),
    ),
  permissionLevel: PermissionLevel.ADMIN,
  async execute(interaction) {
    if (!interaction.guild) return;

    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);
    const requested = interaction.options.getString('klasse');
    const targetNames: ClassName[] = requested
      ? [classNameSchema.parse(requested)]
      : [...CLASS_NAMES];

    const lines: string[] = [];

    for (const name of targetNames) {
      const klasse = await getClassByName(interaction.guild.id, name);

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
