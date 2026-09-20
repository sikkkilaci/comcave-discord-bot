import type { GuildMember } from 'discord.js';
import type { BotEvent } from '../../types/event.js';
import { ensureMemberTracked } from '../../services/verificationService.js';
import { buildVerificationPrompt } from '../ui/verificationMessage.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('event:guildMemberAdd');

const event: BotEvent<'guildMemberAdd'> = {
  name: 'guildMemberAdd',
  async execute(member: GuildMember) {
    try {
      await ensureMemberTracked(member.guild.id, member.id);
    } catch (error) {
      logger.error(
        { err: error, member: member.id, guild: member.guild.id },
        'Konnte neues Mitglied nicht in der Datenbank anlegen',
      );
    }

    try {
      await member.send(buildVerificationPrompt());
    } catch {
      logger.info(
        { member: member.id, guild: member.guild.id },
        'Konnte keine Verifizierungs-DM senden (DMs vermutlich deaktiviert); ' +
          'Verifizierung bleibt ueber den Server-Kanal bzw. /verifizieren moeglich.',
      );
    }
  },
};

export default event;
