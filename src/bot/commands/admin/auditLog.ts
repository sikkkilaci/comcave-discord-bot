import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { getOrCreateGuildConfig } from '../../../repositories/guildConfigRepository.js';
import { getAuditLogPage, type AuditLogFilter } from '../../../services/auditLogService.js';
import { buildAuditLogEmbed } from '../../ui/auditLogMessage.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('audit-log')
    .setDescription('🛡️ Zeigt das Audit-Log dieses Servers an (nur globale Admins).')
    .addIntegerOption((option) =>
      option
        .setName('seite')
        .setDescription('Seitenzahl (Standard: 1, neueste Eintraege zuerst)')
        .setRequired(false)
        .setMinValue(1),
    )
    .addStringOption((option) =>
      option
        .setName('aktion')
        .setDescription('Nur Eintraege mit genau dieser Aktion anzeigen (z. B. class.setup)')
        .setRequired(false)
        .setMaxLength(100),
    )
    .addUserOption((option) =>
      option
        .setName('nutzer')
        .setDescription('Nur Eintraege anzeigen, die dieser Nutzer ausgefuehrt hat')
        .setRequired(false),
    ),
  permissionLevel: PermissionLevel.ADMIN,
  async execute(interaction) {
    if (!interaction.guild) return;

    const member = interaction.member as GuildMember;
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);
    const page = interaction.options.getInteger('seite') ?? 1;
    const aktion = interaction.options.getString('aktion');
    const nutzer = interaction.options.getUser('nutzer');

    const filter: AuditLogFilter = {
      ...(aktion !== null ? { aktion } : {}),
      ...(nutzer ? { ausfuehrenderDiscordId: nutzer.id } : {}),
    };

    const result = await getAuditLogPage(guildConfig, member, page, filter);

    await interaction.reply({
      embeds: [buildAuditLogEmbed(result)],
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;
