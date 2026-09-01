import { dirname, resolve } from "node:path";

const discordSnowflake = /^\d{17,20}$/;
const githubName = /^[A-Za-z0-9_.-]+$/;
const defaultWelcomeRoleId = "1544329194157375569";
const defaultHoneypotChannelId = "1544427379919954031";

export function loadConfig(env = process.env, workingDirectory = process.cwd()) {
  const token = required(env, "DISCORD_TOKEN");
  const channelId = required(env, "DISCORD_CHANNEL_ID");
  if (!discordSnowflake.test(channelId)) {
    throw new Error("DISCORD_CHANNEL_ID must be a 17-20 digit Discord channel ID.");
  }
  const welcomeRoleId = env.DISCORD_WELCOME_ROLE_ID?.trim() || defaultWelcomeRoleId;
  if (!discordSnowflake.test(welcomeRoleId)) {
    throw new Error("DISCORD_WELCOME_ROLE_ID must be a 17-20 digit Discord role ID.");
  }
  const honeypotChannelId = env.DISCORD_HONEYPOT_CHANNEL_ID?.trim() || defaultHoneypotChannelId;
  if (!discordSnowflake.test(honeypotChannelId)) {
    throw new Error("DISCORD_HONEYPOT_CHANNEL_ID must be a 17-20 digit Discord channel ID.");
  }

  const repository = parseRepository(env.GITHUB_REPOSITORY ?? "ChristianRelf/sandbox");
  const pollIntervalSeconds = integerInRange(
    env.POLL_INTERVAL_SECONDS ?? "300",
    "POLL_INTERVAL_SECONDS",
    60,
    86_400,
  );
  const stateFile = resolve(workingDirectory, optional(env.STATE_FILE) ?? ".data/state.json");
  const honeypotStateFile = optional(env.HONEYPOT_STATE_FILE)
    ? resolve(workingDirectory, optional(env.HONEYPOT_STATE_FILE))
    : resolve(dirname(stateFile), "honeypot.json");

  return Object.freeze({
    token,
    channelId,
    welcomeRoleId,
    honeypotChannelId,
    repository,
    githubToken: optional(env.GITHUB_TOKEN),
    pollIntervalMs: pollIntervalSeconds * 1_000,
    includePrereleases: boolean(env.INCLUDE_PRERELEASES, true, "INCLUDE_PRERELEASES"),
    postLatestOnStart: boolean(env.POST_LATEST_ON_START, true, "POST_LATEST_ON_START"),
    stateFile,
    honeypotStateFile,
    healthFile: optional(env.HEALTH_FILE)
      ? resolve(workingDirectory, optional(env.HEALTH_FILE))
      : undefined,
  });
}

export function parseRepository(value) {
  const normalized = String(value).trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\/$/, "")
    .replace(/\.git$/i, "");
  const parts = normalized.split("/");
  if (parts.length !== 2 || parts.some((part) => !githubName.test(part))) {
    throw new Error("GITHUB_REPOSITORY must use the owner/repository format.");
  }
  return Object.freeze({ owner: parts[0], name: parts[1], fullName: normalized });
}

function required(env, name) {
  const value = optional(env[name]);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function optional(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

function integerInRange(value, name, minimum, maximum) {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a whole number.`);
  const number = Number(value);
  if (number < minimum || number > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

function boolean(value, fallback, name) {
  if (value === undefined || value.trim() === "") return fallback;
  if (/^(true|1|yes)$/i.test(value)) return true;
  if (/^(false|0|no)$/i.test(value)) return false;
  throw new Error(`${name} must be true or false.`);
}
