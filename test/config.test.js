import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig, parseRepository } from "../src/config.js";

test("parseRepository accepts shorthand and GitHub URLs", () => {
  assert.equal(parseRepository("owner/project").fullName, "owner/project");
  assert.equal(parseRepository("https://github.com/owner/project.git").fullName, "owner/project");
  assert.equal(parseRepository("https://github.com/owner/project.git/").fullName, "owner/project");
});

test("loadConfig supplies safe polling defaults", () => {
  const config = loadConfig({
    DISCORD_TOKEN: "secret",
    DISCORD_CHANNEL_ID: "123456789012345678",
  }, "C:/bot");
  assert.equal(config.repository.fullName, "ChristianRelf/sandbox");
  assert.equal(config.welcomeRoleId, "1544329194157375569");
  assert.equal(config.honeypotChannelId, "1544427379919954031");
  assert.equal(config.pollIntervalMs, 300_000);
  assert.equal(config.includePrereleases, true);
  assert.equal(config.postLatestOnStart, true);
  assert.equal(config.healthFile, undefined);
});

test("loadConfig accepts a custom welcome role and rejects invalid role IDs", () => {
  const config = loadConfig({
    DISCORD_TOKEN: "secret",
    DISCORD_CHANNEL_ID: "123456789012345678",
    DISCORD_WELCOME_ROLE_ID: "987654321098765432",
  });
  assert.equal(config.welcomeRoleId, "987654321098765432");

  assert.throws(() => loadConfig({
    DISCORD_TOKEN: "secret",
    DISCORD_CHANNEL_ID: "123456789012345678",
    DISCORD_WELCOME_ROLE_ID: "not-a-role",
  }), /17-20 digit Discord role ID/);
});

test("loadConfig accepts a custom honeypot channel and rejects invalid channel IDs", () => {
  const config = loadConfig({
    DISCORD_TOKEN: "secret",
    DISCORD_CHANNEL_ID: "123456789012345678",
    DISCORD_HONEYPOT_CHANNEL_ID: "987654321098765432",
  });
  assert.equal(config.honeypotChannelId, "987654321098765432");

  assert.throws(() => loadConfig({
    DISCORD_TOKEN: "secret",
    DISCORD_CHANNEL_ID: "123456789012345678",
    DISCORD_HONEYPOT_CHANNEL_ID: "not-a-channel",
  }), /17-20 digit Discord channel ID/);
});

test("loadConfig rejects polling that would exhaust the GitHub API limit", () => {
  assert.throws(() => loadConfig({
    DISCORD_TOKEN: "secret",
    DISCORD_CHANNEL_ID: "123456789012345678",
    POLL_INTERVAL_SECONDS: "10",
  }), /between 60 and 86400/);
});
