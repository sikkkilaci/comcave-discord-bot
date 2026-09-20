import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import {
  ONBOARDING_QUESTION_CONFIG,
  type OnboardingQuestionKey,
} from '../../services/onboardingFlow.js';
import { getOnboardingState, type OnboardingState } from '../../services/onboardingService.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('ui:onboardingMessage');

/**
 * Ein Emoji je Frage, rein zur optischen Orientierung im Embed-Titel - bewusst
 * nur ein Symbol pro Frage (keine zusaetzlichen Emojis pro Auswahloption), um
 * die Select-Menus selbst uebersichtlich und professionell zu halten.
 */
const QUESTION_EMOJI: Record<OnboardingQuestionKey, string> = {
  IT_EXPERIENCE: '🧑‍💻',
  IT_SKILLS: '🖥️',
  IT_BACKGROUND: '💼',
  INTERESTS: '📚',
};

/** Prefix der Select-Menu-customId; das Suffix ist der jeweilige OnboardingQuestionKey. */
export const ONBOARDING_ANSWER_CUSTOM_ID_PREFIX = 'onboarding:answer:';
export const ONBOARDING_RESTART_CUSTOM_ID = 'onboarding:restart';

export function buildAnswerCustomId(question: OnboardingQuestionKey): string {
  return `${ONBOARDING_ANSWER_CUSTOM_ID_PREFIX}${question}`;
}

export function parseAnswerCustomId(customId: string): OnboardingQuestionKey | null {
  if (!customId.startsWith(ONBOARDING_ANSWER_CUSTOM_ID_PREFIX)) return null;
  const key = customId.slice(ONBOARDING_ANSWER_CUSTOM_ID_PREFIX.length);
  return key in ONBOARDING_QUESTION_CONFIG ? (key as OnboardingQuestionKey) : null;
}

export interface OnboardingMessagePayload {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[];
}

/** Baut die Frage-Nachricht (Embed + Select-Menu) fuer eine einzelne Onboarding-Frage. */
export function buildOnboardingStepMessage(
  question: OnboardingQuestionKey,
): OnboardingMessagePayload {
  const config = ONBOARDING_QUESTION_CONFIG[question];

  const embed = new EmbedBuilder()
    .setTitle(`${QUESTION_EMOJI[question]} Onboarding: ${config.title}`)
    .setDescription(config.description)
    .setColor(0x2b2d31)
    .setFooter({
      text: config.multiSelect
        ? 'Mehrfachauswahl moeglich - anschliessend geht es automatisch weiter.'
        : 'Bitte eine Option auswaehlen.',
    });

  const select = new StringSelectMenuBuilder()
    .setCustomId(buildAnswerCustomId(question))
    .setMinValues(config.minValues)
    .setMaxValues(config.maxValues)
    .setPlaceholder(config.multiSelect ? 'Optionen auswaehlen...' : 'Option auswaehlen...')
    .addOptions(
      config.options.map((value) => ({
        label: config.labels[value] ?? value,
        value,
      })),
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  return { embeds: [embed], components: [row] };
}

/** Baut die Abschluss-Zusammenfassung mit einem Button, um das Onboarding erneut auszufuellen. */
export function buildOnboardingSummaryMessage(
  answers: Partial<Record<OnboardingQuestionKey, string[]>>,
): OnboardingMessagePayload {
  const embed = new EmbedBuilder()
    .setTitle('Onboarding abgeschlossen 🎉')
    .setDescription('Danke fuer deine Antworten! Das hilft uns, dich passend einzuordnen.')
    .setColor(0x2b2d31);

  for (const [question, values] of Object.entries(answers) as [OnboardingQuestionKey, string[]][]) {
    const config = ONBOARDING_QUESTION_CONFIG[question];
    if (!config) continue;
    const displayValues = values.map((value) => config.labels[value] ?? value).join(', ');
    embed.addFields({ name: config.title, value: displayValues || '-', inline: false });
  }

  const restartButton = new ButtonBuilder()
    .setCustomId(ONBOARDING_RESTART_CUSTOM_ID)
    .setLabel('Onboarding erneut ausfuellen')
    .setEmoji('🔄')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(restartButton);

  return { embeds: [embed], components: [row] };
}

/** Rendert je nach Fortschritt entweder die naechste Frage oder die Abschluss-Zusammenfassung. */
export function buildOnboardingMessageForState(state: OnboardingState): OnboardingMessagePayload {
  if (state.nextQuestion) {
    return buildOnboardingStepMessage(state.nextQuestion);
  }
  return buildOnboardingSummaryMessage(state.answers);
}

/**
 * Laedt den Onboarding-Zustand und baut die passende Nachricht dafuer -
 * typischerweise um sie an eine Verifizierungsbestaetigung anzuhaengen. Ein
 * Fehler dabei (z. B. DB-Problem) wird geloggt und fuehrt zu einer leeren
 * Nutzlast statt den Aufrufer (der ggf. schon eine wichtigere Nachricht wie
 * die Verifizierungsbestaetigung senden will) scheitern zu lassen.
 */
export async function buildSafeOnboardingReplyPart(
  guildId: string,
  discordId: string,
): Promise<Partial<OnboardingMessagePayload>> {
  try {
    const state = await getOnboardingState(guildId, discordId);
    return buildOnboardingMessageForState(state);
  } catch (error) {
    logger.error({ err: error, guildId, discordId }, 'Konnte Onboarding-Zustand nicht laden');
    return {};
  }
}
