import {
  ChannelType,
  PermissionFlagsBits,
  type CategoryChannel,
  type Guild,
  type GuildBasedChannel,
  type OverwriteResolvable,
} from 'discord.js';
import type { GuildConfig } from '@prisma/client';
import { ValidationError } from '../utils/errors.js';

export interface GlobalServerStructureResult {
  categoriesCreated: string[];
  channelsCreated: string[];
  channelsReused: string[];
}

type Access = 'PUBLIC' | 'VERIFIED' | 'STAFF';

interface ChannelBlueprint {
  name: string;
  type: ChannelType.GuildText | ChannelType.GuildVoice;
  access: Access;
  readOnly?: boolean;
  topic?: string;
}

interface CategoryBlueprint {
  name: string;
  access: Access;
  channels: readonly ChannelBlueprint[];
}

const STRUCTURE: readonly CategoryBlueprint[] = [
  {
    // Bewusst der EINZIGE Kanal, den ein neu beigetretenes, noch nicht
    // vollstaendig onboardetes Mitglied sehen kann (siehe
    // memberJourneyService.ts/grantOnboardedRoleIfComplete()): der komplette
    // Eintrittsflow (Verifizierung -> Profil -> Standort -> Fachrichtung ->
    // Klasse -> Onboarding -> Regelwerk) laeuft hier bzw. per DM ab. Die
    // uebrigen frueher hier oeffentlichen Kanaele (willkommen/regeln/
    // onboarding/wo-bin-ich) sind jetzt VERIFIED-Kanaele - rein informativ/
    // zum spaeteren Nachschlagen, nicht mehr Teil des oeffentlichen
    // Erstkontakts.
    name: '01 · START',
    access: 'PUBLIC',
    channels: [
      {
        name: '👋-willkommen',
        type: ChannelType.GuildText,
        access: 'VERIFIED',
        readOnly: true,
        topic: 'Startpunkt der COMCAVE-Plattform.',
      },
      {
        name: '🔐-verifizierung',
        type: ChannelType.GuildText,
        access: 'PUBLIC',
        readOnly: true,
        topic: 'Verifizierung für den Zugang zur Plattform.',
      },
      {
        name: '📜-regeln',
        type: ChannelType.GuildText,
        access: 'VERIFIED',
        readOnly: true,
        topic: 'Aktuelles Serverregelwerk.',
      },
      {
        name: '🧑‍💻-onboarding',
        type: ChannelType.GuildText,
        access: 'VERIFIED',
        readOnly: true,
        topic: 'Persönliches Onboarding über den Bot.',
      },
      {
        name: '🧭-wo-bin-ich',
        type: ChannelType.GuildText,
        access: 'VERIFIED',
        readOnly: true,
        topic: 'Klasse auswählen und Klassenbereich öffnen.',
      },
    ],
  },
  {
    name: '02 · ZENTRALE',
    access: 'VERIFIED',
    channels: [
      {
        name: '📢-ankündigungen',
        type: ChannelType.GuildText,
        access: 'VERIFIED',
        readOnly: true,
        topic: 'Zentrale Ankündigungen und wichtige Änderungen.',
      },
      {
        name: '📌-wichtige-informationen',
        type: ChannelType.GuildText,
        access: 'VERIFIED',
        readOnly: true,
        topic: 'Dauerhaft relevante Informationen zur Umschulung.',
      },
      {
        name: '📅-termine',
        type: ChannelType.GuildText,
        access: 'VERIFIED',
        readOnly: true,
        topic: 'Zentrale Termine und Fristen.',
      },
      {
        name: '🗓️-ausbildungsplan',
        type: ChannelType.GuildText,
        access: 'VERIFIED',
        readOnly: true,
        topic: 'Ausbildungsplan, aktueller Kurs und kommende Inhalte.',
      },
      {
        name: '🧭-heute',
        type: ChannelType.GuildText,
        access: 'VERIFIED',
        readOnly: true,
        topic: 'Tagesübersicht und relevante Hinweise.',
      },
    ],
  },
  {
    name: '03 · LERNEN',
    access: 'VERIFIED',
    channels: [
      {
        name: '🎛️-lern-cockpit',
        type: ChannelType.GuildText,
        access: 'VERIFIED',
        readOnly: true,
        topic: 'Persönlicher Lernstatus und nächste sinnvolle Schritte.',
      },
      {
        name: '📚-kursinhalte',
        type: ChannelType.GuildText,
        access: 'VERIFIED',
        readOnly: true,
        topic: 'Strukturierte Inhalte der COMCAVE-Kurse.',
      },
      {
        name: '📖-lernmaterial',
        type: ChannelType.GuildText,
        access: 'VERIFIED',
        readOnly: true,
        topic: 'Kuratiertes Lernmaterial.',
      },
      {
        name: '❓-fragen-und-antworten',
        type: ChannelType.GuildText,
        access: 'VERIFIED',
        topic: 'Fachliche Fragen, Antworten und Erklärungen.',
      },
      {
        name: '🧪-selbsttests',
        type: ChannelType.GuildText,
        access: 'VERIFIED',
        readOnly: true,
        topic: 'Eigene Selbsttests und Testergebnisse.',
      },
      {
        name: '📈-lernfortschritt',
        type: ChannelType.GuildText,
        access: 'VERIFIED',
        readOnly: true,
        topic: 'Persönlicher Lernfortschritt und erkannte Lernfelder.',
      },
    ],
  },
  {
    name: '04 · PRÜFUNG',
    access: 'VERIFIED',
    channels: [
      {
        name: '🎓-prüfungs-cockpit',
        type: ChannelType.GuildText,
        access: 'VERIFIED',
        readOnly: true,
        topic: 'Prüfungsübersicht, Fristen und Lernschwerpunkte.',
      },
      {
        name: '📝-prüfungen',
        type: ChannelType.GuildText,
        access: 'VERIFIED',
        readOnly: true,
        topic: 'Anstehende Prüfungen und Prüfungstermine.',
      },
      {
        name: '🎯-prüfungsvorbereitung',
        type: ChannelType.GuildText,
        access: 'VERIFIED',
        topic: 'Gemeinsame Prüfungsvorbereitung.',
      },
      {
        name: '🔎-prüfungsfragen',
        type: ChannelType.GuildText,
        access: 'VERIFIED',
        topic: 'Fragen und Diskussionen rund um Prüfungsthemen.',
      },
    ],
  },
  {
    name: '05 · ZUSAMMENARBEIT',
    access: 'VERIFIED',
    channels: [
      {
        name: '👥-lerngruppen',
        type: ChannelType.GuildText,
        access: 'VERIFIED',
        topic: 'Lerngruppen bilden und gemeinsam arbeiten.',
      },
      {
        name: '🆘-hilfe-gesucht',
        type: ChannelType.GuildText,
        access: 'VERIFIED',
        topic: 'Konkrete Hilfe bei Aufgaben und Problemen suchen.',
      },
      {
        name: '🛠️-projekte',
        type: ChannelType.GuildText,
        access: 'VERIFIED',
        topic: 'Gemeinsame IT-Projekte und praktische Arbeiten.',
      },
      {
        name: '💬-austausch',
        type: ChannelType.GuildText,
        access: 'VERIFIED',
        topic: 'Offener Austausch innerhalb der Umschulungsgruppe.',
      },
    ],
  },
  {
    name: '06 · ORGANISATION',
    access: 'VERIFIED',
    channels: [
      {
        name: '📝-berichtsheft',
        type: ChannelType.GuildText,
        access: 'VERIFIED',
        topic: 'Berichtsheft, Tagesberichte und Wochenberichte.',
      },
      {
        name: '📋-organisation',
        type: ChannelType.GuildText,
        access: 'VERIFIED',
        topic: 'Organisatorische Fragen und gegenseitige Unterstützung.',
      },
    ],
  },
  {
    name: '07 · LERNRÄUME',
    access: 'VERIFIED',
    channels: [
      { name: '🔊-lernlounge', type: ChannelType.GuildVoice, access: 'VERIFIED' },
      { name: '🔊-prüfungsvorbereitung', type: ChannelType.GuildVoice, access: 'VERIFIED' },
    ],
  },
  {
    name: '08 · INTERN',
    access: 'STAFF',
    channels: [
      {
        name: '📋-bot-log',
        type: ChannelType.GuildText,
        access: 'STAFF',
        readOnly: true,
        topic: 'Technische Bot- und Audit-Ausgaben.',
      },
      {
        name: '🛡️-moderation',
        type: ChannelType.GuildText,
        access: 'STAFF',
        topic: 'Interne Moderation und Fallbearbeitung.',
      },
      {
        name: '⚙️-verwaltung',
        type: ChannelType.GuildText,
        access: 'STAFF',
        topic: 'Interne Serververwaltung.',
      },
    ],
  },
];

/**
 * Namen aller Kanaele mit Access-Stufe 'PUBLIC' (also fuer @everyone sichtbar,
 * auch ohne die onboardedRoleId-Rolle) - nur fuer Tests exportiert, die
 * absichern sollen, dass ein neues, noch nicht vollstaendig onboardetes
 * Mitglied ausschliesslich den Verifizierungskanal sieht (siehe
 * memberJourneyService.ts/grantOnboardedRoleIfComplete()).
 */
export function getPublicChannelNames(): string[] {
  return STRUCTURE.flatMap((category) =>
    category.channels
      .filter((channel) => channel.access === 'PUBLIC')
      .map((channel) => channel.name),
  );
}

export async function ensureGlobalServerStructure(
  guild: Guild,
  guildConfig: GuildConfig,
  reservedChannelIds: Readonly<Record<string, string>> = {},
): Promise<GlobalServerStructureResult> {
  const result: GlobalServerStructureResult = {
    categoriesCreated: [],
    channelsCreated: [],
    channelsReused: [],
  };

  // Schaltet die Kanaele der Zugriffsstufe 'VERIFIED' frei - trotz des Namens NICHT
  // guildConfig.verifiedRoleId, sondern die erst nach dem GESAMTEN Eintrittsflow vergebene
  // onboardedRoleId (siehe memberJourneyService.ts). Ein Mitglied, das sich nur verifiziert,
  // aber den Rest des Flows noch nicht abgeschlossen hat, soll ausser dem oeffentlichen
  // Verifizierungskanal weiterhin nichts sehen.
  const onboardedRoleId = guildConfig.onboardedRoleId;
  const adminRoleId = guildConfig.adminRoleId;
  const moderatorRoleId = guildConfig.moderatorRoleId;
  const botMember = guild.members.me;
  const botRoleId = botMember?.roles.highest.id;
  if (!botRoleId) {
    throw new ValidationError('Die Bot-Rolle konnte für den Serveraufbau nicht ermittelt werden.');
  }

  if (!onboardedRoleId || !adminRoleId || !moderatorRoleId) {
    throw new ValidationError('Die Grundrollen müssen vor dem Serveraufbau konfiguriert sein.');
  }

  for (const categoryBlueprint of STRUCTURE) {
    let category: CategoryChannel | undefined = guild.channels.cache.find(
      (channel): channel is CategoryChannel =>
        channel.type === ChannelType.GuildCategory && channel.name === categoryBlueprint.name,
    );

    if (!category) {
      category = await guild.channels.create({
        name: categoryBlueprint.name,
        type: ChannelType.GuildCategory,
        permissionOverwrites: buildOverwrites(
          guild,
          categoryBlueprint.access,
          onboardedRoleId,
          adminRoleId,
          moderatorRoleId,
          botRoleId,
          false,
        ),
        reason: 'COMCAVE-Plattform: globale Serverstruktur',
      });
      result.categoriesCreated.push(categoryBlueprint.name);
    } else {
      await category.permissionOverwrites.set(
        buildOverwrites(
          guild,
          categoryBlueprint.access,
          onboardedRoleId,
          adminRoleId,
          moderatorRoleId,
          botRoleId,
          false,
        ),
        'COMCAVE-Plattform: globale Kategorie-Berechtigungen',
      );
    }

    for (const blueprint of categoryBlueprint.channels) {
      const reservedId = reservedChannelIds[blueprint.name];
      if (reservedId) {
        const reserved = await guild.channels.fetch(reservedId);
        if (
          reserved &&
          reserved.type === blueprint.type &&
          'setParent' in reserved &&
          'permissionOverwrites' in reserved
        ) {
          // Reihenfolge ist wichtig: ein bereits bestehender reservierter Kanal (z. B. der
          // Log-Kanal, dessen @everyone-Deny den Bot ohne eigenen Allow-Overwrite fuer
          // diesen Kanal "blind" macht) muss ZUERST die eigenen Overwrites bekommen, bevor
          // irgendeine andere Aktion (hier: setParent) auf ihm versucht wird - sonst schlaegt
          // genau diese Aktion mit DiscordAPIError 50001 "Missing Access" fehl, weil der Bot
          // fuer diesen Kanal (noch) keinen Zugriff hat. Das Setzen der Overwrites selbst
          // funktioniert unabhaengig vom aktuellen Sichtbarkeitsstatus, solange der Bot die
          // dafuer noetige Basis-Berechtigung (ManageRoles/ManageChannels) besitzt.
          await reserved.permissionOverwrites.set(
            buildOverwrites(
              guild,
              blueprint.access,
              onboardedRoleId,
              adminRoleId,
              moderatorRoleId,
              botRoleId,
              blueprint.readOnly ?? false,
            ),
            'COMCAVE-Plattform: globale Kanalstruktur',
          );
          await reserved.setParent(category.id, { lockPermissions: false });
          result.channelsReused.push(blueprint.name);
          continue;
        }
      }

      const existing = guild.channels.cache.find(
        (channel): channel is GuildBasedChannel =>
          channel.parentId === category.id &&
          channel.name === blueprint.name &&
          channel.type === blueprint.type,
      );

      if (existing) {
        result.channelsReused.push(blueprint.name);
        continue;
      }

      await guild.channels.create({
        name: blueprint.name,
        type: blueprint.type,
        parent: category.id,
        permissionOverwrites: buildOverwrites(
          guild,
          blueprint.access,
          onboardedRoleId,
          adminRoleId,
          moderatorRoleId,
          botRoleId,
          blueprint.readOnly ?? false,
        ),
        ...(blueprint.topic && blueprint.type === ChannelType.GuildText
          ? { topic: blueprint.topic }
          : {}),
        reason: 'COMCAVE-Plattform: globale Serverstruktur',
      });

      result.channelsCreated.push(blueprint.name);
    }
  }

  return result;
}

export function buildOverwrites(
  guild: Guild,
  access: Access,
  onboardedRoleId: string,
  adminRoleId: string,
  moderatorRoleId: string,
  botRoleId: string,
  readOnly: boolean,
): OverwriteResolvable[] {
  const baseRead = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];
  const memberWrite = [
    ...baseRead,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AttachFiles,
  ];
  const readOnlyMember = [...baseRead];

  const overwrites: OverwriteResolvable[] = [];

  if (access === 'PUBLIC') {
    overwrites.push({
      id: guild.roles.everyone.id,
      allow: readOnly ? readOnlyMember : memberWrite,
    });
  } else if (access === 'VERIFIED') {
    overwrites.push({
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    });
    overwrites.push({
      id: onboardedRoleId,
      allow: readOnly ? readOnlyMember : memberWrite,
    });
  } else {
    overwrites.push({
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    });
  }

  const botPermissions = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.ManageChannels,
  ];

  const staffPermissions = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AttachFiles,
  ];

  overwrites.push({ id: botRoleId, allow: botPermissions });
  overwrites.push({ id: adminRoleId, allow: staffPermissions });
  overwrites.push({ id: moderatorRoleId, allow: staffPermissions });

  return overwrites;
}
