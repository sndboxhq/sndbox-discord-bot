import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildHoneypotMessage,
  handleHoneypotMessage,
  initializeHoneypot,
} from "../src/honeypot.js";

function buttonFrom(message) {
  return message.components[0].toJSON().components[0];
}

function webhookChannel(overrides = {}) {
  return {
    guild: {
      members: {
        me: { permissions: { has: () => true } },
      },
    },
    permissionsFor: () => ({ has: () => true }),
    fetchWebhooks: async () => new Map(),
    createWebhook: async () => { throw new Error("Unexpected webhook creation"); },
    messages: { fetch: async () => new Map() },
    ...overrides,
  };
}

test("buildHoneypotMessage creates a branded warning and disabled ban counter", () => {
  const message = buildHoneypotMessage(7);
  assert.equal(message.username, "sndbox");
  assert.deepEqual(message.allowedMentions, { parse: [] });

  const embed = message.embeds[0].toJSON();
  assert.equal(embed.color, 0xd6ff4b);
  assert.equal(embed.title, "DO NOT SEND MESSAGES IN THIS CHANNEL");
  assert.match(embed.description, /permanently banned/);
  assert.equal(embed.url, "https://sndbox.app/");
  assert.match(embed.footer.text, /sndbox/);

  const button = buttonFrom(message);
  assert.equal(button.label, "Bans: 7");
  assert.equal(button.disabled, true);
  assert.equal(button.style, 2);
});

test("initializeHoneypot creates the sndbox webhook with its icon and persists count updates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sndbox-honeypot-"));
  const stateFile = join(directory, "honeypot.json");
  const sent = [];
  const edits = [];
  let createOptions;
  const createdWebhook = {
    id: "webhook-1",
    token: "webhook-token",
    send: async (message) => {
      sent.push(message);
      return { id: "message-1" };
    },
    delete: async () => {},
  };
  const channel = webhookChannel({
    createWebhook: async (options) => {
      createOptions = options;
      return createdWebhook;
    },
  });
  const webhookClient = {
    editMessage: async (messageId, message) => edits.push({ messageId, message }),
    destroy: () => {},
  };

  const controller = await initializeHoneypot(channel, { id: "bot-1" }, {
    stateFile,
    createWebhookClient: () => webhookClient,
  });

  assert.equal(createOptions.name, "sndbox");
  assert.ok(Buffer.isBuffer(createOptions.avatar));
  assert.equal(sent.length, 1);
  assert.equal(buttonFrom(sent[0]).label, "Bans: 0");
  assert.equal(controller.banCount, 0);

  assert.equal(await controller.recordBan(), 1);
  assert.equal(edits[0].messageId, "message-1");
  assert.equal(buttonFrom(edits[0].message).label, "Bans: 1");

  const state = JSON.parse(await readFile(stateFile, "utf8"));
  assert.deepEqual(state, {
    schemaVersion: 1,
    webhookId: "webhook-1",
    webhookToken: "webhook-token",
    messageId: "message-1",
    banCount: 1,
  });
});

test("initializeHoneypot reuses the stored message and refreshes its identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sndbox-honeypot-restart-"));
  const stateFile = join(directory, "honeypot.json");
  await writeFile(stateFile, JSON.stringify({
    schemaVersion: 1,
    webhookId: "webhook-1",
    webhookToken: "webhook-token",
    messageId: "message-1",
    banCount: 12,
  }));

  const identities = [];
  const edits = [];
  let credentials;
  const webhookClient = {
    edit: async (identity) => identities.push(identity),
    editMessage: async (messageId, message) => edits.push({ messageId, message }),
    destroy: () => {},
  };
  const controller = await initializeHoneypot(webhookChannel(), { id: "bot-1" }, {
    stateFile,
    createWebhookClient: (value) => {
      credentials = value;
      return webhookClient;
    },
  });

  assert.deepEqual(credentials, { id: "webhook-1", token: "webhook-token" });
  assert.equal(identities[0].name, "sndbox");
  assert.ok(Buffer.isBuffer(identities[0].avatar));
  assert.equal(edits[0].messageId, "message-1");
  assert.equal(buttonFrom(edits[0].message).label, "Bans: 12");
  assert.equal(controller.banCount, 12);
});

test("handleHoneypotMessage bans posters, increments the count, and ignores webhooks", async () => {
  const bans = [];
  const logs = [];
  let countedBans = 0;
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
    onBan: async () => { countedBans += 1; },
    logger: { log: (...args) => logs.push(args), error: (...args) => logs.push(args) },
  };

  assert.deepEqual(await handleHoneypotMessage(baseMessage, options), { handled: true, banned: true });
  assert.equal(bans.length, 1);
  assert.equal(countedBans, 1);
  assert.equal(bans[0].deleteMessageSeconds, 86_400);
  assert.match(bans[0].reason, /honeypot channel/);

  assert.deepEqual(await handleHoneypotMessage({ ...baseMessage, webhookId: "webhook-1" }, options), {
    handled: false,
  });
  assert.equal(bans.length, 1);
  assert.equal(countedBans, 1);
});
