const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  REST,
  Routes,
  PermissionFlagsBits,
} = require('discord.js');
const fs = require('fs');
const path = require('path');

// ─── Config ────────────────────────────────────────────────────────────────
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const LEAGUE_HOST_CHANNEL_ID = '1501829215291703378';
const LEAGUE_HOST_ROLE_ID = '1504161875644907714';
const LEAGUES_PING_ROLE_ID = '1504161847102804069';
const DB_PATH = path.join(__dirname, 'database.json');

// ─── Role check (handles cached GuildMember and raw API member) ─────────────
function memberHasRole(member, roleId) {
  const roles = member.roles;
  if (!roles) return false;
  if (Array.isArray(roles)) return roles.includes(roleId);
  if (typeof roles.cache !== 'undefined') return roles.cache.has(roleId);
  return false;
}

// ─── Database helpers ───────────────────────────────────────────────────────
function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { leagues: {} };
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ─── League ID generator ────────────────────────────────────────────────────
function generateLeagueId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

// ─── Spot count per format ──────────────────────────────────────────────────
function getMaxPlayers(format) {
  const map = { '2v2': 4, '3v3': 6, '4v4': 8 };
  return map[format] || 4;
}

// ─── Build the league embed ─────────────────────────────────────────────────
function buildLeagueEmbed(league) {
  const spotsLeft = league.maxPlayers - league.players.length;
  const playerMentions =
    league.players.length > 0
      ? league.players.map((id) => `<@${id}>`).join('\n')
      : 'None';

  return new EmbedBuilder()
    .setTitle('League Available')
    .addFields(
      { name: 'Format', value: league.format, inline: true },
      { name: 'Match Type', value: league.type, inline: true },
      { name: 'Perks', value: league.perks, inline: true },
      { name: 'Region', value: league.region, inline: true },
      { name: 'Host', value: league.hostName, inline: true },
      { name: 'Spots Left', value: `${spotsLeft} / ${league.maxPlayers}`, inline: true },
      { name: 'Players', value: playerMentions, inline: false },
      { name: 'League ID', value: `\`${league.id}\``, inline: false }
    )
    .setFooter({ text: 'Use buttons below to join or cancel' })
    .setTimestamp()
    .setColor(0x2b2d31);
}

// ─── Build the cancelled embed ──────────────────────────────────────────────
function buildCancelledEmbed(league, cancellerMention) {
  return new EmbedBuilder()
    .setTitle('League Cancelled')
    .setDescription(
      `League \`${league.id}\` has been cancelled by ${cancellerMention}.`
    )
    .addFields(
      { name: 'Format', value: league.format, inline: true },
      { name: 'Match Type', value: league.type, inline: true },
      { name: 'Region', value: league.region, inline: true }
    )
    .setTimestamp()
    .setColor(0xe74c3c);
}

// ─── Build action buttons ───────────────────────────────────────────────────
function buildButtons(leagueId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`join_${leagueId}`)
      .setLabel('Join League')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`cancel_${leagueId}`)
      .setLabel('Cancel League')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

// ─── Register slash commands ────────────────────────────────────────────────
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('league')
      .setDescription('League management')
      .addSubcommand((sub) =>
        sub
          .setName('host')
          .setDescription('Host a new league')
          .addStringOption((opt) =>
            opt
              .setName('format')
              .setDescription('Match format')
              .setRequired(true)
              .addChoices(
                { name: '2v2', value: '2v2' },
                { name: '3v3', value: '3v3' },
                { name: '4v4', value: '4v4' }
              )
          )
          .addStringOption((opt) =>
            opt
              .setName('type')
              .setDescription('Match type')
              .setRequired(true)
              .addChoices(
                { name: 'Swift Game', value: 'Swift Game' },
                { name: 'War Game', value: 'War Game' }
              )
          )
          .addStringOption((opt) =>
            opt
              .setName('perks')
              .setDescription('Match perks')
              .setRequired(true)
              .addChoices(
                { name: 'Perks', value: 'Perks' },
                { name: 'No Perks', value: 'No Perks' }
              )
          )
          .addStringOption((opt) =>
            opt
              .setName('region')
              .setDescription('Region')
              .setRequired(true)
              .addChoices(
                { name: 'Europe', value: 'Europe' },
                { name: 'Asia', value: 'Asia' },
                { name: 'North America', value: 'North America' },
                { name: 'South America', value: 'South America' },
                { name: 'Oceania', value: 'Oceania' }
              )
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('cancel')
          .setDescription('Cancel a league by ID')
          .addStringOption((opt) =>
            opt
              .setName('id')
              .setDescription('League ID to cancel')
              .setRequired(true)
          )
      )
      .toJSON(),
  ];

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('Slash commands registered successfully.');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
}

// ─── Client setup ───────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
});

// ─── Helper: cancel a league (shared logic) ─────────────────────────────────
async function processCancel(league, interaction, cancellerMention) {
  const db = loadDB();

  // Fetch the original message and update it to show Cancelled
  try {
    const channel = await client.channels.fetch(league.channelId);
    const message = await channel.messages.fetch(league.messageId);

    const cancelledEmbed = buildCancelledEmbed(league, cancellerMention);
    const disabledButtons = buildButtons(league.id, true);

    await message.edit({ content: null, embeds: [cancelledEmbed], components: [disabledButtons] });
  } catch (err) {
    console.error('Could not update league message:', err.message);
  }

  // Delete the private thread
  if (league.threadId) {
    try {
      const thread = await client.channels.fetch(league.threadId);
      if (thread) await thread.delete();
    } catch (err) {
      console.error('Could not delete thread:', err.message);
    }
  }

  // Remove from database
  delete db.leagues[league.id];
  saveDB(db);
}

// ─── Interaction handler ─────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {

  // ── Slash commands ──────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'league') {
    const sub = interaction.options.getSubcommand();

    // ── /league host ──────────────────────────────────────────────────────
    if (sub === 'host') {
      // Channel restriction
      if (interaction.channelId !== LEAGUE_HOST_CHANNEL_ID) {
        return interaction.reply({
          content: 'Leagues can only be hosted in <#' + LEAGUE_HOST_CHANNEL_ID + '>.',
          flags: 64,
        });
      }

      // Role restriction
      if (!memberHasRole(interaction.member, LEAGUE_HOST_ROLE_ID)) {
        return interaction.reply({
          content: 'You do not have permission to host leagues.',
          flags: 64,
        });
      }

      const format = interaction.options.getString('format');
      const type = interaction.options.getString('type');
      const perks = interaction.options.getString('perks');
      const region = interaction.options.getString('region');
      const maxPlayers = getMaxPlayers(format);

      let leagueId;
      const db = loadDB();
      do {
        leagueId = generateLeagueId();
      } while (db.leagues[leagueId]);

      await interaction.deferReply();

      // Create the private thread first
      const channel = interaction.channel;
      let thread;
      try {
        thread = await channel.threads.create({
          name: `League ${leagueId} | ${format} ${type}`,
          type: ChannelType.PrivateThread,
          invitable: false,
          reason: `League ${leagueId} created by ${interaction.user.tag}`,
        });
        await thread.members.add(interaction.user.id);
      } catch (err) {
        console.error('Failed to create thread:', err.message);
        return interaction.editReply({
          content: 'Failed to create the league thread. Make sure the bot has the Manage Threads permission.',
        });
      }

      const league = {
        id: leagueId,
        format,
        type,
        perks,
        region,
        hostId: interaction.user.id,
        hostName: interaction.user.username,
        players: [interaction.user.id],
        maxPlayers,
        messageId: null,
        threadId: thread.id,
        channelId: interaction.channelId,
        status: 'open',
      };

      const embed = buildLeagueEmbed(league);
      const buttons = buildButtons(leagueId);

      const message = await interaction.editReply({
        content: `<@&${LEAGUES_PING_ROLE_ID}>`,
        embeds: [embed],
        components: [buttons],
      });

      league.messageId = message.id;
      db.leagues[leagueId] = league;
      saveDB(db);

      await thread.send({
        content: `League **${leagueId}** has been created.\n\nFormat: **${format}** | Type: **${type}** | Perks: **${perks}** | Region: **${region}**\n\nWaiting for players to join. Spots: **${maxPlayers - 1} / ${maxPlayers}** remaining.`,
      });

      return;
    }

    // ── /league cancel ────────────────────────────────────────────────────
    if (sub === 'cancel') {
      // Role restriction
      if (!memberHasRole(interaction.member, LEAGUE_HOST_ROLE_ID)) {
        return interaction.reply({
          content: 'You do not have permission to cancel leagues.',
          flags: 64,
        });
      }

      const leagueId = interaction.options.getString('id').toUpperCase().trim();
      const db = loadDB();
      const league = db.leagues[leagueId];

      if (!league) {
        return interaction.reply({
          content: `No active league found with ID \`${leagueId}\`.`,
          flags: 64,
        });
      }

      await interaction.deferReply({ flags: 64 });

      const cancellerMention = `<@${interaction.user.id}>`;
      await processCancel(league, interaction, cancellerMention);

      return interaction.editReply({
        content: `League \`${leagueId}\` has been cancelled.`,
      });
    }
  }

  // ── Button interactions ─────────────────────────────────────────────────
  if (interaction.isButton()) {
    const [action, leagueId] = interaction.customId.split('_');
    const db = loadDB();
    const league = db.leagues[leagueId];

    if (!league) {
      return interaction.reply({
        content: 'This league is no longer active.',
        flags: 64,
      });
    }

    // ── Join button ───────────────────────────────────────────────────────
    if (action === 'join') {
      if (league.players.includes(interaction.user.id)) {
        return interaction.reply({
          content: 'You have already joined this league.',
          flags: 64,
        });
      }

      if (league.players.length >= league.maxPlayers) {
        return interaction.reply({
          content: 'This league is already full.',
          flags: 64,
        });
      }

      league.players.push(interaction.user.id);
      const spotsLeft = league.maxPlayers - league.players.length;

      // Add user to the private thread
      try {
        const thread = await client.channels.fetch(league.threadId);
        await thread.members.add(interaction.user.id);

        const joinMsg =
          spotsLeft === 0
            ? `<@${interaction.user.id}> has joined. The league is now full. Starting now.`
            : `<@${interaction.user.id}> has joined. Spots remaining: **${spotsLeft} / ${league.maxPlayers}**.`;

        await thread.send({ content: joinMsg });
      } catch (err) {
        console.error('Could not add user to thread:', err.message);
      }

      // Update the embed
      const updatedEmbed = buildLeagueEmbed(league);
      const isFull = league.players.length >= league.maxPlayers;
      const buttons = buildButtons(leagueId, isFull);

      db.leagues[leagueId] = league;
      saveDB(db);

      await interaction.update({ embeds: [updatedEmbed], components: [buttons] });
      return;
    }

    // ── Cancel button ─────────────────────────────────────────────────────
    if (action === 'cancel') {
      if (!memberHasRole(interaction.member, LEAGUE_HOST_ROLE_ID)) {
        return interaction.reply({
          content: 'You do not have permission to cancel leagues.',
          flags: 64,
        });
      }

      await interaction.deferUpdate();

      const cancellerMention = `<@${interaction.user.id}>`;
      await processCancel(league, interaction, cancellerMention);
      return;
    }
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────
if (!TOKEN) {
  console.error('Missing DISCORD_TOKEN environment variable.');
  process.exit(1);
}
if (!CLIENT_ID) {
  console.error('Missing CLIENT_ID environment variable.');
  process.exit(1);
}

client.login(TOKEN);
