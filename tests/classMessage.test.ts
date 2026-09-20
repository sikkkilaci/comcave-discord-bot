import { describe, expect, it } from 'vitest';
import {
  buildClassCustomId,
  buildClassSelectionMessage,
  parseClassCustomId,
} from '../src/bot/ui/classMessage.js';
import { CLASS_NAMES } from '../src/types/domain.js';

interface RawButton {
  custom_id: string;
  label: string;
  style: number;
}

const STYLE_SUCCESS = 3;
const STYLE_SECONDARY = 2;

describe('classMessage', () => {
  describe('buildClassCustomId / parseClassCustomId', () => {
    it('ist fuer alle Klassen umkehrbar', () => {
      for (const name of CLASS_NAMES) {
        expect(parseClassCustomId(buildClassCustomId(name))).toBe(name);
      }
    });

    it('gibt null fuer unbekannte oder fremde customIds zurueck', () => {
      expect(parseClassCustomId('class:select:D')).toBeNull();
      expect(parseClassCustomId('onboarding:answer:IT_EXPERIENCE')).toBeNull();
      expect(parseClassCustomId('verification:self-verify')).toBeNull();
    });
  });

  describe('buildClassSelectionMessage', () => {
    it('baut genau einen Button pro Klasse mit korrekter customId', () => {
      const { components } = buildClassSelectionMessage(null);
      const buttons = components[0]?.toJSON().components as unknown as RawButton[];

      expect(buttons).toHaveLength(3);
      expect(buttons.map((button) => button.custom_id)).toEqual([
        'class:select:A',
        'class:select:B',
        'class:select:C',
      ]);
    });

    it('hebt keine Klasse hervor, wenn currentClassName null ist', () => {
      const { components, embeds } = buildClassSelectionMessage(null);
      const buttons = components[0]?.toJSON().components as unknown as RawButton[];

      expect(buttons.every((button) => button.style === STYLE_SECONDARY)).toBe(true);
      expect(embeds[0]?.toJSON().footer?.text).toContain('noch keiner Klasse zugeordnet');
    });

    it('hebt die aktuelle Klasse farblich hervor', () => {
      const { components, embeds } = buildClassSelectionMessage('B');
      const buttons = components[0]?.toJSON().components as unknown as RawButton[];
      const buttonB = buttons.find((button) => button.custom_id === 'class:select:B');
      const others = buttons.filter((button) => button.custom_id !== 'class:select:B');

      expect(buttonB?.style).toBe(STYLE_SUCCESS);
      expect(others.every((button) => button.style === STYLE_SECONDARY)).toBe(true);
      expect(embeds[0]?.toJSON().footer?.text).toContain('Klasse B');
    });
  });
});
