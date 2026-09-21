import {
  MessageFlags,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
  type Interaction,
  type ModalSubmitInteraction,
  type RepliableInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import type { BotEvent } from '../../types/event.js';
import type { BotClient } from '../../types/client.js';
import { getOrCreateGuildConfig } from '../../repositories/guildConfigRepository.js';
import { hasPermissionLevel } from '../../permissions/checkPermission.js';
import { assertMemberVerified, setMemberVerification } from '../../services/verificationService.js';
import { submitAnswer } from '../../services/onboardingService.js';
import {
  assignClass,
  assertClassChosen,
  getConfirmedClassOverview,
  getCurrentClassName,
  requestClassHelp,
} from '../../services/classService.js';
import {
  assertFachrichtungChosen,
  chooseFachrichtung,
} from '../../services/fachrichtungService.js';
import {
  assertProfileComplete,
  completeProfileAndSetNickname,
  selectLocation,
  submitPersonalDetails,
} from '../../services/memberProfileService.js';
import { acceptCurrentRules } from '../../services/ruleService.js';
import { grantOnboardedRoleIfComplete } from '../../services/memberJourneyService.js';
import { searchActiveLocations } from '../../repositories/locationRepository.js';
import { buildSafeNextStepReplyPart } from '../journeyFlow.js';
import { VERIFY_BUTTON_CUSTOM_ID } from '../ui/verificationMessage.js';
import {
  ONBOARDING_RESTART_CUSTOM_ID,
  buildOnboardingMessageForState,
  buildOnboardingStepMessage,
  parseAnswerCustomId,
} from '../ui/onboardingMessage.js';
import {
  PROFILE_DETAILS_BUTTON_CUSTOM_ID,
  PROFILE_DETAILS_INPUT_IDS,
  PROFILE_DETAILS_MODAL_CUSTOM_ID,
  buildProfileDetailsModal,
  buildProfileDetailsSavedMessage,
} from '../ui/profileMessage.js';
import {
  LOCATION_SEARCH_BUTTON_CUSTOM_ID,
  LOCATION_SEARCH_INPUT_ID,
  LOCATION_SEARCH_MODAL_CUSTOM_ID,
  LOCATION_SELECT_CUSTOM_ID,
  MAX_LOCATION_CHOICES,
  buildLocationChoicesMessage,
  buildLocationSearchModal,
  buildNoLocationMatchesMessage,
  buildTooManyLocationMatchesMessage,
} from '../ui/locationMessage.js';
import { parseFachrichtungCustomId } from '../ui/fachrichtungMessage.js';
import { RULES_ACCEPT_BUTTON_CUSTOM_ID } from '../ui/rulesMessage.js';
import {
  CLASS_BACK_CUSTOM_ID,
  CLASS_HELP_CUSTOM_ID,
  buildClassConfirmMessage,
  buildClassHelpRequestedMessage,
  buildClassSelectionMessage,
  parseClassConfirmCustomId,
  parseClassCustomId,
} from '../ui/classMessage.js';
import {
  buildCoursePlanOverviewMessage,
  parseCoursePlanAckCustomId,
} from '../ui/coursePlanMessage.js';
import {
  acknowledgeCourseEntryForMember,
  getCoursePlanOverviewForClass,
} from '../../services/coursePlanService.js';
import { findGuildMemberAcrossGuilds } from '../discordHelpers.js';
import { CLASS_NAME_LABELS, type ClassName, type Fachrichtung } from '../../types/domain.js';
import { AppError, ValidationError } from '../../utils/errors.js';
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
      return;
    }

    if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction);
      return;
    }

    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction);
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
  interaction: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction,
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

  const tentativeClassName = parseClassCustomId(interaction.customId);
  if (tentativeClassName) {
    await handleClassTentativeSelect(interaction, tentativeClassName);
    return;
  }

  const confirmClassName = parseClassConfirmCustomId(interaction.customId);
  if (confirmClassName) {
    await handleClassConfirm(interaction, confirmClassName);
    return;
  }

  if (interaction.customId === CLASS_BACK_CUSTOM_ID) {
    await handleClassBack(interaction);
    return;
  }

  if (interaction.customId === CLASS_HELP_CUSTOM_ID) {
    await handleClassHelpRequest(interaction);
    return;
  }

  if (interaction.customId === PROFILE_DETAILS_BUTTON_CUSTOM_ID) {
    await handleProfileDetailsButton(interaction);
    return;
  }

  if (interaction.customId === LOCATION_SEARCH_BUTTON_CUSTOM_ID) {
    await handleLocationSearchButton(interaction);
    return;
  }

  const fachrichtung = parseFachrichtungCustomId(interaction.customId);
  if (fachrichtung) {
    await handleFachrichtungSelect(interaction, fachrichtung);
    return;
  }

  if (interaction.customId === RULES_ACCEPT_BUTTON_CUSTOM_ID) {
    await handleRulesAcceptButton(interaction);
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

    const verifyContent = result.changed
      ? 'Du wurdest erfolgreich verifiziert! Willkommen in der Lerngruppe. 🎉'
      : 'Du bist bereits verifiziert.';

    const nextPart = await buildSafeNextStepReplyPart(member.guild.id, member.id);
    const content = [verifyContent, nextPart.content].filter(Boolean).join('\n\n');

    await interaction.reply({
      content,
      embeds: nextPart.embeds ?? [],
      components: nextPart.components ?? [],
      flags: MessageFlags.Ephemeral,
    });
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
    await assertProfileComplete(member.guild.id, member.id);
    await assertFachrichtungChosen(member.guild.id, member.id);
    await assertClassChosen(member.guild.id, member.id);
    const { embeds, components } = buildOnboardingStepMessage('IT_EXPERIENCE');
    await interaction.update({ embeds, components });
  } catch (error) {
    await handleInteractionError(interaction, error);
  }
}

/** Oeffnet das Pflichtangaben-Modal (Vorname/Nachname/Alter). Discord erlaubt showModal() nur als Erstantwort. */
async function handleProfileDetailsButton(interaction: ButtonInteraction): Promise<void> {
  try {
    await interaction.showModal(buildProfileDetailsModal());
  } catch (error) {
    await handleInteractionError(interaction, error);
  }
}

/** Oeffnet das Standort-Suchmodal (siehe locationMessage.ts). */
async function handleLocationSearchButton(interaction: ButtonInteraction): Promise<void> {
  try {
    await interaction.showModal(buildLocationSearchModal());
  } catch (error) {
    await handleInteractionError(interaction, error);
  }
}

/**
 * Verarbeitet den Klick auf einen Fachrichtungs-Button. Fachrichtung ist
 * (anders als die Klasse) ein reiner Eintrittsflow-Schritt ohne Discord-
 * Rolle - nach erfolgreicher Wahl wird direkt der naechste Schritt
 * (Klassenwahl) angehaengt, damit der Flow ohne weiteren Klick auf eine
 * andere Nachricht weiterlaeuft.
 */
async function handleFachrichtungSelect(
  interaction: ButtonInteraction,
  fachrichtung: Fachrichtung,
): Promise<void> {
  try {
    const member = await resolveInteractionMember(interaction);
    if (!member) {
      await interaction.reply({ content: NO_SHARED_GUILD_MESSAGE, flags: MessageFlags.Ephemeral });
      return;
    }

    await chooseFachrichtung(member.guild.id, member.id, fachrichtung, member.id);

    const nextPart = await buildSafeNextStepReplyPart(member.guild.id, member.id);
    await interaction.reply({
      ...(nextPart.content ? { content: nextPart.content } : {}),
      embeds: nextPart.embeds ?? [],
      components: nextPart.components ?? [],
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    await handleInteractionError(interaction, error);
  }
}

async function handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  if (interaction.customId === PROFILE_DETAILS_MODAL_CUSTOM_ID) {
    await handleProfileDetailsModalSubmit(interaction);
    return;
  }
  if (interaction.customId === LOCATION_SEARCH_MODAL_CUSTOM_ID) {
    await handleLocationSearchModalSubmit(interaction);
  }
}

/**
 * Verarbeitet den abgesendeten Standort-Suchbegriff: bei genau einem Treffer
 * wird der Standort direkt uebernommen und das Profil abgeschlossen (wie
 * bisher bei /standort-waehlen), bei mehreren Treffern eine Auswahlliste
 * gezeigt (siehe handleLocationSelect()), bei keinem/zu vielen Treffern ein
 * Hinweis, den Suchbegriff anzupassen.
 */
async function handleLocationSearchModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  try {
    const member = await resolveInteractionMember(interaction);
    if (!member) {
      await interaction.reply({ content: NO_SHARED_GUILD_MESSAGE, flags: MessageFlags.Ephemeral });
      return;
    }

    const query = interaction.fields.getTextInputValue(LOCATION_SEARCH_INPUT_ID);
    const matches = await searchActiveLocations(query, MAX_LOCATION_CHOICES + 1);

    if (matches.length === 0) {
      const { embeds, components } = buildNoLocationMatchesMessage(query);
      await interaction.reply({ embeds, components, flags: MessageFlags.Ephemeral });
      return;
    }

    if (matches.length > MAX_LOCATION_CHOICES) {
      const { embeds, components } = buildTooManyLocationMatchesMessage(query, matches.length);
      await interaction.reply({ embeds, components, flags: MessageFlags.Ephemeral });
      return;
    }

    if (matches.length > 1) {
      const { embeds, components } = buildLocationChoicesMessage(matches);
      await interaction.reply({ embeds, components, flags: MessageFlags.Ephemeral });
      return;
    }

    await applyLocationAndReply(interaction, member, matches[0]!.id);
  } catch (error) {
    await handleInteractionError(interaction, error);
  }
}

/** Gemeinsame Uebernahme-Logik fuer den Standort - bei genau einem Treffer und beim Klick aus der Auswahlliste. */
async function applyLocationAndReply(
  interaction: ModalSubmitInteraction | StringSelectMenuInteraction,
  member: GuildMember,
  locationId: string,
): Promise<void> {
  const guildConfig = await getOrCreateGuildConfig(member.guild.id);
  await selectLocation(guildConfig, member, locationId, member.id);
  const completion = await completeProfileAndSetNickname(guildConfig, member, member.id);

  const prefix = completion.nicknameSkipped
    ? '✅ Standort gespeichert. Dein Server-Nickname konnte nicht automatisch gesetzt werden ' +
      '(fehlende Berechtigung) - bitte wende dich an einen Admin.'
    : `✅ Standort gespeichert. Dein Server-Nickname wurde auf "${completion.nickname}" gesetzt.`;

  const nextPart = await buildSafeNextStepReplyPart(member.guild.id, member.id);
  await interaction.reply({
    content: [prefix, nextPart.content].filter(Boolean).join('\n\n'),
    embeds: nextPart.embeds ?? [],
    components: nextPart.components ?? [],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleProfileDetailsModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  try {
    const member = await resolveInteractionMember(interaction);
    if (!member) {
      await interaction.reply({ content: NO_SHARED_GUILD_MESSAGE, flags: MessageFlags.Ephemeral });
      return;
    }

    const vorname = interaction.fields.getTextInputValue(PROFILE_DETAILS_INPUT_IDS.vorname);
    const nachname = interaction.fields.getTextInputValue(PROFILE_DETAILS_INPUT_IDS.nachname);
    const alterRaw = interaction.fields.getTextInputValue(PROFILE_DETAILS_INPUT_IDS.alter);
    const alter = Number.parseInt(alterRaw.trim(), 10);
    if (!Number.isFinite(alter)) {
      throw new ValidationError('Alter: muss eine ganze Zahl sein.');
    }

    const guildConfig = await getOrCreateGuildConfig(member.guild.id);
    await submitPersonalDetails(guildConfig, member, { vorname, nachname, alter }, member.id);

    const { embeds, components } = buildProfileDetailsSavedMessage();
    await interaction.reply({ embeds, components, flags: MessageFlags.Ephemeral });
  } catch (error) {
    await handleInteractionError(interaction, error);
  }
}

/**
 * Verarbeitet den Klick auf "Ich stimme den Regeln zu". Die zu bestaetigende
 * Version wird immer serverseitig aufgeloest (acceptCurrentRules() ->
 * getActiveRuleSet()), nie aus der customId - ein Klick auf eine veraltete
 * Regel-Nachricht bestaetigt daher immer die AKTUELLE Version, nie eine
 * bereits abgeloeste.
 */
async function handleRulesAcceptButton(interaction: ButtonInteraction): Promise<void> {
  try {
    const member = await resolveInteractionMember(interaction);
    if (!member) {
      await interaction.reply({ content: NO_SHARED_GUILD_MESSAGE, flags: MessageFlags.Ephemeral });
      return;
    }

    const guildConfig = await getOrCreateGuildConfig(member.guild.id);
    await acceptCurrentRules(guildConfig, member, member.id);
    // Regelzustimmung ist der letzte Schritt des Eintrittsflows (siehe
    // memberJourneyService.ts) - hier und nur hier wird geprueft, ob damit der
    // gesamte Flow abgeschlossen ist und die Mitglied-Rolle vergeben werden kann.
    await grantOnboardedRoleIfComplete(member, guildConfig, member.id);

    const nextPart = await buildSafeNextStepReplyPart(member.guild.id, member.id);
    await interaction.update({
      content: nextPart.content ?? null,
      embeds: nextPart.embeds ?? [],
      components: nextPart.components ?? [],
    });
  } catch (error) {
    await handleInteractionError(interaction, error);
  }
}

async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const client = interaction.client as BotClient;
  const command = client.commands.get(interaction.commandName);

  if (!command?.autocomplete) return;

  try {
    await command.autocomplete(interaction);
  } catch (error) {
    logger.error(
      { err: error, command: interaction.commandName, user: interaction.user.id },
      'Autocomplete-Anfrage fehlgeschlagen',
    );
  }
}

/**
 * Verarbeitet den (noch unverbindlichen) Klick auf eine Klasse in der
 * Uebersicht. Persistiert NICHTS - zeigt entweder direkt den bereits
 * bekannten Status (schon zugeordnet) oder den Bestaetigungs-Screen
 * (buildClassConfirmMessage()). Unterscheidet wie zuvor, ob der Klick von
 * der dauerhaften, oeffentlichen #wo-bin-ich-Kanal-Nachricht kommt (dann
 * eine neue private Antwort) oder von einer bereits ephemeren Nachricht
 * (dann sicher per interaction.update() ersetzbar, da nur der klickende
 * Nutzer sie sieht).
 */
async function handleClassTentativeSelect(
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
    const currentClassName = await getCurrentClassName(member.guild.id, member.id);

    if (currentClassName) {
      const content =
        currentClassName === className
          ? `Du bist bereits in ${CLASS_NAME_LABELS[currentClassName]}.`
          : `Deine Klasse ist bereits auf ${CLASS_NAME_LABELS[currentClassName]} festgelegt und ` +
            'kann nicht selbst gewechselt werden. Bitte wende dich an deine Klassenleitung ' +
            'oder die Verwaltung.';

      if (interaction.message.flags.has(MessageFlags.Ephemeral)) {
        await interaction.update({ content, embeds: [], components: [] });
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      }
      return;
    }

    const overview = await getConfirmedClassOverview(guildConfig.id);
    const { embeds, components } = buildClassConfirmMessage(className, overview[className]);

    if (interaction.message.flags.has(MessageFlags.Ephemeral)) {
      await interaction.update({ embeds, components });
    } else {
      await interaction.reply({ embeds, components, flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    await handleInteractionError(interaction, error);
  }
}

/**
 * Verarbeitet die ausdrueckliche Bestaetigung ("Ja, das ist meine Klasse") -
 * erst hier wird tatsaechlich assignClass() aufgerufen und damit die
 * Zuordnung persistiert. Der Bestaetigungs-Screen ist immer eine ephemere
 * Nachricht (siehe handleClassTentativeSelect()), daher hier immer sicher
 * per interaction.update() aktualisierbar.
 */
async function handleClassConfirm(
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
      ? `Du bist jetzt in ${CLASS_NAME_LABELS[result.newClassName]}! 🎉`
      : `Du bist bereits in ${CLASS_NAME_LABELS[result.newClassName]}.`;

    const nextPart = result.changed
      ? await buildSafeNextStepReplyPart(member.guild.id, member.id)
      : null;
    const fullContent = [content, nextPart?.content].filter(Boolean).join('\n\n');

    await interaction.update({
      content: fullContent,
      embeds: nextPart?.embeds ?? [],
      components: nextPart?.components ?? [],
    });
  } catch (error) {
    await handleInteractionError(interaction, error);
  }
}

/**
 * "Zurueck zur Klassenauswahl" auf dem Bestaetigungs-Screen - verwirft die
 * (nie persistierte) Auswahl und zeigt wieder die volle Uebersicht.
 */
async function handleClassBack(interaction: ButtonInteraction): Promise<void> {
  try {
    const member = await resolveInteractionMember(interaction);
    if (!member) {
      await interaction.reply({ content: NO_SHARED_GUILD_MESSAGE, flags: MessageFlags.Ephemeral });
      return;
    }

    const guildConfig = await getOrCreateGuildConfig(member.guild.id);
    const currentClassName = await getCurrentClassName(member.guild.id, member.id);
    const overview = await getConfirmedClassOverview(guildConfig.id);
    const { embeds, components } = buildClassSelectionMessage(overview, currentClassName);

    await interaction.update({ content: null, embeds, components });
  } catch (error) {
    await handleInteractionError(interaction, error);
  }
}

/**
 * "Klasse nicht erkannt / Hilfe" - meldet die Anfrage (siehe
 * classService.requestClassHelp()), ohne dass dabei irgendeine
 * Klassenzuordnung erzwungen wird.
 */
async function handleClassHelpRequest(interaction: ButtonInteraction): Promise<void> {
  try {
    const member = await resolveInteractionMember(interaction);
    if (!member) {
      await interaction.reply({ content: NO_SHARED_GUILD_MESSAGE, flags: MessageFlags.Ephemeral });
      return;
    }

    const guildConfig = await getOrCreateGuildConfig(member.guild.id);
    await requestClassHelp(guildConfig, member, member.id);

    const { embeds, components } = buildClassHelpRequestedMessage();

    if (interaction.message.flags.has(MessageFlags.Ephemeral)) {
      await interaction.update({ content: null, embeds, components });
    } else {
      await interaction.reply({ embeds, components, flags: MessageFlags.Ephemeral });
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
  if (interaction.customId === LOCATION_SELECT_CUSTOM_ID) {
    await handleLocationSelect(interaction);
    return;
  }

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

/** Klick auf einen Standort aus der Auswahlliste (siehe handleLocationSearchModalSubmit()). */
async function handleLocationSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  try {
    const member = await resolveInteractionMember(interaction);
    if (!member) {
      await interaction.reply({ content: NO_SHARED_GUILD_MESSAGE, flags: MessageFlags.Ephemeral });
      return;
    }

    await applyLocationAndReply(interaction, member, interaction.values[0]!);
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
