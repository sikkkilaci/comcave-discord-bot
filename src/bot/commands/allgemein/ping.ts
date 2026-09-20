import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../../types/command.js';
import { PermissionLevel } from '../../../permissions/PermissionLevel.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Prueft, ob der Bot erreichbar ist.'),
  permissionLevel: PermissionLevel.EVERYONE,
  async execute(interaction) {
    const wsLatency = Math.round(interaction.client.ws.ping);
    await interaction.reply(`Pong! 🏓 Websocket-Latenz: ${wsLatency}ms`);
  },
};

export default command;
