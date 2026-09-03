import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig, parseRepository } from "../src/config.js";

const validEnvironment = {
  DISCORD_TOKEN: "secret",
  DISCORD_CHANNEL_ID: "123456789012345678",
  DISCORD_BETA_ROLE_ID: "223456789012345678",
};

test("parseRepository accepts shorthand and GitHub URLs", () => {
  assert.equal(parseRepository("owner/project").fullName, "owner/project");
  assert.equal(parseRepository("https://github.com/owner/project.git").fullName, "owner/project");
  assert.equal(parseRepository("https://github.com/owner/project.git/").fullName, "owner/project");
});

test("loadConfig supplies safe polling defaults", () => {
  const config = loadConfig(validEnvironment, "C:/bot");
  assert.equal(config.repository.fullName, "ChristianRelf/sandbox");
  assert.equal(config.welcomeRoleId, "1544329194157375569");
  assert.equal(config.honeypotChannelId, "1544427379919954031");
  assert.equal(config.betaChannelId, "123456789012345678");
  assert.equal(config.betaRoleId, "223456789012345678");
  assert.equal(config.pollIntervalMs, 300_000);
  assert.equal(config.includePrereleases, true);
  assert.equal(config.postLatestOnStart, true);
  assert.match(config.honeypotStateFile, /honeypot\.json$/);
  assert.match(config.betaStateFile, /beta\.json$/);
  assert.equal(config.healthFile, undefined);
});

test("loadConfig accepts a separate beta channel and rejects invalid IDs", () => {
  const config = loadConfig({
    ...validEnvironment,
    DISCORD_BETA_CHANNEL_ID: "987654321098765432",
  });
  assert.equal(config.betaChannelId, "987654321098765432");

  assert.throws(() => loadConfig({
    ...validEnvironment,
    DISCORD_BETA_CHANNEL_ID: "not-a-channel",
  }), /17-20 digit Discord channel ID/);
});

test("loadConfig accepts a custom welcome role and rejects invalid role IDs", () => {
  const config = loadConfig({
    ...validEnvironment,
    DISCORD_WELCOME_ROLE_ID: "987654321098765432",
  });
  assert.equal(config.welcomeRoleId, "987654321098765432");

  assert.throws(() => loadConfig({
    ...validEnvironment,
    DISCORD_WELCOME_ROLE_ID: "not-a-role",
  }), /17-20 digit Discord role ID/);
});

test("loadConfig requires a valid beta role", () => {
  const { DISCORD_BETA_ROLE_ID: omitted, ...withoutBetaRole } = validEnvironment;
  assert.throws(() => loadConfig(withoutBetaRole), /DISCORD_BETA_ROLE_ID is required/);
  assert.throws(() => loadConfig({
    ...validEnvironment,
    DISCORD_BETA_ROLE_ID: "not-a-role",
  }), /DISCORD_BETA_ROLE_ID must be a 17-20 digit Discord role ID/);
});

test("loadConfig accepts a custom honeypot channel and rejects invalid channel IDs", () => {
  const config = loadConfig({
    ...validEnvironment,
    DISCORD_HONEYPOT_CHANNEL_ID: "987654321098765432",
  });
  assert.equal(config.honeypotChannelId, "987654321098765432");

  assert.throws(() => loadConfig({
    ...validEnvironment,
    DISCORD_HONEYPOT_CHANNEL_ID: "not-a-channel",
  }), /17-20 digit Discord channel ID/);
});

test("loadConfig rejects polling that would exhaust the GitHub API limit", () => {
  assert.throws(() => loadConfig({
    ...validEnvironment,
    POLL_INTERVAL_SECONDS: "10",
  }), /between 60 and 86400/);
});
