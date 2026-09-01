import assert from "node:assert/strict";
import test from "node:test";
import { buildWelcomeMessage, onboardMember, validateWelcomeRole } from "../src/welcome.js";

test("buildWelcomeMessage creates a branded sndbox embed", () => {
  const message = buildWelcomeMessage();
  assert.equal(message.content, undefined);
  assert.deepEqual(message.allowedMentions, { parse: [] });
  assert.equal(message.embeds.length, 1);

  const embed = message.embeds[0].toJSON();
  assert.equal(embed.color, 0xd6ff4b);
  assert.equal(embed.title, "Welcome to sndbox");
  assert.equal(embed.url, "https://sndbox.app/");
  assert.match(embed.description, /local-first visual workflow automation platform/);
  assert.match(embed.fields[0].value, /https:\/\/sndbox\.app\/downloads/);
  assert.match(embed.fields[0].value, /https:\/\/docs\.sndbox\.app\//);
  assert.match(embed.fields[1].value, /https:\/\/github\.com\/ChristianRelf\/sandbox/);
});

test("validateWelcomeRole accepts only a manageable role below the bot", async () => {
  const role = { id: "1544329194157375569", managed: false, position: 5 };
  const guild = {
    id: "111111111111111111",
    roles: { fetch: async () => role },
    members: {
      me: {
        permissions: { has: () => true },
        roles: { highest: { position: 6 } },
      },
    },
  };
  await validateWelcomeRole(guild, role.id);

  guild.members.me.roles.highest.position = 5;
  await assert.rejects(validateWelcomeRole(guild, role.id), /must be above/);
  guild.members.me.roles.highest.position = 6;
  guild.members.me.permissions.has = () => false;
  await assert.rejects(validateWelcomeRole(guild, role.id), /Manage Roles/);
});

test("onboardMember assigns the configured role and sends the sndbox welcome DM", async () => {
  const assignedRoles = [];
  const messages = [];
  const member = {
    id: "member-1",
    user: { bot: false },
    roles: { add: async (...args) => assignedRoles.push(args) },
    send: async (message) => messages.push(message),
  };

  const result = await onboardMember(member, "1544329194157375569");

  assert.deepEqual(assignedRoles, [["1544329194157375569", "Automatic sndbox member role"]]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].embeds[0].toJSON().title, "Welcome to sndbox");
  assert.deepEqual(result, { skipped: false, roleAssigned: true, messageSent: true });
});

test("onboardMember skips bots and isolates role or DM failures", async () => {
  let botActions = 0;
  const botResult = await onboardMember({
    user: { bot: true },
    roles: { add: async () => { botActions += 1; } },
    send: async () => { botActions += 1; },
  }, "1544329194157375569");
  assert.deepEqual(botResult, { skipped: true });
  assert.equal(botActions, 0);

  const errors = [];
  const memberResult = await onboardMember({
    id: "member-2",
    user: { bot: false },
    roles: { add: async () => {} },
    send: async () => { throw new Error("DMs disabled"); },
  }, "1544329194157375569", { error: (...args) => errors.push(args) });
  assert.deepEqual(memberResult, { skipped: false, roleAssigned: true, messageSent: false });
  assert.equal(errors.length, 1);
});
