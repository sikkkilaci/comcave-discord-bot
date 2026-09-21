import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';
import { bootstrapServer, type BootstrapResult } from '../../../services/serverBootstrapService.js';
import { CLASS_NAMES } from '../../../types/domain.js';

function formatObject(label: string, obj: { id: string; created: boolean }): string {
  return `${label}: ${obj.created ? 'neu angelegt' : 'wiederverwendet'} (${obj.id})`;
}

function formatResult(result: BootstrapResult): string {
  const lines: string[] = [];

  lines.push('**Rollen**');
  lines.push(`- ${formatObject('Verifiziert', result.verifiedRole)}`);
  lines.push(`- ${formatObject('Admin', result.adminRole)}`);
  lines.push(`- ${formatObject('Moderator', result.moderatorRole)}`);
  for (const name of CLASS_NAMES) {
    lines.push(`- ${formatObject(`Klasse ${name}`, result.classes[name].role)}`);
  }

  lines.push('');
  lines.push('**Kanaele**');
  lines.push(`- ${formatObject('Verifizierung', result.verificationChannel)}`);
  lines.push(`- ${formatObject('#wo-bin-ich', result.whereAmIChannel)}`);
  lines.push(`- ${formatObject('Log', result.logChannel)}`);

  lines.push('');
  lines.push('**Private Klassenbereiche**');
  for (const name of CLASS_NAMES) {
    const area = result.classes[name].area;
    const summary = area.categoryCreated
      ? `Kategorie und ${area.channelsCreated.length} Kanaele neu angelegt`
      : area.channelsCreated.length > 0
        ? `${area.channelsCreated.length} fehlende Kanaele ergaenzt (${area.channelsSkipped.length} bereits vorhanden)`
        : 'bereits vollstaendig eingerichtet';
    lines.push(`- Klasse ${name}: ${summary}.`);
  }

  lines.push('');
  lines.push('**Verifizierungs-/Klassenauswahl-Nachrichten**');
  lines.push(
    `- Verifizierungsnachricht: ${result.verificationMessagePosted ? 'neu gepostet' : 'bereits vorhanden, nicht erneut gepostet'}.`,
  );
  lines.push(
    `- #wo-bin-ich-Nachricht: ${result.whereAmIMessagePosted ? 'neu gepostet' : 'bereits vorhanden, nicht erneut gepostet'}.`,
  );

  if (result.warnings.length > 0) {
    lines.push('');
    lines.push('**Hinweise**');
    for (const warning of result.warnings) {
      lines.push(`- ⚠️ ${warning}`);
    }
  } else {
    lines.push('');
    lines.push('✅ Keine Auffaelligkeiten - der Server ist bereit fuer den E2E-Test.');
  }

  return lines.join('\n');
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('setup-server')
    .setDescription(
      '🚀 Richtet einen leeren Server vollstaendig fuer den COMCAVE-Bot ein (nur Admins).',
    ),
  permissionLevel: PermissionLevel.ADMIN,
  async execute(interaction) {
    if (!interaction.guild) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await bootstrapServer(interaction.guild, interaction.user.id);

    await interaction.editReply({ content: formatResult(result) });
  },
};

export default command;
