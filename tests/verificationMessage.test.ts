import { describe, expect, it } from 'vitest';
import {
  VERIFY_BUTTON_CUSTOM_ID,
  buildVerificationPrompt,
} from '../src/bot/ui/verificationMessage.js';

interface RawButton {
  custom_id: string;
  emoji?: { name: string };
}

describe('verificationMessage', () => {
  it('enthaelt ein Schloss-Emoji im Embed-Titel', () => {
    const { embeds } = buildVerificationPrompt();

    expect(embeds[0]?.toJSON().title).toContain('🔐');
  });

  it('baut einen Verifizierungs-Button mit korrekter customId und Haken-Emoji', () => {
    const { components } = buildVerificationPrompt();
    const button = components[0]?.toJSON().components[0] as unknown as RawButton;

    expect(button.custom_id).toBe(VERIFY_BUTTON_CUSTOM_ID);
    expect(button.emoji?.name).toBe('✅');
  });
});
