import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import type { RuleSet } from '@prisma/client';

export const RULES_ACCEPT_BUTTON_CUSTOM_ID = 'rules:accept';

export interface RulesMessagePayload {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}

/**
 * Baut die Regelwerk-Anzeige. Mit Zustimmungs-Button, ausser `alreadyAccepted`
 * ist gesetzt (z. B. fuer /regeln, wenn ein Mitglied die aktuelle Version
 * bereits akzeptiert hat und die Anzeige rein informativ ist).
 */
export function buildRulesMessage(ruleSet: RuleSet, alreadyAccepted = false): RulesMessagePayload {
  const embed = new EmbedBuilder()
    .setTitle(`📜 Serverregeln (Version ${ruleSet.version})`)
    .setDescription(ruleSet.content)
    .setColor(0x2b2d31)
    .setFooter({
      text: alreadyAccepted
        ? 'Du hast dieser Version bereits zugestimmt.'
        : 'Bitte lies die Regeln und bestaetige deine Zustimmung.',
    });

  if (alreadyAccepted) {
    return { embeds: [embed], components: [] };
  }

  const button = new ButtonBuilder()
    .setCustomId(RULES_ACCEPT_BUTTON_CUSTOM_ID)
    .setLabel('Ich stimme den Regeln zu')
    .setEmoji('✅')
    .setStyle(ButtonStyle.Success);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)],
  };
}

export function buildRulesAcceptedConfirmationMessage(ruleSet: RuleSet): RulesMessagePayload {
  const embed = new EmbedBuilder()
    .setTitle('✅ Regeln akzeptiert')
    .setDescription(`Danke! Du hast Version ${ruleSet.version} der Serverregeln zugestimmt.`)
    .setColor(0x2b2d31);

  return { embeds: [embed], components: [] };
}
