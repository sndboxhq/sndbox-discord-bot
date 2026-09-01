import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  WebhookClient,
} from "discord.js";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const webhookName = "sndbox";
const legacyWebhookNames = new Set(["sndbox", "sndbox Honeypot"]);
const defaultIconPath = fileURLToPath(new URL("../assets/sndboxicon.png", import.meta.url));
const banReason = "Message sent in the sndbox honeypot channel";

export function buildHoneypotMessage(banCount = 0) {
  const embed = new EmbedBuilder()
    .setColor(0xd6ff4b)
    .setTitle("DO NOT SEND MESSAGES IN THIS CHANNEL")
    .setURL("https://sndbox.app/")
    .setDescription(
      "This channel is an automated honeypot used to catch spam bots. "
      + "Any account that sends a message here will be **permanently banned from the server**.\n\n"
      + "If you are human, do not test it.",
    )
    .setFooter({ text: "sndbox • automated anti-spam" });
  const countButton = new ButtonBuilder()
    .setCustomId("sndbox-honeypot-ban-count")
    .setLabel(`Bans: ${banCount}`)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);

  return {
    username: webhookName,
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(countButton)],
    allowedMentions: { parse: [] },
  };
}

export async function initializeHoneypot(channel, clientUser, options = {}) {
  if (!channel.guild || typeof channel.fetchWebhooks !== "function" || typeof channel.createWebhook !== "function") {
    throw new Error("The honeypot channel must be a webhook-capable Discord server channel.");
  }

  const channelPermissions = channel.permissionsFor(clientUser);
  const requiredChannelPermissions = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.ManageWebhooks,
  ];
  if (channelPermissions && !channelPermissions.has(requiredChannelPermissions)) {
    throw new Error("The bot needs View Channel, Read Message History, Manage Messages, and Manage Webhooks permissions in the honeypot channel.");
  }

  const botMember = channel.guild.members.me ?? await channel.guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) {
    throw new Error("The bot is missing the Ban Members permission in the target server.");
  }

  const stateFile = options.stateFile;
  const logger = options.logger ?? console;
  const createWebhookClient = options.createWebhookClient
    ?? ((credentials) => new WebhookClient(credentials));
  const icon = await readFile(options.iconPath ?? defaultIconPath);
  let state = await loadHoneypotState(stateFile);

  if (state.webhookId && state.webhookToken && state.messageId) {
    const webhookClient = createWebhookClient({ id: state.webhookId, token: state.webhookToken });
    try {
      await webhookClient.edit({ name: webhookName, avatar: icon });
      await webhookClient.editMessage(state.messageId, buildHoneypotMessage(state.banCount));
      return createHoneypotController(state, stateFile, webhookClient, logger);
    } catch (error) {
      webhookClient.destroy?.();
      logger.warn("Stored honeypot webhook is unavailable; replacing it without resetting the ban count.", error);
    }
  }

  await removeLegacyHoneypots(channel, clientUser);
  const webhook = await channel.createWebhook({
    name: webhookName,
    avatar: icon,
    reason: "sndbox automated anti-spam honeypot",
  });
  if (!webhook.token) {
    await webhook.delete("Honeypot webhook did not return a token").catch(() => {});
    throw new Error("Discord did not return a token for the new honeypot webhook.");
  }

  try {
    const message = await webhook.send(buildHoneypotMessage(state.banCount));
    state = {
      schemaVersion: 1,
      webhookId: webhook.id,
      webhookToken: webhook.token,
      messageId: message.id,
      banCount: state.banCount,
    };
    await saveHoneypotState(stateFile, state);
  } catch (error) {
    await webhook.delete("Honeypot announcement failed").catch(() => {});
    throw error;
  }

  const webhookClient = createWebhookClient({ id: state.webhookId, token: state.webhookToken });
  return createHoneypotController(state, stateFile, webhookClient, logger);
}

export async function handleHoneypotMessage(message, options) {
  const {
    channelId,
    clientUserId,
    pendingBans = new Set(),
    onBan,
    logger = console,
  } = options;

  if (message.channelId !== channelId
    || message.webhookId
    || message.system
    || !message.guild
    || !message.author
    || message.author.id === clientUserId
    || pendingBans.has(message.author.id)) return { handled: false };

  pendingBans.add(message.author.id);
  let banned = false;
  try {
    const member = message.member ?? await message.guild.members.fetch(message.author.id);
    await member.ban({
      deleteMessageSeconds: 86_400,
      reason: `${banReason} ${channelId}`,
    });
    banned = true;
    const cleanup = setTimeout(() => pendingBans.delete(message.author.id), 60_000);
    cleanup.unref?.();
    try {
      await onBan?.();
    } catch (error) {
      logger.error("Honeypot ban succeeded, but its displayed count could not be updated.", error);
    }
    logger.log(`Banned Discord member ${message.author.id} for posting in honeypot channel ${channelId}.`);
    return { handled: true, banned: true };
  } catch (error) {
    logger.error(`Could not ban Discord member ${message.author.id} after a honeypot message.`, error);
    return { handled: true, banned: false };
  } finally {
    if (!banned) pendingBans.delete(message.author.id);
  }
}

function createHoneypotController(initialState, stateFile, webhookClient, logger) {
  let state = initialState;
  let updateQueue = Promise.resolve(state.banCount);

  return {
    get banCount() {
      return state.banCount;
    },
    recordBan() {
      updateQueue = updateQueue.then(async () => {
        state = { ...state, banCount: state.banCount + 1 };
        try {
          await saveHoneypotState(stateFile, state);
        } catch (error) {
          logger.error("Could not persist the honeypot ban count.", error);
        }
        try {
          await webhookClient.editMessage(state.messageId, buildHoneypotMessage(state.banCount));
        } catch (error) {
          logger.error("Could not update the honeypot ban-count button.", error);
        }
        return state.banCount;
      });
      return updateQueue;
    },
    destroy() {
      webhookClient.destroy?.();
    },
  };
}

async function removeLegacyHoneypots(channel, clientUser) {
  const webhooks = await channel.fetchWebhooks();
  const staleWebhooks = [...webhooks.values()].filter((webhook) => (
    legacyWebhookNames.has(webhook.name) && webhook.owner?.id === clientUser.id
  ));
  if (staleWebhooks.length === 0) return;

  const staleIds = new Set(staleWebhooks.map((webhook) => webhook.id));
  const messages = await channel.messages.fetch({ limit: 100 });
  for (const message of messages.values()) {
    if (message.webhookId && staleIds.has(message.webhookId)) {
      await message.delete().catch(() => {});
    }
  }
  for (const webhook of staleWebhooks) {
    await webhook.delete("Replacing the sndbox honeypot webhook").catch(() => {});
  }
}

async function loadHoneypotState(path) {
  if (!path) return emptyHoneypotState();
  try {
    const state = JSON.parse(await readFile(path, "utf8"));
    if (state?.schemaVersion !== 1
      || !Number.isSafeInteger(state.banCount)
      || state.banCount < 0
      || !optionalString(state.webhookId)
      || !optionalString(state.webhookToken)
      || !optionalString(state.messageId)) {
      throw new Error("The honeypot state file has an unsupported format.");
    }
    return state;
  } catch (error) {
    if (error?.code === "ENOENT") return emptyHoneypotState();
    throw new Error(`Could not load honeypot state from ${path}: ${error.message}`, { cause: error });
  }
}

async function saveHoneypotState(path, state) {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
}

function emptyHoneypotState() {
  return {
    schemaVersion: 1,
    webhookId: undefined,
    webhookToken: undefined,
    messageId: undefined,
    banCount: 0,
  };
}

function optionalString(value) {
  return value === undefined || (typeof value === "string" && value.length > 0);
}
