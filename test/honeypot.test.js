import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHoneypotMessage,
  handleHoneypotMessage,
  initializeHoneypot,
} from "../src/honeypot.js";

test("buildHoneypotMessage creates the branded warning embed", () => {
  const message = buildHoneypotMessage();
  assert.equal(message.username, "sndbox Honeypot");
  assert.deepEqual(message.allowedMentions, { parse: [] });
  const embed = message.embeds[0].toJSON();
  assert.equal(embed.color, 0xd6ff4b);
  assert.equal(embed.title, "DO NOT SEND MESSAGES IN THIS CHANNEL");
  assert.match(embed.description, /permanently banned/);
  assert.equal(embed.url, "https://sndbox.app/");
  assert.match(embed.footer.text, /sndbox/);
});

test("initializeHoneypot creates and announces through one owned webhook", async () => {
  const sent = [];
  const createdWebhook = {
    id: "webhook-1",
    send: async (message) => sent.push(message),
    delete: async () => {},
  };
  let createCount = 0;
  const channel = {
    guild: {
      members: {
        me: { permissions: { has: () => true } },
      },
    },
    permissionsFor: () => ({ has: () => true }),
    fetchWebhooks: async () => new Map(),
    createWebhook: async () => {
      createCount += 1;
      return createdWebhook;
    },
  };

  assert.deepEqual(await initializeHoneypot(channel, { id: "bot-1" }), {
    created: true,
    webhookId: "webhook-1",
  });
  assert.equal(createCount, 1);
  assert.equal(sent.length, 1);

  channel.fetchWebhooks = async () => new Map([["webhook-1", {
    id: "webhook-1",
    name: "sndbox Honeypot",
    owner: { id: "bot-1" },
  }]]);
  assert.deepEqual(await initializeHoneypot(channel, { id: "bot-1" }), {
    created: false,
    webhookId: "webhook-1",
  });
  assert.equal(createCount, 1);
  assert.equal(sent.length, 1);
});

test("handleHoneypotMessage bans posters but ignores webhook messages", async () => {
  const bans = [];
  const logs = [];
  const baseMessage = {
    channelId: "1544427379919954031",
    webhookId: null,
    system: false,
    guild: { members: { fetch: async () => { throw new Error("member should be cached"); } } },
    author: { id: "member-1" },
    member: { ban: async (options) => bans.push(options) },
  };
  const options = {
    channelId: "1544427379919954031",
    clientUserId: "bot-1",
    pendingBans: new Set(),
    logger: { log: (...args) => logs.push(args), error: (...args) => logs.push(args) },
  };

  assert.deepEqual(await handleHoneypotMessage(baseMessage, options), { handled: true, banned: true });
  assert.equal(bans.length, 1);
  assert.equal(bans[0].deleteMessageSeconds, 86_400);
  assert.match(bans[0].reason, /honeypot channel/);

  assert.deepEqual(await handleHoneypotMessage({ ...baseMessage, webhookId: "webhook-1" }, options), {
    handled: false,
  });
  assert.equal(bans.length, 1);
});
