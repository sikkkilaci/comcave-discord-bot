import { describe, expect, it } from 'vitest';
import { NotFoundError, PermissionError, ValidationError } from '../src/utils/errors.js';

describe('Fehlerklassen', () => {
  it('PermissionError hat eine sinnvolle Standardnachricht', () => {
    const error = new PermissionError();
    expect(error.name).toBe('PermissionError');
    expect(error.message).toContain('Berechtigung');
    expect(error.isOperational).toBe(true);
  });

  it('NotFoundError und ValidationError uebernehmen die uebergebene Nachricht', () => {
    const notFound = new NotFoundError('Klasse nicht gefunden');
    const validation = new ValidationError('Ungueltige Eingabe');

    expect(notFound.message).toBe('Klasse nicht gefunden');
    expect(notFound.name).toBe('NotFoundError');
    expect(validation.message).toBe('Ungueltige Eingabe');
    expect(validation.name).toBe('ValidationError');
  });
});
