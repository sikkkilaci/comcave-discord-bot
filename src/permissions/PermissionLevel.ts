/**
 * Aufsteigende Berechtigungsstufen im Bot. Jede Stufe schliesst die
 * Berechtigungen der darunterliegenden Stufen ein (siehe checkPermission.ts).
 *
 * - EVERYONE: jedes Server-Mitglied (auch unverifiziert).
 * - VERIFIED: Mitglieder, die den Verifizierungsprozess abgeschlossen haben.
 * - KLASSENLEITUNG: Klassenleitung, administrative Rechte aber NUR fuer die
 *   eigene Klasse (die Einschraenkung auf die eigene Klasse erfolgt in der
 *   jeweiligen Command-Logik, nicht in dieser globalen Stufe).
 * - ADMIN: volle Bot-Administration (Server-Admin oder konfigurierte Admin-Rolle).
 */
export enum PermissionLevel {
  EVERYONE = 0,
  VERIFIED = 1,
  KLASSENLEITUNG = 2,
  ADMIN = 3,
}
