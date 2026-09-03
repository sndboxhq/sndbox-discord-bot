import { ActivityType, Client, Events, GatewayIntentBits, PermissionFlagsBits } from "discord.js";
import { writeFile } from "node:fs/promises";
import {
  handleBetaInteraction,
  initializeBetaAnnouncement,
  sendBetaReleaseDMs,
} from "./beta.js";
import { buildReleaseMessage } from "./format.js";
import { chooseReleasesToPost, fetchReleases } from "./github.js";
import { handleHoneypotMessage, initializeHoneypot } from "./honeypot.js";
import { loadState, rememberReleases, saveState } from "./state.js";
import { onboardMember, validateWelcomeRole } from "./welcome.js";

export function createBot(config, dependencies = {}) {
  const client = dependencies.client ?? new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages],
  });
  const getReleases = dependencies.fetchReleases ?? fetchReleases;
  let timer;
  let polling = false;
  let stopped = false;
  let targetGuildId;
  let honeypotController;
  let betaController = dependencies.betaController;
  const pendingHoneypotBans = new Set();

  async function poll() {
    if (polling || stopped) return;
    polling = true;
    try {
      const loaded = await loadState(config.stateFile);
      const releases = await getReleases({
        repository: config.repository,
        token: config.githubToken,
        signal: AbortSignal.timeout(15_000),
      });
      const eligible = releases.filter((release) => !release.draft
        && (config.includePrereleases || !release.prerelease));

      if (!loaded.initialized) {
        if (config.postLatestOnStart && eligible.length > 0) {
          const latest = [...eligible]
            .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))[0];
          await postRelease(latest);
        }
        await saveState(config.stateFile, rememberReleases(loaded.value, eligible.map((release) => release.id)));
        return;
      }

      let state = loaded.value;
      const unposted = chooseReleasesToPost(releases, state.postedReleaseIds, {
        includePrereleases: config.includePrereleases,
      });
      for (const release of unposted) {
        await postRelease(release);
        state = rememberReleases(state, [release.id]);
        await saveState(config.stateFile, state);
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Changelog poll failed:`, error);
    } finally {
      polling = false;
    }
  }

  async function postRelease(release) {
    const channel = await fetchTargetChannel();
    await channel.send(buildReleaseMessage(release));
    const subscriberIds = betaController ? await betaController.getSubscriberIds() : [];
    const deliveries = await sendBetaReleaseDMs(client, subscriberIds, release);
    console.log(`[${new Date().toISOString()}] Posted ${release.tag} to channel ${config.channelId}.`);
    if (subscriberIds.length > 0) {
      console.log(`[${new Date().toISOString()}] Sent ${release.tag} to ${deliveries.sent} beta subscriber(s); ${deliveries.failed} failed.`);
    }
  }

  async function fetchTargetChannel() {
    const channel = await client.channels.fetch(config.channelId);
    if (!channel || typeof channel.send !== "function") {
      throw new Error(`Discord channel ${config.channelId} is not a sendable text channel.`);
    }
    if (typeof channel.permissionsFor === "function") {
      const permissions = channel.permissionsFor(client.user);
      const requiredPermissions = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
      ];
      if (permissions && !permissions.has(requiredPermissions)) {
        throw new Error(`The bot is missing required permissions in Discord channel ${config.channelId}.`);
      }
    }
    return channel;
  }

  async function fetchHoneypotChannel() {
    const channel = await client.channels.fetch(config.honeypotChannelId);
    if (!channel || !channel.guild) {
      throw new Error(`Discord honeypot channel ${config.honeypotChannelId} is not a server channel.`);
    }
    return channel;
  }

  async function fetchBetaChannel() {
    const channel = await client.channels.fetch(config.betaChannelId);
    if (!channel || typeof channel.send !== "function" || !channel.guild) {
      throw new Error(`Discord beta channel ${config.betaChannelId} is not a sendable server text channel.`);
    }
    return channel;
  }

  client.once(Events.ClientReady, async (readyClient) => {
    try {
      readyClient.user.setPresence({
        activities: [{ name: "sndbox releases", type: ActivityType.Watching }],
        status: "online",
      });
      const channel = await fetchTargetChannel();
      if (!channel.guild) throw new Error("The changelog channel must belong to a Discord server.");
      await validateWelcomeRole(channel.guild, config.welcomeRoleId);
      targetGuildId = channel.guild.id;
      const betaChannel = config.betaChannelId === config.channelId ? channel : await fetchBetaChannel();
      if (betaChannel.guild.id !== targetGuildId) {
        throw new Error("The changelog and beta channels must belong to the same Discord server.");
      }
      betaController = await initializeBetaAnnouncement(betaChannel, readyClient.user, {
        stateFile: config.betaStateFile,
      });
      const honeypotChannel = await fetchHoneypotChannel();
      if (honeypotChannel.guild.id !== targetGuildId) {
        throw new Error("The changelog and honeypot channels must belong to the same Discord server.");
      }
      honeypotController = await initializeHoneypot(honeypotChannel, readyClient.user, {
        stateFile: config.honeypotStateFile,
      });
      console.log(`Logged in as ${readyClient.user.tag}; watching ${config.repository.fullName}.`);
      await poll();
      if (config.healthFile) await writeFile(config.healthFile, `${new Date().toISOString()}\n`, "utf8");
      if (!stopped) timer = setInterval(() => void poll(), config.pollIntervalMs);
    } catch (error) {
      console.error("Bot startup failed:", error);
      stopped = true;
      client.destroy();
      process.exitCode = 1;
    }
  });
  client.on(Events.GuildMemberAdd, (member) => {
    if (member.guild.id !== targetGuildId) return;
    void onboardMember(member, config.welcomeRoleId);
  });
  client.on(Events.MessageCreate, (message) => {
    void handleHoneypotMessage(message, {
      channelId: config.honeypotChannelId,
      clientUserId: client.user.id,
      pendingBans: pendingHoneypotBans,
      onBan: () => honeypotController?.recordBan(),
    });
  });
  client.on(Events.InteractionCreate, (interaction) => {
    void handleBetaInteraction(interaction, betaController, { guildId: targetGuildId })
      .catch((error) => console.error("Could not handle a beta button interaction:", error));
  });
  client.on(Events.Error, (error) => console.error("Discord client error:", error));

  return {
    async start() {
      await client.login(config.token);
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      honeypotController?.destroy();
      client.destroy();
    },
    poll,
  };
}
