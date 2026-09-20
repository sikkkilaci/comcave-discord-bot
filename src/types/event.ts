import type { ClientEvents } from 'discord.js';

export interface BotEvent<K extends keyof ClientEvents = keyof ClientEvents> {
  name: K;
  /** Wenn true, wird der Listener nur einmal ausgefuehrt (z. B. "ready"). */
  once?: boolean;
  execute(...args: ClientEvents[K]): Promise<void> | void;
}
