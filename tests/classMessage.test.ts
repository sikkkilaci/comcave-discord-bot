import { describe, expect, it } from 'vitest';
import {
  CLASS_BACK_CUSTOM_ID,
  CLASS_HELP_CUSTOM_ID,
  buildClassConfirmCustomId,
  buildClassConfirmMessage,
  buildClassCustomId,
  buildClassHelpRequestedMessage,
  buildClassSelectionMessage,
  parseClassConfirmCustomId,
  parseClassCustomId,
} from '../src/bot/ui/classMessage.js';
import { CLASS_NAME_LABELS, CLASS_NAMES, type ClassName } from '../src/types/domain.js';
import type { ClassMemberOverview } from '../src/services/classService.js';

interface RawButton {
  custom_id: string;
  label: string;
  style: number;
}

interface RawField {
  name: string;
  value: string;
  inline?: boolean;
}

const STYLE_SUCCESS = 3;
const STYLE_SECONDARY = 2;

function emptyOverview(): ClassMemberOverview {
  return { A: [], B: [], C: [] };
}

function buttonsOf(
  components: ReturnType<typeof buildClassSelectionMessage>['components'],
): RawButton[] {
  return components.flatMap((row) => row.toJSON().components as unknown as RawButton[]);
}

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

  describe('buildClassConfirmCustomId / parseClassConfirmCustomId', () => {
    it('ist fuer alle Klassen umkehrbar und ueberschneidet sich nicht mit class:select:', () => {
      for (const name of CLASS_NAMES) {
        const customId = buildClassConfirmCustomId(name);
        expect(parseClassConfirmCustomId(customId)).toBe(name);
        expect(parseClassCustomId(customId)).toBeNull();
      }
    });

    it('gibt null fuer unbekannte oder fremde customIds zurueck', () => {
      expect(parseClassConfirmCustomId('class:confirm:D')).toBeNull();
      expect(parseClassConfirmCustomId('class:select:A')).toBeNull();
    });
  });

  describe('buildClassSelectionMessage', () => {
    it('baut genau einen Button pro Klasse mit korrekter customId, plus einen Hilfe-Button', () => {
      const { components } = buildClassSelectionMessage(emptyOverview(), null);
      const buttons = buttonsOf(components);

      expect(buttons.map((button) => button.custom_id)).toEqual([
        'class:select:A',
        'class:select:B',
        'class:select:C',
        CLASS_HELP_CUSTOM_ID,
      ]);
    });

    it('beschriftet jeden Button mit dem passenden Klassen-Emoji (🅰️/🅱️/🆑)', () => {
      const { components } = buildClassSelectionMessage(emptyOverview(), null);
      const buttons = buttonsOf(components);

      for (const name of CLASS_NAMES) {
        const button = buttons.find((b) => b.custom_id === `class:select:${name}`);
        expect(button?.label).toBe(CLASS_NAME_LABELS[name]);
      }
    });

    it('hebt keine Klasse hervor, wenn currentClassName null ist', () => {
      const { components, embeds } = buildClassSelectionMessage(emptyOverview(), null);
      const classButtons = buttonsOf(components).filter(
        (b) => b.custom_id !== CLASS_HELP_CUSTOM_ID,
      );

      expect(classButtons.every((button) => button.style === STYLE_SECONDARY)).toBe(true);
      expect(embeds[0]?.toJSON().footer?.text).toContain('noch keiner Klasse zugeordnet');
    });

    it('hebt die aktuelle Klasse farblich hervor', () => {
      const { components, embeds } = buildClassSelectionMessage(emptyOverview(), 'B');
      const buttons = buttonsOf(components);
      const buttonB = buttons.find((button) => button.custom_id === 'class:select:B');
      const others = buttons.filter(
        (button) =>
          button.custom_id !== 'class:select:B' && button.custom_id !== CLASS_HELP_CUSTOM_ID,
      );

      expect(buttonB?.style).toBe(STYLE_SUCCESS);
      expect(others.every((button) => button.style === STYLE_SECONDARY)).toBe(true);
      expect(embeds[0]?.toJSON().footer?.text).toContain('Klasse B');
    });

    describe('Teilnehmer-Uebersicht (nur bestaetigte Zuordnungen)', () => {
      it('zeigt "Noch keine bestätigten Teilnehmer" fuer eine leere Klasse', () => {
        const { embeds } = buildClassSelectionMessage(emptyOverview(), null);
        const fields = embeds[0]?.toJSON().fields as RawField[];

        for (const field of fields) {
          expect(field.value).toContain('Noch keine bestätigten Teilnehmer');
        }
      });

      it('zeigt die uebergebenen Vornamen je Klasse in der passenden Spalte', () => {
        const overview: ClassMemberOverview = {
          A: ['Adem', 'Cem', 'Robin'],
          B: ['Dominik', 'Ahmet'],
          C: [],
        };
        const { embeds } = buildClassSelectionMessage(overview, null);
        const fields = embeds[0]?.toJSON().fields as RawField[];

        const fieldFor = (name: ClassName) =>
          fields.find((f) => f.name === CLASS_NAME_LABELS[name]);

        expect(fieldFor('A')?.value).toContain('Adem');
        expect(fieldFor('A')?.value).toContain('Cem');
        expect(fieldFor('A')?.value).toContain('Robin');
        expect(fieldFor('B')?.value).toContain('Dominik');
        expect(fieldFor('B')?.value).toContain('Ahmet');
        expect(fieldFor('C')?.value).toContain('Noch keine bestätigten Teilnehmer');
      });

      it('kuerzt sehr lange Teilnehmerlisten sauber statt das Discord-UI zu sprengen', () => {
        const manyNames = Array.from({ length: 40 }, (_, i) => `Teilnehmer${i + 1}`);
        const overview: ClassMemberOverview = { A: manyNames, B: [], C: [] };

        const { embeds } = buildClassSelectionMessage(overview, null);
        const fields = embeds[0]?.toJSON().fields as RawField[];
        const fieldA = fields.find((f) => f.name === CLASS_NAME_LABELS.A);

        expect(fieldA?.value.length).toBeLessThanOrEqual(1024);
        expect(fieldA?.value).toContain('weitere');
        expect(fieldA?.value).not.toContain('Teilnehmer40');
      });

      it('escaped Markdown-Sonderzeichen in Vornamen (keine Formatierungs-Injection)', () => {
        const overview: ClassMemberOverview = { A: ['**Fake Admin**'], B: [], C: [] };

        const { embeds } = buildClassSelectionMessage(overview, null);
        const fields = embeds[0]?.toJSON().fields as RawField[];
        const fieldA = fields.find((f) => f.name === CLASS_NAME_LABELS.A);

        expect(fieldA?.value).not.toContain('**Fake Admin**');
        expect(fieldA?.value).toContain('Fake Admin');
      });
    });
  });

  describe('buildClassConfirmMessage', () => {
    it('nennt die ausgewaehlte Klasse und listet die dortigen Teilnehmer', () => {
      const { embeds, components } = buildClassConfirmMessage('A', ['Adem', 'Cem']);

      expect(embeds[0]?.toJSON().title).toContain(CLASS_NAME_LABELS.A);
      expect(embeds[0]?.toJSON().description).toContain('Adem');
      expect(embeds[0]?.toJSON().description).toContain('Cem');

      const buttons = buttonsOf(components);
      expect(buttons).toHaveLength(2);
      expect(buttons.map((b) => b.custom_id)).toEqual([
        buildClassConfirmCustomId('A'),
        CLASS_BACK_CUSTOM_ID,
      ]);
    });

    it('zeigt "Noch keine bestätigten Teilnehmer" fuer eine leere Klasse', () => {
      const { embeds } = buildClassConfirmMessage('C', []);

      expect(embeds[0]?.toJSON().description).toContain('Noch keine bestätigten Teilnehmer');
    });
  });

  describe('buildClassHelpRequestedMessage', () => {
    it('bestaetigt die Hilfe-Anfrage ohne weitere Aktions-Buttons', () => {
      const { embeds, components } = buildClassHelpRequestedMessage();

      expect(embeds[0]?.toJSON().description).toContain('Schulhof');
      expect(components).toHaveLength(0);
    });
  });
});
