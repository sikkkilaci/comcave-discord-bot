import {
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
  type Interaction,
  type RepliableInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import type { BotEvent } from '../../types/event.js';
import type { BotClient } from '../../types/client.js';
import { getOrCreateGuildConfig } from '../../repositories/guildConfigRepository.js';
import { hasPermissionLevel } from '../../permissions/checkPermission.js';
import { setMemberVerification } from '../../services/verificationService.js';
import { assertMemberVerified, submitAnswer } from '../../services/onboardingService.js';
import { assignClass } from '../../services/classService.js';
import { VERIFY_BUTTON_CUSTOM_ID } from '../ui/verificationMessage.js';
import {
  ONBOARDING_RESTART_CUSTOM_ID,
  buildOnboardingMessageForState,
  buildOnboardingStepMessage,
  buildSafeOnboardingReplyPart,
  parseAnswerCustomId,
} from '../ui/onboardingMessage.js';
import { buildClassSelectionMessage, parseClassCustomId } from '../ui/classMessage.js';
import {
  buildCoursePlanOverviewMessage,
  parseCoursePlanAckCustomId,
} from '../ui/coursePlanMessage.js';
import {
  acknowledgeCourseEntryForMember,
  getCoursePlanOverviewForClass,
} from '../../services/coursePlanService.js';
import { findGuildMemberAcrossGuilds } from '../discordHelpers.js';
import { CLASS_NAME_LABELS, type ClassName } from '../../types/domain.js';
import { AppError } from '../../utils/errors.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('event:interactionCreate');

const event: BotEvent<'interactionCreate'> = {
  name: 'interactionCreate',
  async execute(interaction: Interaction) {
    if (interaction.isChatInputCommand()) {
      await handleChatInputCommand(interaction);
      return;
    }

    if (interaction.isButton()) {
      await handleButton(interaction);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      await handleSelectMenu(interaction);
    }
  },
};

async function handleChatInputCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: 'Dieser Bot kann nur innerhalb des COMCAVE-Servers verwendet werden.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const client = interaction.client as BotClient;
  const command = client.commands.get(interaction.commandName);

  if (!command) {
    logger.warn({ command: interaction.commandName }, 'Unbekannter Befehl aufgerufen');
    await interaction.reply({
      content: 'Dieser Befehl ist aktuell nicht verfuegbar.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    const guildConfig = await getOrCreateGuildConfig(interaction.guild.id);
    const member = interaction.member as GuildMember;
    const allowed = await hasPermissionLevel(member, guildConfig, command.permissionLevel);

    if (!allowed) {
      await interaction.reply({
        content: 'Du hast keine Berechtigung, diesen Befehl zu verwenden.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await command.execute(interaction);
  } catch (error) {
    await handleInteractionError(interaction, error);
  }
}

/**
 * Loest das GuildMember zu einer Button-/Select-Menu-Interaktion auf. Bei
 * einer Interaktion innerhalb eines Servers ist es direkt vorhanden; bei
 * einer Interaktion per DM (z. B. Klick auf den Verifizierungs-Button aus der
 * Beitritts-DM) fehlt der Guild-Kontext, daher wird ueber alle Server
 * gesucht, auf denen der Bot aktiv ist.
 */
async function resolveInteractionMember(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
): Promise<GuildMember | null> {
  if (interaction.inGuild()) return interaction.member as GuildMember;
  return findGuildMemberAcrossGuilds(interaction.client.guilds.cache.values(), interaction.user.id);
}

const NO_SHARED_GUILD_MESSAGE =
  'Ich konnte dich auf keinem Server finden, auf dem ich aktiv bin. ' +
  'Bitte versuche es im Server-Kanal erneut.';

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  if (interaction.customId === VERIFY_BUTTON_CUSTOM_ID) {
    await handleVerifyButton(interaction);
    return;
  }

  if (interaction.customId === ONBOARDING_RESTART_CUSTOM_ID) {
    await handleOnboardingRestart(interaction);
    return;
  }

  const className = parseClassCustomId(interaction.customId);
  if (className) {
    await handleClassSelect(interaction, className);
    return;
  }

  const ackCourseEntryId = parseCoursePlanAckCustomId(interaction.customId);
  if (ackCourseEntryId) {
    await handleCoursePlanAck(interaction, ackCourseEntryId);
  }
}

async function handleVerifyButton(interaction: ButtonInteraction): Promise<void> {
  try {
    const member = await resolveInteractionMember(interaction);
    if (!member) {
      await interaction.reply({ content: NO_SHARED_GUILD_MESSAGE, flags: MessageFlags.Ephemeral });
      return;
    }

    const guildConfig = await getOrCreateGuildConfig(member.guild.id);
    const result = await setMemberVerification(member, guildConfig, 'VERIFIED', member.id);

    const content = result.changed
      ? 'Du wurdest erfolgreich verifiziert! Willkommen in der Lerngruppe. 🎉'
      : 'Du bist bereits verifiziert.';

    const onboardingPart = await buildSafeOnboardingReplyPart(member.guild.id, member.id);

    await interaction.reply({ content, ...onboardingPart, flags: MessageFlags.Ephemeral });
  } catch (error) {
    await handleInteractionError(interaction, error);
  }
}

async function handleOnboardingRestart(interaction: ButtonInteraction): Promise<void> {
  try {
    const member = await resolveInteractionMember(interaction);
    if (!member) {
      await interaction.reply({ content: NO_SHARED_GUILD_MESSAGE, flags: MessageFlags.Ephemeral });
      return;
    }

    await assertMemberVerified(member.guild.id, member.id);
    const { embeds, components } = buildOnboardingStepMessage('IT_EXPERIENCE');
    await interaction.update({ embeds, components });
  } catch (error) {
    await handleInteractionError(interaction, error);
  }
}

/**
 * Verarbeitet einen Klick auf einen Klassen-Button. Unterscheidet, ob der
 * Klick von der dauerhaften, oeffentlichen #wo-bin-ich-Kanal-Nachricht kommt
 * (bleibt fuer alle unveraendert, nur eine private Bestaetigung) oder von der
 * persoenlichen, ephemeren /wo-bin-ich-Antwort (darf sicher aktualisiert
 * werden, da sie nur der klickende Nutzer sieht).
 */
async function handleClassSelect(
  interaction: ButtonInteraction,
  className: ClassName,
): Promise<void> {
  try {
    const member = await resolveInteractionMember(interaction);
    if (!member) {
      await interaction.reply({ content: NO_SHARED_GUILD_MESSAGE, flags: MessageFlags.Ephemeral });
      return;
    }

    const guildConfig = await getOrCreateGuildConfig(member.guild.id);
    const result = await assignClass(member, guildConfig, className, member.id);

    const content = result.changed
      ? result.previousClassName
        ? `Du wurdest von ${CLASS_NAME_LABELS[result.previousClassName]} zu ` +
          `${CLASS_NAME_LABELS[result.newClassName]} verschoben. 🎉`
        : `Du bist jetzt in ${CLASS_NAME_LABELS[result.newClassName]}! 🎉`
      : `Du bist bereits in ${CLASS_NAME_LABELS[result.newClassName]}.`;

    if (interaction.message.flags.has(MessageFlags.Ephemeral)) {
      const { embeds, components } = buildClassSelectionMessage(result.newClassName);
      await interaction.update({ embeds, components });
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    await handleInteractionError(interaction, error);
  }
}

/**
 * Verarbeitet einen Klick auf "Kenntnis genommen" unter /kursplan. Die
 * /kursplan-Antwort ist immer ephemer, daher kann die Nachricht sicher direkt
 * per interaction.update() aktualisiert werden (nur der klickende Nutzer sieht
 * sie). Berechtigung/Fail-closed-Pruefung liegt vollstaendig in
 * acknowledgeCourseEntryForMember() (assertClassReadAccess) - eine
 * manipulierte Kurs-ID aus der customId verschafft daher nie Zugriff auf eine
 * fremde Klasse.
 */
async function handleCoursePlanAck(
  interaction: ButtonInteraction,
  courseEntryId: string,
): Promise<void> {
  try {
    const member = await resolveInteractionMember(interaction);
    if (!member) {
      await interaction.reply({ content: NO_SHARED_GUILD_MESSAGE, flags: MessageFlags.Ephemeral });
      return;
    }

    const guildConfig = await getOrCreateGuildConfig(member.guild.id);
    const ackResult = await acknowledgeCourseEntryForMember(guildConfig, member, courseEntryId);
    const overview = await getCoursePlanOverviewForClass(guildConfig, member, ackResult.className);
    const { embeds, components } = buildCoursePlanOverviewMessage(overview);

    await interaction.update({ embeds, components });
  } catch (error) {
    await handleInteractionError(interaction, error);
  }
}

async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  const question = parseAnswerCustomId(interaction.customId);
  if (!question) return;

  try {
    const member = await resolveInteractionMember(interaction);
    if (!member) {
      await interaction.reply({ content: NO_SHARED_GUILD_MESSAGE, flags: MessageFlags.Ephemeral });
      return;
    }

    const state = await submitAnswer(member.guild.id, member.id, question, interaction.values);
    const { embeds, components } = buildOnboardingMessageForState(state);
    await interaction.update({ embeds, components });
  } catch (error) {
    await handleInteractionError(interaction, error);
  }
}

async function handleInteractionError(
  interaction: RepliableInteraction,
  error: unknown,
): Promise<void> {
  const isKnownError = error instanceof AppError;

  logger.error(
    { err: error, user: interaction.user.id },
    'Fehler bei der Verarbeitung einer Interaktion',
  );

  const message = isKnownError
    ? error.message
    : 'Bei der Verarbeitung ist ein unerwarteter Fehler aufgetreten.';

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
  } catch (replyError) {
    logger.error({ err: replyError }, 'Konnte Fehlermeldung nicht an Nutzer senden');
  }
}

export default event;
