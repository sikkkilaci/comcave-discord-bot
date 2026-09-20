import { EmbedBuilder } from 'discord.js';
import type { LearningMaterial } from '@prisma/client';
import {
  CLASS_NAME_LABELS,
  LEARNING_MATERIAL_CATEGORY_LABELS,
  LEARNING_MATERIAL_LINK_TYPE_LABELS,
  type ClassName,
  type LearningMaterialCategory,
  type LearningMaterialLinkType,
} from '../../types/domain.js';

/** Discord erlaubt maximal 25 Felder pro Embed. */
const MAX_LISTED_ITEMS = 25;

function categoryLabel(category: string): string {
  return LEARNING_MATERIAL_CATEGORY_LABELS[category as LearningMaterialCategory] ?? category;
}

function linkLabel(material: LearningMaterial): string | null {
  if (!material.linkedType || !material.linkedId) return null;
  const typeLabel =
    LEARNING_MATERIAL_LINK_TYPE_LABELS[material.linkedType as LearningMaterialLinkType] ??
    material.linkedType;
  return `Verknuepft mit: ${typeLabel} (\`${material.linkedId}\`)`;
}

/**
 * Baut die Liste des Lernmaterials einer Klasse als Embed, gruppiert nach
 * Kategorie (siehe listLearningMaterialsByClassId() - Sortierung Kategorie
 * dann Titel).
 */
export function buildLearningMaterialListEmbed(
  className: ClassName,
  materials: LearningMaterial[],
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`📚 Lernmaterial - ${CLASS_NAME_LABELS[className]}`)
    .setColor(0x2b2d31);

  if (materials.length === 0) {
    return embed.setDescription('Aktuell ist kein Lernmaterial eingetragen.');
  }

  for (const material of materials.slice(0, MAX_LISTED_ITEMS)) {
    const lines = [
      categoryLabel(material.category),
      `Fach/Thema: ${material.subject}`,
      material.description,
    ];
    if (material.url) {
      lines.push(`Link: ${material.url}`);
    }
    if (material.attachmentUrl) {
      lines.push(`Anhang: [${material.attachmentName ?? 'Datei'}](${material.attachmentUrl})`);
    }
    const link = linkLabel(material);
    if (link) {
      lines.push(link);
    }
    lines.push(`ID: \`${material.id}\``);
    embed.addFields({ name: material.title, value: lines.join('\n') });
  }

  if (materials.length > MAX_LISTED_ITEMS) {
    embed.setFooter({ text: `+ ${materials.length - MAX_LISTED_ITEMS} weitere nicht angezeigt` });
  }

  return embed;
}
