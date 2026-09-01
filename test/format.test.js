import assert from "node:assert/strict";
import test from "node:test";
import { buildReleaseMessage } from "../src/format.js";

const release = {
  id: "42",
  tag: "v1.2.3-beta.1",
  name: "A useful update",
  url: "https://github.com/owner/project/releases/tag/v1.2.3-beta.1",
  body: "- Added a feature\n- Fixed a bug",
  publishedAt: "2026-01-02T12:00:00Z",
  prerelease: true,
  draft: false,
  assets: [{
    name: "installer.exe",
    size: 2_097_152,
    url: "https://github.com/owner/project/releases/download/v1.2.3-beta.1/installer.exe",
  }],
};

test("buildReleaseMessage displays only the changelog and one download button", () => {
  const message = buildReleaseMessage(release);
  assert.deepEqual(Object.keys(message).sort(), ["allowedMentions", "components", "embeds"].sort());
  assert.equal(message.embeds.length, 1);
  assert.deepEqual(message.embeds[0].toJSON(), { description: release.body });
  assert.equal(message.components[0].components.length, 1);
  const button = message.components[0].components[0].toJSON();
  assert.equal(button.type, 2);
  assert.equal(button.style, 5);
  assert.equal(button.label, "Download");
  assert.equal(button.url, release.assets[0].url);
  assert.deepEqual(message.allowedMentions, { parse: [] });
});

test("the download button falls back to the release page without an installer", () => {
  const message = buildReleaseMessage({ ...release, assets: [] });
  assert.equal(message.components[0].components[0].toJSON().url, release.url);
});
