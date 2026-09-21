import { DiscordAPIError, type GuildMember } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { trySetNickname } from '../src/services/discordNicknameSync.js';

function fakeGuildMember(
  nickname: string | null,
  setNicknameImpl: (nickname: string, reason?: string) => Promise<unknown>,
): GuildMember {
  return {
    id: 'member-1',
    nickname,
    guild: { id: 'guild-1' },
    setNickname: vi.fn(setNicknameImpl),
  } as unknown as GuildMember;
}

describe('trySetNickname', () => {
  it('setzt den Nicknamen und meldet changed: true', async () => {
    const member = fakeGuildMember(null, async () => undefined);

    const result = await trySetNickname(member, 'Max Mustermann', 'Testgrund');

    expect(result).toEqual({ changed: true, skipped: false });
    expect(member.setNickname).toHaveBeenCalledWith('Max Mustermann', 'Testgrund');
  });

  it('ist ein No-Op, wenn der Nickname bereits dem Zielwert entspricht', async () => {
    const member = fakeGuildMember('Max Mustermann', async () => undefined);

    const result = await trySetNickname(member, 'Max Mustermann', 'Testgrund');

    expect(result).toEqual({ changed: false, skipped: false });
    expect(member.setNickname).not.toHaveBeenCalled();
  });

  it('faengt eine fehlende Berechtigung (Discord-Fehlercode 50013) ab, statt zu werfen', async () => {
    const member = fakeGuildMember(null, async () => {
      throw new DiscordAPIError(
        { code: 50013, message: 'Missing Permissions' },
        50013,
        403,
        'PATCH',
        '/guilds/x/members/y',
        { body: undefined, files: undefined },
      );
    });

    const result = await trySetNickname(member, 'Max Mustermann', 'Testgrund');

    expect(result).toEqual({ changed: false, skipped: true });
  });

  it('faengt den Server-Owner-Sonderfall ab (Discord meldet ebenfalls Fehlercode 50013), ohne zu werfen', async () => {
    const member = fakeGuildMember(null, async () => {
      throw new DiscordAPIError(
        { code: 50013, message: 'Missing Permissions' },
        50013,
        403,
        'PATCH',
        '/guilds/x/members/owner',
        { body: undefined, files: undefined },
      );
    });

    await expect(trySetNickname(member, 'Server Owner', 'Testgrund')).resolves.toEqual({
      changed: false,
      skipped: true,
    });
  });

  it('reicht unbekannte Fehler unveraendert weiter (kein stiller Fail-safe fuer echte Bugs)', async () => {
    const member = fakeGuildMember(null, async () => {
      throw new Error('Netzwerkfehler');
    });

    await expect(trySetNickname(member, 'Max Mustermann', 'Testgrund')).rejects.toThrow(
      'Netzwerkfehler',
    );
  });
});
