# sndbox Discord changelog bot

A small Discord.js bot that watches GitHub Releases. When a new release appears,
it posts:

- the changelog; and
- one download button beneath it.

When a human member joins the server, the bot assigns role
`1544329194157375569` and sends them a welcome DM with server information and
the main sndbox links. Failed DMs are logged without preventing role assignment.

Channel `1544427379919954031` is an automated anti-spam honeypot. On startup,
the bot creates an owned `sndbox Honeypot` webhook and posts a branded warning
embed exactly once. Any non-webhook account that sends a message in that channel
is permanently banned and its messages from the preceding 24 hours are removed.

Posted release IDs are saved in `.data/state.json`, so restarting the bot does
not create duplicate announcements. On a brand-new installation, the current
latest release is posted once by default.

## Set up Discord

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications), then open **Bot** and create its bot user.
2. Copy/reset the bot token. Never commit or share this token.
3. Under **Bot**, enable the privileged **Server Members Intent**. Message Content is not required.
4. Under **Installation**, enable a server/guild install with the `bot` scope.
5. Grant **View Channels**, **Send Messages**, **Embed Links**, **Manage Roles**, **Manage Webhooks**, and **Ban Members**, then use the install link to add the bot to your server.
6. In the server role list, place the bot's role above role `1544329194157375569`; Discord prevents bots from assigning roles above their own.
7. In Discord, enable Developer Mode, right-click the destination channel, and choose **Copy Channel ID**.

The configured welcome role must be an assignable server role, not Discord's
built-in `@everyone` role or a role managed by another integration.
The bot must be able to view the honeypot channel, and its role must sit above
every role whose members it should be able to ban. The honeypot deliberately
does not exempt administrators or human users; nobody should type there.

## Run locally

Node.js 20 or newer is required.

```powershell
cd sndbox-discord-bot
Copy-Item .env.example .env
npm install
```

Edit `.env` with your bot token and channel ID, confirm
`DISCORD_WELCOME_ROLE_ID` and `DISCORD_HONEYPOT_CHANNEL_ID`, then start it:

```powershell
npm start
```

The default repository is `ChristianRelf/sandbox`. Change
`GITHUB_REPOSITORY=owner/repository` to watch another repository. Set an
optional `GITHUB_TOKEN` for a private repository or a higher API rate limit.

## First-run behaviour

`POST_LATEST_ON_START=true` makes setup easy to verify: the newest eligible
release is announced on the first run, then only future releases are posted.
Set it to `false` to silently establish the current release baseline instead.

Pre-releases are included by default because this repository currently ships a
beta. Set `INCLUDE_PRERELEASES=false` to announce only stable releases.

To deliberately re-announce the latest release, stop the bot and remove
`.data/state.json` before starting it again.

## Run with Docker

Build the image and preserve the duplicate-prevention state in a volume:

```powershell
docker build -t discord-changelog-bot .
docker run --env-file .env -v changelog-bot-data:/app/.data discord-changelog-bot
```

For the production-style Compose deployment:

```powershell
Copy-Item .env.example .env
docker compose up -d --wait
```

`compose.yml` deliberately retains the original `sandbox` Compose project,
service, and volume names. Its first deployment therefore takes over the
existing bot container without losing `.data/state.json` or reposting releases.
Set `DISCORD_BOT_IMAGE` in `.env` to deploy a specific immutable image tag.

The process must stay running to detect releases. A small VPS, home server,
container host, or process manager such as systemd/PM2 can keep it online.
The production Compose deployment sets `HEALTH_FILE=/tmp/ready`; the bot creates
that marker only after Discord accepts the login and the configured channel can
be fetched.

## Verify

```powershell
npm test
npm run check
```

The bot polls GitHub every five minutes by default. Polling is intentionally
limited to no faster than once per minute to avoid exhausting GitHub's API rate
limit. If a Discord post fails, that release is not recorded and will be retried
on the next poll.

## Automation

CI runs the tests, syntax checks, and a container build. Pushes to `main` and
version tags publish signed, attested multi-architecture images to this
repository's GitHub Container Registry package.

The manual **Deploy DigitalOcean** workflow uses the `digitalocean-beta`
environment. Configure `DROPLET_HOST`, `DROPLET_SSH_PRIVATE_KEY`,
`DROPLET_SSH_KNOWN_HOSTS`, and `DISCORD_BOT_TOKEN` as environment secrets, plus
`DISCORD_CHANNEL_ID` as a secret or variable. It deploys only this bot and does
not modify the website, account service, or proxy.
