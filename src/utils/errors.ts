export class AppError extends Error {
  public readonly isOperational: boolean;

  constructor(message: string, isOperational = true) {
    super(message);
    this.name = new.target.name;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

/** Wird geworfen, wenn ein Mitglied nicht die noetige Berechtigung fuer eine Aktion hat. */
export class PermissionError extends AppError {
  constructor(message = 'Du hast keine Berechtigung fuer diese Aktion.') {
    super(message);
  }
}

/** Wird geworfen, wenn erwartete Daten (z. B. Konfiguration einer Klasse) fehlen. */
export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message);
  }
}

/** Wird geworfen, wenn Nutzereingaben ungueltig sind. */
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message);
  }
}
