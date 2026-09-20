import type { GuildMember } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import {
  findGuildMemberAcrossGuilds,
  type GuildMemberFetchable,
} from '../src/bot/discordHelpers.js';

function fakeGuild(fetchResult: GuildMember | Error): GuildMemberFetchable {
  return {
    members: {
      fetch: vi.fn(async () => {
        if (fetchResult instanceof Error) throw fetchResult;
        return fetchResult;
      }),
    },
  };
}

describe('findGuildMemberAcrossGuilds', () => {
  it('gibt null zurueck, wenn keine Guild ein Mitglied hat', async () => {
    const guilds = [fakeGuild(new Error('Unknown Member')), fakeGuild(new Error('Unknown Member'))];

    const result = await findGuildMemberAcrossGuilds(guilds, 'user-1');

    expect(result).toBeNull();
  });

  it('findet das Mitglied in der ersten passenden Guild', async () => {
    const fakeMember = { id: 'user-1' } as unknown as GuildMember;
    const guilds = [fakeGuild(new Error('Unknown Member')), fakeGuild(fakeMember)];

    const result = await findGuildMemberAcrossGuilds(guilds, 'user-1');

    expect(result).toBe(fakeMember);
  });

  it('bricht die Suche ab, sobald ein Treffer gefunden wurde', async () => {
    const fakeMember = { id: 'user-1' } as unknown as GuildMember;
    const firstGuild = fakeGuild(fakeMember);
    const secondGuild = fakeGuild(fakeMember);

    await findGuildMemberAcrossGuilds([firstGuild, secondGuild], 'user-1');

    expect(firstGuild.members.fetch).toHaveBeenCalledTimes(1);
    expect(secondGuild.members.fetch).not.toHaveBeenCalled();
  });

  it('gibt null bei einer leeren Guild-Liste zurueck', async () => {
    const result = await findGuildMemberAcrossGuilds([], 'user-1');
    expect(result).toBeNull();
  });
});
