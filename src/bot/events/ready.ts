import type { Client } from 'discord.js';
import type { BotEvent } from '../../types/event.js';
import { getOrCreateGuildConfig } from '../../repositories/guildConfigRepository.js';
import { checkUpcomingCourseNotificationsForGuild } from '../../services/coursePlanNotificationService.js';
import { buildUpcomingCourseNoticeEmbed } from '../ui/coursePlanMessage.js';
import type { ClassName } from '../../types/domain.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('event:ready');

const event: BotEvent<'ready'> = {
  name: 'ready',
  once: true,
  async execute(client: Client<true>) {
    logger.info(
      { tag: client.user.tag, guilds: client.guilds.cache.size },
      'Bot ist online und bereit.',
    );

    await checkUpcomingCoursePlans(client);
  },
};

/**
 * Prueft bei jedem Bot-Start fuer jede Guild, ob neue Kurse innerhalb der
 * naechsten 7 Tage beginnen (siehe coursePlanNotificationService.ts). Die
 * Dedup-Logik liegt vollstaendig im Service/Schema (`CourseUpcomingNotification`
 * ist `@unique` pro Kurs) - wiederholte Bot-Starts erzeugen daher nie
 * doppelte Hinweise, unabhaengig davon, ob das Posten in Discord gelingt.
 * Das Posten selbst ist Best-Effort: ein fehlender/geloeschter Kanal oder
 * fehlende Bot-Berechtigungen duerfen weder den Bot-Start verhindern noch die
 * Pruefung weiterer Klassen/Guilds abbrechen - das Audit-Log bleibt der
 * massgebliche, nachvollziehbare Nachweis der Benachrichtigung.
 */
async function checkUpcomingCoursePlans(client: Client<true>): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    try {
      await getOrCreateGuildConfig(guild.id);
      const results = await checkUpcomingCourseNotificationsForGuild(guild.id);

      for (const { klasse, entries } of results) {
        const channelId = klasse.announcementChannelId;
        if (!channelId) continue;

        const channel = guild.channels.cache.get(channelId);
        if (!channel || !channel.isTextBased()) continue;

        for (const entry of entries) {
          try {
            await channel.send({
              embeds: [buildUpcomingCourseNoticeEmbed(klasse.name as ClassName, entry)],
            });
          } catch (error) {
            logger.error(
              { err: error, guildId: guild.id, classId: klasse.id, courseEntryId: entry.id },
              'Konnte 7-Tage-Hinweis nicht in den Klassen-Kanal posten',
            );
          }
        }
      }
    } catch (error) {
      logger.error(
        { err: error, guildId: guild.id },
        'Pruefung auf anstehende Kurse fehlgeschlagen',
      );
    }
  }
}

export default event;
