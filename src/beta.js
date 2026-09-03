import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
} from "discord.js";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { buildReleaseMessage } from "./format.js";

export const betaJoinButtonId = "sndbox-beta-join";

const discordSnowflake = /^\d{17,20}$/;

export function buildBetaAnnouncement() {
  const embed = new EmbedBuilder()
    .setColor(0xd6ff4b)
    .setAuthor({ name: "sndbox beta" })
    .setTitle("Get sndbox releases first")
    .setURL("https://sndbox.app/")
    .setDescription(
      "Stay close to what we’re building and try each new release as soon as it lands.",
    )
    .addFields(
      {
        name: "🚀 Early access",
        value: "Be among the first to explore new builds and improvements.",
        inline: true,
      },
      {
        name: "🔔 Direct updates",
        value: "Get the changelog and download link delivered to your DMs.",
        inline: true,
      },
    )
    .setFooter({ text: "One click to join • No extra setup" });
  const joinButton = new ButtonBuilder()
    .setCustomId(betaJoinButtonId)
    .setLabel("Join beta")
    .setEmoji("🧪")
    .setStyle(ButtonStyle.Success);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(joinButton)],
    allowedMentions: { parse: [] },
  };
}

export async function initializeBetaAnnouncement(channel, clientUser, options = {}) {
  if (!channel.guild || typeof channel.send !== "function" || typeof channel.messages?.fetch !== "function") {
    throw new Error("The beta channel must be a sendable Discord server text channel.");
  }

  const permissions = channel.permissionsFor?.(clientUser);
  const requiredPermissions = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
  ];
  if (permissions && !permissions.has(requiredPermissions)) {
    throw new Error("The bot needs View Channel, Read Message History, Send Messages, and Embed Links permissions in the beta channel.");
  }

  const logger = options.logger ?? console;
  const stateFile = options.stateFile;
  let state = await loadBetaState(stateFile);

  if (state.messageId) {
    try {
      const message = await channel.messages.fetch(state.messageId);
      if (message.author?.id !== clientUser.id) {
        throw new Error("The stored beta announcement is not owned by this bot.");
      }
      await message.edit(buildBetaAnnouncement());
      return createBetaController(state, stateFile);
    } catch (error) {
      logger.warn("Stored beta announcement is unavailable; replacing it without losing subscribers.", error);
    }
  }

  const message = await channel.send(buildBetaAnnouncement());
  state = { ...state, messageId: message.id };
  try {
    await saveBetaState(stateFile, state);
  } catch (error) {
    await message.delete?.().catch(() => {});
    throw error;
  }
  return createBetaController(state, stateFile);
}

export async function handleBetaInteraction(interaction, controller, options = {}) {
  if (!interaction.isButton?.()
    || interaction.customId !== betaJoinButtonId
    || (options.guildId && interaction.guildId !== options.guildId)
    || interaction.user?.bot) return { handled: false };

  await interaction.deferReply({ ephemeral: true });
  if (!controller) {
    await interaction.editReply("Beta sign-up is still starting. Please try again in a moment.");
    return { handled: true, joined: false };
  }

  const logger = options.logger ?? console;
  try {
    const joined = await controller.join(interaction.user.id);
    await interaction.editReply(joined
      ? "You’ve joined the sndbox beta. I’ll DM you whenever a new release is published."
      : "You’re already in the sndbox beta and will receive every new release by DM.");
    return { handled: true, joined };
  } catch (error) {
    logger.error(`Could not add Discord member ${interaction.user.id} to the beta.`, error);
    await interaction.editReply("I couldn’t save your beta sign-up. Please try again.");
    return { handled: true, joined: false };
  }
}

export async function sendBetaReleaseDMs(client, subscriberIds, release, logger = console) {
  const message = buildBetaReleaseMessage(release);
  let sent = 0;
  let failed = 0;

  for (const userId of subscriberIds) {
    try {
      const user = await client.users.fetch(userId);
      await user.send(message);
      sent += 1;
    } catch (error) {
      failed += 1;
      logger.warn(`Could not DM sndbox release ${release.tag} to beta subscriber ${userId}.`, error);
    }
  }

  return { sent, failed };
}

export function buildBetaReleaseMessage(release) {
  const message = buildReleaseMessage(release);
  const embed = message.embeds[0]
    .setColor(0xd6ff4b)
    .setAuthor({ name: "sndbox beta • new release" })
    .setTitle(release.name)
    .setURL(release.url)
    .addFields({ name: "Version", value: `\`${release.tag}\``, inline: true })
    .setFooter({ text: "Thanks for helping shape sndbox" })
    .setTimestamp(new Date(release.publishedAt));

  return { ...message, embeds: [embed] };
}

export async function loadBetaState(path) {
  try {
    const state = JSON.parse(await readFile(path, "utf8"));
    if (state?.schemaVersion !== 1
      || (state.messageId !== null && !discordSnowflake.test(state.messageId))
      || !Array.isArray(state.subscriberIds)
      || state.subscriberIds.some((id) => !discordSnowflake.test(id))) {
      throw new Error("The beta state file has an unsupported format.");
    }
    return {
      schemaVersion: 1,
      messageId: state.messageId,
      subscriberIds: [...new Set(state.subscriberIds)],
    };
  } catch (error) {
    if (error?.code === "ENOENT") return emptyBetaState();
    throw new Error(`Could not load beta state from ${path}: ${error.message}`, { cause: error });
  }
}

function createBetaController(initialState, stateFile) {
  let state = initialState;
  let updateQueue = Promise.resolve();

  return {
    join(userId) {
      const operation = updateQueue.then(async () => {
        if (state.subscriberIds.includes(userId)) return false;
        const nextState = { ...state, subscriberIds: [...state.subscriberIds, userId] };
        await saveBetaState(stateFile, nextState);
        state = nextState;
        return true;
      });
      updateQueue = operation.catch(() => {});
      return operation;
    },
    async getSubscriberIds() {
      await updateQueue;
      return [...state.subscriberIds];
    },
  };
}

async function saveBetaState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
}

function emptyBetaState() {
  return { schemaVersion: 1, messageId: null, subscriberIds: [] };
}
