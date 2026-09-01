import { EmbedBuilder, PermissionFlagsBits } from "discord.js";

const webhookName = "sndbox Honeypot";
const banReason = "Message sent in the sndbox honeypot channel";

export function buildHoneypotMessage() {
  const embed = new EmbedBuilder()
    .setColor(0xd6ff4b)
    .setAuthor({ name: "sndbox security" })
    .setTitle("DO NOT SEND MESSAGES IN THIS CHANNEL")
    .setURL("https://sndbox.app/")
    .setDescription(
      "This channel is an automated honeypot used to catch spam bots. "
      + "Any account that sends a message here will be **permanently banned from the server**.\n\n"
      + "If you are human, do not test it.",
    )
    .addFields({ name: "Protection", value: "Automatic bans are active.", inline: true })
    .setFooter({ text: "sndbox • automated anti-spam" });

  return {
    username: webhookName,
    embeds: [embed],
    allowedMentions: { parse: [] },
  };
}

export async function initializeHoneypot(channel, clientUser) {
  if (!channel.guild || typeof channel.fetchWebhooks !== "function" || typeof channel.createWebhook !== "function") {
    throw new Error("The honeypot channel must be a webhook-capable Discord server channel.");
  }

  const channelPermissions = channel.permissionsFor(clientUser);
  const requiredChannelPermissions = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageWebhooks];
  if (channelPermissions && !channelPermissions.has(requiredChannelPermissions)) {
    throw new Error("The bot needs View Channel and Manage Webhooks permissions in the honeypot channel.");
  }

  const botMember = channel.guild.members.me ?? await channel.guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) {
    throw new Error("The bot is missing the Ban Members permission in the target server.");
  }

  const webhooks = await channel.fetchWebhooks();
  const existing = [...webhooks.values()].find((webhook) => (
    webhook.name === webhookName && webhook.owner?.id === clientUser.id
  ));
  if (existing) return { created: false, webhookId: existing.id };

  const webhook = await channel.createWebhook({
    name: webhookName,
    reason: "sndbox automated anti-spam honeypot",
  });
  try {
    await webhook.send(buildHoneypotMessage());
  } catch (error) {
    await webhook.delete("Honeypot announcement failed").catch(() => {});
    throw error;
  }
  return { created: true, webhookId: webhook.id };
}

export async function handleHoneypotMessage(message, options) {
  const {
    channelId,
    clientUserId,
    pendingBans = new Set(),
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
    logger.log(`Banned Discord member ${message.author.id} for posting in honeypot channel ${channelId}.`);
    return { handled: true, banned: true };
  } catch (error) {
    logger.error(`Could not ban Discord member ${message.author.id} after a honeypot message.`, error);
    return { handled: true, banned: false };
  } finally {
    if (!banned) pendingBans.delete(message.author.id);
  }
}
