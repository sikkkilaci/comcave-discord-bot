import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { assignClassLead } from '../../../services/classLeadService.js';
import { CLASS_NAMES, CLASS_NAME_LABELS, classNameSchema } from '../../../types/domain.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('setup-klassenleitung')
    .setDescription('👑 Weist einem Mitglied die Klassenleitung einer Klasse zu (nur Admins).')
    .addStringOption((option) =>
      option
        .setName('klasse')
        .setDescription('Klasse, fuer die die Klassenleitung zugewiesen wird')
        .setRequired(true)
        .addChoices(...CLASS_NAMES.map((name) => ({ name: CLASS_NAME_LABELS[name], value: name }))),
    )
    .addUserOption((option) =>
      option.setName('mitglied').setDescription('Neue Klassenleitung').setRequired(true),
    ),
  permissionLevel: PermissionLevel.ADMIN,
  async execute(interaction) {
    if (!interaction.guild) return;

    const className = classNameSchema.parse(interaction.options.getString('klasse', true));
    const targetMember = interaction.options.getMember('mitglied') as GuildMember | null;

    if (!targetMember) {
      await interaction.reply({
        content: 'Dieses Mitglied konnte nicht gefunden werden (evtl. nicht mehr auf dem Server).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);
    const result = await assignClassLead(
      interaction.guild,
      guildConfig,
      className,
      targetMember,
      interaction.user.id,
    );

    const notes: string[] = [];
    if (result.reassignedFromClassName) {
      notes.push(
        `(war zuvor Klassenleitung von Klasse ${result.reassignedFromClassName}, dort automatisch entfernt)`,
      );
    } else if (result.previousLeadDiscordId) {
      notes.push('(vorherige Klassenleitung dieser Klasse wurde ersetzt)');
    }
    if (result.leadRoleCreated) {
      notes.push('(Klassenleitungs-Rolle wurde neu angelegt)');
    }

    await interaction.reply({
      content:
        `${targetMember} ist jetzt Klassenleitung von ${CLASS_NAME_LABELS[className]}. ` +
        notes.join(' '),
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;
