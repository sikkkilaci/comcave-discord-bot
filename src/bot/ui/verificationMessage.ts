import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

/** Custom-ID des Verifizierungs-Buttons, zentral definiert fuer Erstellung und Auswertung. */
export const VERIFY_BUTTON_CUSTOM_ID = 'verification:self-verify';

export interface VerificationPromptMessage {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}

/**
 * Baut die wiederverwendbare Verifizierungsnachricht (Embed + Button), die
 * sowohl per DM an neu beigetretene Mitglieder gesendet als auch dauerhaft
 * im konfigurierten Verifizierungs-Kanal gepostet wird.
 */
export function buildVerificationPrompt(): VerificationPromptMessage {
  const embed = new EmbedBuilder()
    .setTitle('Willkommen bei der COMCAVE-Lerngruppe!')
    .setDescription(
      'Um vollen Zugriff auf den Server zu erhalten, bestaetige bitte deine Verifizierung ' +
        'mit einem Klick auf den Button unten.',
    )
    .setColor(0x2b2d31);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(VERIFY_BUTTON_CUSTOM_ID)
      .setLabel('Ich bin verifiziert')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
  );

  return { embeds: [embed], components: [row] };
}
