import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";

const embedDescriptionLimit = 3_600;

export function buildReleaseMessage(release) {
  const description = truncate(
    release.body || "No changelog text was provided for this release.",
    embedDescriptionLimit,
  );
  const embed = new EmbedBuilder().setDescription(description);
  const downloadButton = new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setLabel("Download")
    .setURL(findDownloadUrl(release));

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(downloadButton)],
    allowedMentions: { parse: [] },
  };
}

function findDownloadUrl(release) {
  const installer = release.assets.find((asset) => asset.name.toLowerCase().endsWith(".exe"))
    ?? release.assets.find((asset) => asset.name.toLowerCase().endsWith(".msi"));
  return installer?.url ?? release.url;
}

function truncate(value, maximum) {
  if (value.length <= maximum) return value;
  return `${value.slice(0, maximum - 1).trimEnd()}…`;
}
