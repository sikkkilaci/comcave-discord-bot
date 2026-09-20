import {
  PermissionFlagsBits,
  PermissionsBitField,
  type APIRole,
  type GuildMember,
  type Role,
} from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import {
  findGuildMemberAcrossGuilds,
  roleHasAdministrator,
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

describe('roleHasAdministrator', () => {
  it('erkennt eine Rolle (Role-Objekt) mit Administrator-Berechtigung', () => {
    const role = {
      permissions: new PermissionsBitField(PermissionFlagsBits.Administrator),
    } as unknown as Role;

    expect(roleHasAdministrator(role)).toBe(true);
  });

  it('erkennt eine Rolle (Role-Objekt) ohne Administrator-Berechtigung', () => {
    const role = {
      permissions: new PermissionsBitField(PermissionFlagsBits.SendMessages),
    } as unknown as Role;

    expect(roleHasAdministrator(role)).toBe(false);
  });

  it('erkennt Administrator-Berechtigung bei einer rohen APIRole (String-Bitfeld)', () => {
    const role = {
      permissions: PermissionFlagsBits.Administrator.toString(),
    } as unknown as APIRole;

    expect(roleHasAdministrator(role)).toBe(true);
  });

  it('erkennt fehlende Administrator-Berechtigung bei einer rohen APIRole', () => {
    const role = { permissions: PermissionFlagsBits.SendMessages.toString() } as unknown as APIRole;

    expect(roleHasAdministrator(role)).toBe(false);
  });
});
