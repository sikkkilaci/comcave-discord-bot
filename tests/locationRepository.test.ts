import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  countActiveLocations,
  deactivateLocationsNotIn,
  formatLocationLabel,
  getLocationById,
  searchActiveLocations,
  upsertLocation,
} from '../src/repositories/locationRepository.js';

function uniqueCode(): string {
  return `code-${randomUUID()}`;
}

describe('locationRepository', () => {
  describe('upsertLocation', () => {
    it('legt einen neuen Standort an', async () => {
      const code = uniqueCode();

      const { location, created } = await upsertLocation({
        code,
        name: 'COMCAVE Testhausen',
        state: 'Teststate',
        city: 'Testhausen',
        postalCode: '12345',
      });

      expect(created).toBe(true);
      expect(location.code).toBe(code);
      expect(location.isActive).toBe(true);
    });

    it('ist idempotent: ein zweiter Import mit demselben code aktualisiert statt zu duplizieren', async () => {
      const code = uniqueCode();
      await upsertLocation({
        code,
        name: 'COMCAVE Alt',
        state: 'Teststate',
        city: 'Alt-Stadt',
        postalCode: '11111',
      });

      const { location, created } = await upsertLocation({
        code,
        name: 'COMCAVE Neu',
        state: 'Teststate',
        city: 'Neu-Stadt',
        postalCode: '22222',
      });

      expect(created).toBe(false);
      expect(location.name).toBe('COMCAVE Neu');
      expect(location.city).toBe('Neu-Stadt');

      const all = await searchActiveLocations('Neu-Stadt');
      expect(all).toHaveLength(1);
    });

    it('reaktiviert einen zuvor deaktivierten Standort bei erneutem Import', async () => {
      const code = uniqueCode();
      await upsertLocation({
        code,
        name: 'COMCAVE X',
        state: 'Teststate',
        city: 'X-Stadt',
        postalCode: '99999',
      });
      await deactivateLocationsNotIn([]);

      const { location } = await upsertLocation({
        code,
        name: 'COMCAVE X',
        state: 'Teststate',
        city: 'X-Stadt',
        postalCode: '99999',
      });

      expect(location.isActive).toBe(true);
    });
  });

  describe('deactivateLocationsNotIn', () => {
    it('deaktiviert nur Standorte, deren code nicht in der Liste enthalten ist', async () => {
      const keep = uniqueCode();
      const drop = uniqueCode();
      await upsertLocation({
        code: keep,
        name: 'Bleibt',
        state: 'Teststate',
        city: 'Stadt',
        postalCode: '11111',
      });
      await upsertLocation({
        code: drop,
        name: 'Faellt weg',
        state: 'Teststate',
        city: 'Stadt',
        postalCode: '22222',
      });

      const deactivatedCount = await deactivateLocationsNotIn([keep]);

      expect(deactivatedCount).toBeGreaterThanOrEqual(1);
      const results = await searchActiveLocations('Faellt weg');
      expect(results).toHaveLength(0);
      const keptResults = await searchActiveLocations('Bleibt');
      expect(keptResults).toHaveLength(1);
    });
  });

  describe('searchActiveLocations', () => {
    it('findet Standorte per Teilstring auf Name/Stadt/PLZ', async () => {
      const code = uniqueCode();
      await upsertLocation({
        code,
        name: 'COMCAVE Suchhausen',
        state: 'Teststate',
        city: 'Suchstadt',
        postalCode: '54321',
      });

      expect(await searchActiveLocations('Suchhausen')).toHaveLength(1);
      expect(await searchActiveLocations('Suchstadt')).toHaveLength(1);
      expect(await searchActiveLocations('54321')).toHaveLength(1);
      expect(await searchActiveLocations('kein-treffer-xyz')).toHaveLength(0);
    });

    it('liefert nur aktive Standorte', async () => {
      const code = uniqueCode();
      await upsertLocation({
        code,
        name: 'COMCAVE Inaktiv',
        state: 'Teststate',
        city: 'Inaktivstadt',
        postalCode: '00000',
      });
      await deactivateLocationsNotIn([]);

      const results = await searchActiveLocations('Inaktiv');

      expect(results).toHaveLength(0);
    });

    it('begrenzt die Ergebnisanzahl auf das uebergebene Limit', async () => {
      const prefix = `Limittest-${randomUUID()}`;
      for (let i = 0; i < 5; i += 1) {
        await upsertLocation({
          code: uniqueCode(),
          name: `${prefix}-${i}`,
          state: 'Teststate',
          city: 'Stadt',
          postalCode: '11111',
        });
      }

      const results = await searchActiveLocations(prefix, 3);

      expect(results).toHaveLength(3);
    });
  });

  describe('getLocationById / countActiveLocations', () => {
    it('gibt null zurueck fuer eine unbekannte ID', async () => {
      expect(await getLocationById(`unbekannt-${randomUUID()}`)).toBeNull();
    });

    it('zaehlt nur aktive Standorte', async () => {
      const before = await countActiveLocations();
      await upsertLocation({
        code: uniqueCode(),
        name: 'COMCAVE Zaehltest',
        state: 'Teststate',
        city: 'Zaehlstadt',
        postalCode: '77777',
      });

      expect(await countActiveLocations()).toBe(before + 1);
    });
  });

  describe('Standorte ohne verifizierte PLZ (postalCode optional)', () => {
    it('legt einen Standort ohne postalCode an und findet ihn ueber Name/Stadt/Bundesland', async () => {
      const code = uniqueCode();
      const uniqueCity = `Ohneplzstadt-${randomUUID()}`;

      const { location } = await upsertLocation({
        code,
        name: `COMCAVE ${uniqueCity}`,
        state: 'Testbundesland',
        city: uniqueCity,
      });

      expect(location.postalCode).toBeNull();
      expect(await searchActiveLocations(uniqueCity)).toHaveLength(1);
      expect(await searchActiveLocations('Testbundesland')).toEqual(
        expect.arrayContaining([expect.objectContaining({ code })]),
      );
    });

    it('formatLocationLabel zeigt die PLZ nur an, wenn sie gesetzt ist', async () => {
      const code = uniqueCode();
      const uniqueCity = `Labeltest-${randomUUID()}`;
      const { location } = await upsertLocation({
        code,
        name: `COMCAVE ${uniqueCity}`,
        state: 'Testbundesland',
        city: uniqueCity,
      });

      const label = formatLocationLabel(location);

      expect(label).not.toContain('null');
      expect(label).toContain(uniqueCity);
      expect(label).toContain('Testbundesland');
    });
  });
});
