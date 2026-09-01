import { PermissionFlagsBits } from "discord.js";

const welcomeMessage = `Welcome to the sndbox server!

sndbox is a local-first visual workflow automation platform. Use this server to follow releases, ask for help, share feedback, and connect with other sndbox users.

Useful links:
• Website: https://sndbox.app/
• Download: https://sndbox.app/downloads
• Documentation: https://docs.sndbox.app/
• Changelog: https://sndbox.app/changelog
• GitHub: https://github.com/ChristianRelf/sandbox

Please review the server rules, then make yourself at home.`;

export function buildWelcomeMessage() {
  return {
    content: welcomeMessage,
    allowedMentions: { parse: [] },
  };
}

export async function validateWelcomeRole(guild, roleId) {
  const role = await guild.roles.fetch(roleId);
  if (!role) throw new Error(`Discord welcome role ${roleId} does not exist in the target server.`);
  if (role.id === guild.id) {
    throw new Error("Discord's built-in @everyone role cannot be assigned; configure a separate member role.");
  }
  if (role.managed) throw new Error(`Discord welcome role ${roleId} is managed by an integration and cannot be assigned.`);

  const botMember = guild.members.me ?? await guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error("The bot is missing the Manage Roles permission in the target server.");
  }
  if (role.position >= botMember.roles.highest.position) {
    throw new Error("The bot's role must be above the configured welcome role in the server role list.");
  }
}

export async function onboardMember(member, roleId, logger = console) {
  if (member.user?.bot) return { skipped: true };

  const [roleResult, messageResult] = await Promise.allSettled([
    member.roles.add(roleId, "Automatic sndbox member role"),
    member.send(buildWelcomeMessage()),
  ]);

  if (roleResult.status === "rejected") {
    logger.error(`Could not assign the welcome role to Discord member ${member.id}.`, roleResult.reason);
  }
  if (messageResult.status === "rejected") {
    logger.error(`Could not send a welcome DM to Discord member ${member.id}.`, messageResult.reason);
  }

  return {
    skipped: false,
    roleAssigned: roleResult.status === "fulfilled",
    messageSent: messageResult.status === "fulfilled",
  };
}
