import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  betaJoinButtonId,
  buildBetaAnnouncement,
  buildBetaReleaseMessage,
  handleBetaInteraction,
  initializeBetaAnnouncement,
  sendBetaReleaseDMs,
} from "../src/beta.js";

const botId = "123456789012345678";
const messageId = "223456789012345678";
const firstUserId = "323456789012345678";
const secondUserId = "423456789012345678";

function release() {
  return {
    id: "release-1",
    tag: "v1.2.3-beta.1",
    name: "Beta 1",
    url: "https://github.com/owner/project/releases/tag/v1.2.3-beta.1",
    body: "A useful change",
    publishedAt: "2026-01-01T00:00:00Z",
    draft: false,
    prerelease: true,
    assets: [],
  };
}

function betaChannel(sent, overrides = {}) {
  return {
    guild: { id: "523456789012345678" },
    permissionsFor: () => ({ has: () => true }),
    messages: { fetch: async () => { throw new Error("No stored message"); } },
    send: async (message) => {
      sent.push(message);
      return { id: messageId, delete: async () => {} };
    },
    ...overrides,
  };
}

test("buildBetaAnnouncement creates an interactive Join beta button", () => {
  const message = buildBetaAnnouncement();
  const embed = message.embeds[0].toJSON();
  const button = message.components[0].toJSON().components[0];

  assert.equal(embed.author.name, "sndbox beta");
  assert.equal(embed.title, "Get sndbox releases first");
  assert.match(embed.fields[0].name, /Early access/);
  assert.match(embed.fields[1].value, /DMs/);
  assert.equal(button.custom_id, betaJoinButtonId);
  assert.equal(button.label, "Join beta");
  assert.equal(button.emoji.name, "🧪");
  assert.equal(button.style, 3);
  assert.deepEqual(message.allowedMentions, { parse: [] });
});

test("beta subscribers are saved durably and duplicate joins are idempotent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sndbox-beta-"));
  const stateFile = join(directory, "beta.json");
  const sent = [];
  const controller = await initializeBetaAnnouncement(betaChannel(sent), { id: botId }, { stateFile });

  assert.equal(sent.length, 1);
  assert.equal(await controller.join(firstUserId), true);
  assert.equal(await controller.join(firstUserId), false);
  assert.equal(await controller.join(secondUserId), true);
  assert.deepEqual(await controller.getSubscriberIds(), [firstUserId, secondUserId]);

  assert.deepEqual(JSON.parse(await readFile(stateFile, "utf8")), {
    schemaVersion: 1,
    messageId,
    subscriberIds: [firstUserId, secondUserId],
  });
});

test("stored beta announcement is refreshed without losing subscribers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sndbox-beta-restart-"));
  const stateFile = join(directory, "beta.json");
  const sent = [];
  const firstController = await initializeBetaAnnouncement(betaChannel(sent), { id: botId }, { stateFile });
  await firstController.join(firstUserId);

  const edits = [];
  const secondController = await initializeBetaAnnouncement(betaChannel(sent, {
    messages: {
      fetch: async (id) => ({
        id,
        author: { id: botId },
        edit: async (message) => edits.push(message),
      }),
    },
  }), { id: botId }, { stateFile });

  assert.equal(sent.length, 1);
  assert.equal(edits.length, 1);
  assert.deepEqual(await secondController.getSubscriberIds(), [firstUserId]);
});

test("Join beta interactions subscribe once and reply ephemerally", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sndbox-beta-interaction-"));
  const stateFile = join(directory, "beta.json");
  const controller = await initializeBetaAnnouncement(betaChannel([]), { id: botId }, { stateFile });
  const replies = [];
  const interaction = {
    isButton: () => true,
    customId: betaJoinButtonId,
    guildId: "523456789012345678",
    user: { id: firstUserId, bot: false },
    deferReply: async (options) => replies.push(options),
    editReply: async (message) => replies.push(message),
  };

  assert.deepEqual(await handleBetaInteraction(interaction, controller, {
    guildId: "523456789012345678",
  }), { handled: true, joined: true });
  assert.deepEqual(replies[0], { ephemeral: true });
  assert.match(replies[1], /joined/);

  assert.deepEqual(await handleBetaInteraction(interaction, controller, {
    guildId: "523456789012345678",
  }), { handled: true, joined: false });
  assert.match(replies[3], /already/);
});

test("release DMs reach every available subscriber and isolate failures", async () => {
  const delivered = [];
  const warnings = [];
  const client = {
    users: {
      fetch: async (id) => {
        if (id === secondUserId) throw new Error("DMs closed");
        return { send: async (message) => delivered.push({ id, message }) };
      },
    },
  };

  assert.deepEqual(await sendBetaReleaseDMs(
    client,
    [firstUserId, secondUserId],
    release(),
    { warn: (...args) => warnings.push(args) },
  ), { sent: 1, failed: 1 });
  assert.equal(delivered[0].id, firstUserId);
  assert.equal(delivered[0].message.embeds[0].toJSON().title, "Beta 1");
  assert.equal(warnings.length, 1);

  const message = buildBetaReleaseMessage(release());
  const embed = message.embeds[0].toJSON();
  assert.equal(embed.color, 0xd6ff4b);
  assert.equal(embed.author.name, "sndbox beta • new release");
  assert.equal(embed.fields[0].value, "`v1.2.3-beta.1`");
  assert.equal(message.components[0].toJSON().components[0].label, "Download");
});
