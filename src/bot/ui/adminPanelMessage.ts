import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { COURSE_PLAN_SOURCE_FILES } from '../../services/coursePlanImportService.js';
import { CLASS_NAMES, CLASS_NAME_LABELS, type ClassName } from '../../types/domain.js';

/** Prefix der Kursplan-Import-Button-customId; das Suffix ist die jeweilige Klasse (A/B/C). */
export const ADMIN_PANEL_KURSPLAN_IMPORT_PREFIX = 'adminPanel:kursplanImport:';
export const ADMIN_PANEL_KURSINHALTE_IMPORT_CUSTOM_ID = 'adminPanel:kursinhalteImport';
export const ADMIN_PANEL_KLASSENBEREICHE_CUSTOM_ID = 'adminPanel:klassenbereiche';

/** Discord erlaubt maximal 5 Buttons je ActionRow. */
const MAX_BUTTONS_PER_ROW = 5;

export function buildKursplanImportCustomId(className: ClassName): string {
  return `${ADMIN_PANEL_KURSPLAN_IMPORT_PREFIX}${className}`;
}

export function parseKursplanImportCustomId(customId: string): ClassName | null {
  if (!customId.startsWith(ADMIN_PANEL_KURSPLAN_IMPORT_PREFIX)) return null;
  const value = customId.slice(ADMIN_PANEL_KURSPLAN_IMPORT_PREFIX.length);
  return (CLASS_NAMES as readonly string[]).includes(value) ? (value as ClassName) : null;
}

export interface AdminPanelMessage {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}

/**
 * Dauerhaftes Admin-Panel im internen Kanal `⚙️-verwaltung` (siehe
 * postAdminPanel() in adminPanelService.ts): buendelt die haeufig
 * wiederkehrenden Kursplan-/Kursinhalte-Admin-Aktionen als Buttons, damit sie
 * per Klick statt per Slash-Befehl-mit-Optionen ausgefuehrt werden koennen -
 * analog zum Verifizierungs-Button. Die zugrundeliegenden Slash-Befehle
 * (`/kursplan-importieren`, `/setup-klassenbereiche`) bleiben unveraendert
 * bestehen; die Buttons rufen dieselbe Service-Logik auf.
 *
 * Kursplan-Import-Buttons nur fuer Klassen mit tatsaechlich hinterlegter
 * Quelldatei (siehe COURSE_PLAN_SOURCE_FILES) - fuer Klassen ohne Quelle
 * wuerde der Import ohnehin sofort fehlschlagen.
 */
export function buildAdminPanelMessage(): AdminPanelMessage {
  const embed = new EmbedBuilder()
    .setTitle('⚙️ Admin-Panel: Kursplan & Kursinhalte')
    .setColor(0x2b2d31)
    .setDescription(
      'Klick statt Tippen: Diese Buttons fuehren dieselben Aktionen aus wie die zugehoerigen ' +
        'Slash-Befehle - nur Admins koennen sie ausloesen.',
    );

  const kursplanButtons = (Object.keys(COURSE_PLAN_SOURCE_FILES) as ClassName[]).map((className) =>
    new ButtonBuilder()
      .setCustomId(buildKursplanImportCustomId(className))
      .setLabel(`📥 Kursplan ${CLASS_NAME_LABELS[className]} importieren`)
      .setStyle(ButtonStyle.Primary),
  );

  const otherButtons = [
    new ButtonBuilder()
      .setCustomId(ADMIN_PANEL_KLASSENBEREICHE_CUSTOM_ID)
      .setLabel('🏫 Klassenbereiche einrichten (alle Klassen)')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(ADMIN_PANEL_KURSINHALTE_IMPORT_CUSTOM_ID)
      .setLabel('📚 Kursinhalte importieren')
      .setStyle(ButtonStyle.Secondary),
  ];

  const allButtons = [...kursplanButtons, ...otherButtons];
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < allButtons.length; i += MAX_BUTTONS_PER_ROW) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        allButtons.slice(i, i + MAX_BUTTONS_PER_ROW),
      ),
    );
  }

  return { embeds: [embed], components: rows };
}
