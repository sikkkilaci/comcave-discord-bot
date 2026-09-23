import { describe, expect, it } from 'vitest';
import {
  ADMIN_PANEL_KLASSENBEREICHE_CUSTOM_ID,
  ADMIN_PANEL_KURSINHALTE_IMPORT_CUSTOM_ID,
  ADMIN_PANEL_KURSPLAN_IMPORT_PREFIX,
  buildAdminPanelMessage,
  buildKursplanImportCustomId,
  parseKursplanImportCustomId,
} from '../src/bot/ui/adminPanelMessage.js';
import { COURSE_PLAN_SOURCE_FILES } from '../src/services/coursePlanImportService.js';

function collectButtonCustomIds(message: ReturnType<typeof buildAdminPanelMessage>): string[] {
  return message.components.flatMap((row) =>
    row.components.map((button) => button.data.custom_id as string),
  );
}

describe('buildKursplanImportCustomId / parseKursplanImportCustomId', () => {
  it('baut und parst dieselbe Kursnummer verlustfrei zurueck', () => {
    expect(parseKursplanImportCustomId(buildKursplanImportCustomId('A'))).toBe('A');
  });

  it('liefert null bei einer fremden customId', () => {
    expect(parseKursplanImportCustomId('irgendwas-anderes')).toBeNull();
  });

  it('liefert null bei einer ungueltigen Klasse im Suffix', () => {
    expect(parseKursplanImportCustomId(`${ADMIN_PANEL_KURSPLAN_IMPORT_PREFIX}Z`)).toBeNull();
  });
});

describe('buildAdminPanelMessage', () => {
  it('enthaelt genau einen Kursplan-Import-Button je Klasse mit hinterlegter Quelldatei', () => {
    const message = buildAdminPanelMessage();
    const customIds = collectButtonCustomIds(message);

    for (const className of Object.keys(COURSE_PLAN_SOURCE_FILES)) {
      expect(customIds).toContain(buildKursplanImportCustomId(className as 'A'));
    }
    const kursplanButtons = customIds.filter((id) =>
      id.startsWith(ADMIN_PANEL_KURSPLAN_IMPORT_PREFIX),
    );
    expect(kursplanButtons).toHaveLength(Object.keys(COURSE_PLAN_SOURCE_FILES).length);
  });

  it('enthaelt die Klassenbereiche- und Kursinhalte-Import-Buttons', () => {
    const customIds = collectButtonCustomIds(buildAdminPanelMessage());

    expect(customIds).toContain(ADMIN_PANEL_KLASSENBEREICHE_CUSTOM_ID);
    expect(customIds).toContain(ADMIN_PANEL_KURSINHALTE_IMPORT_CUSTOM_ID);
  });

  it('verteilt Buttons auf mehrere Reihen, sobald mehr als 5 vorhanden waeren', () => {
    const message = buildAdminPanelMessage();
    for (const row of message.components) {
      expect(row.components.length).toBeLessThanOrEqual(5);
    }
  });
});
