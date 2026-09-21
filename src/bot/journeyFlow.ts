import type {
  ActionRowBuilder,
  ButtonBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { resolveNextJourneyStep } from '../services/memberJourneyService.js';
import { getOnboardingState } from '../services/onboardingService.js';
import { showRulesToMember } from '../services/ruleService.js';
import { buildOnboardingMessageForState } from './ui/onboardingMessage.js';
import { buildProfileDetailsPromptMessage } from './ui/profileMessage.js';
import { buildRulesMessage } from './ui/rulesMessage.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('journeyFlow');

export interface JourneyReplyPart {
  content?: string;
  embeds?: EmbedBuilder[];
  components?: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[];
}

/**
 * Ermittelt den naechsten offenen Schritt des Eintrittsflows
 * (Verifizierung -> persoenliche Angaben -> Standort -> Regelzustimmung ->
 * bestehendes Onboarding -> Klassenwahl, siehe memberJourneyService.ts) und
 * baut die passende Nachricht dafuer. Die EINZIGE Stelle, die nach einem
 * abgeschlossenen Teilschritt (Verify-Klick, Standortwahl, Regelzustimmung)
 * entscheidet, was als naechstes gezeigt wird - verhindert, dass die
 * Reihenfolge an mehreren Stellen dupliziert und dadurch inkonsistent wird.
 *
 * Ein Fehler dabei wird geloggt und fuehrt zu einer leeren Nutzlast statt den
 * Aufrufer (der ggf. schon eine wichtigere Nachricht wie eine Bestaetigung
 * senden will) scheitern zu lassen - gleiches Prinzip wie
 * buildSafeOnboardingReplyPart() zuvor.
 */
export async function buildSafeNextStepReplyPart(
  guildId: string,
  discordId: string,
): Promise<JourneyReplyPart> {
  try {
    const step = await resolveNextJourneyStep(guildId, discordId);

    switch (step) {
      case 'NEEDS_VERIFICATION':
        return { content: 'Bitte verifiziere dich zuerst (Button oder /verifizieren).' };
      case 'NEEDS_PROFILE_DETAILS':
        return buildProfileDetailsPromptMessage();
      case 'NEEDS_LOCATION':
        return {
          content: 'Bitte waehle jetzt deinen COMCAVE-Standort mit `/standort-waehlen` aus.',
        };
      case 'NEEDS_RULES_ACCEPTANCE': {
        const ruleSet = await showRulesToMember(guildId, discordId);
        return buildRulesMessage(ruleSet);
      }
      case 'NEEDS_ONBOARDING': {
        const state = await getOnboardingState(guildId, discordId);
        return buildOnboardingMessageForState(state);
      }
      case 'COMPLETE':
        return { content: 'Du hast alle Schritte abgeschlossen. Willkommen! 🎉' };
      default:
        return {};
    }
  } catch (error) {
    logger.error(
      { err: error, guildId, discordId },
      'Konnte naechsten Eintrittsschritt nicht ermitteln',
    );
    return {};
  }
}
