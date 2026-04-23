// Registers all Slack slash command handlers on the given Bolt app instance.
// On /gsc-add: fetches the verification token and saves the domain to
// data/pending-domains.json for the GitHub Actions verification script to pick up.

const fs = require('fs');
const path = require('path');
const { getVerificationToken } = require('../google/verification');

const PENDING_FILE = path.resolve(__dirname, '../../data/pending-domains.json');

function parseUrl(raw) {
  const trimmed = (raw || '').trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return trimmed;
  } catch {
    return null;
  }
}

function readPending() {
  try {
    return JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writePending(entries) {
  fs.writeFileSync(PENDING_FILE, JSON.stringify(entries, null, 2));
}

function registerCommands(app) {
  app.command('/gsc-add', async ({ command, ack, respond, client, logger }) => {
    await ack();

    const domain = parseUrl(command.text);

    if (!domain) {
      await respond({
        response_type: 'ephemeral',
        text: `Invalid URL: \`${command.text || '(empty)'}\`\nUsage: \`/gsc-add https://example.com\``,
      });
      return;
    }

    let token;
    try {
      token = await getVerificationToken(domain);
    } catch (err) {
      logger.error({ err, domain }, 'Failed to fetch verification token');
      await respond({
        response_type: 'ephemeral',
        text: `Could not fetch a verification token for *${domain}* from Google.\nError: \`${err.message}\``,
      });
      return;
    }

    // Post a visible message so we have a thread anchor for all future updates.
    const initial = await client.chat.postMessage({
      channel: command.channel_id,
      text: `GSC onboarding started for *${domain}*`,
    });

    const threadTs = initial.ts;

    await client.chat.postMessage({
      channel: command.channel_id,
      thread_ts: threadTs,
      text: [
        `:white_check_mark: Verification token fetched for *${domain}*`,
        '',
        'Paste this into your *Payload domain document* (inside the `<head>` of the site):',
        '```',
        token,
        '```',
        'The bot will automatically check verification twice a day (10 AM and 6 PM IST) and complete onboarding once the tag is detected.',
      ].join('\n'),
    });

    // Save the domain to pending-domains.json for the verification script.
    try {
      const entries = readPending();
      const alreadyQueued = entries.some((e) => e.domain === domain);
      if (!alreadyQueued) {
        entries.push({
          domain,
          token,
          addedAt: new Date().toISOString(),
          attempts: 0,
          slackChannel: command.channel_id,
          slackThreadTs: threadTs,
        });
        writePending(entries);
        logger.info({ domain }, 'Domain saved to pending-domains.json');
      } else {
        await client.chat.postMessage({
          channel: command.channel_id,
          thread_ts: threadTs,
          text: `:information_source: This domain was already in the verification queue. No duplicate added.`,
        });
      }
    } catch (err) {
      logger.error({ err, domain }, 'Failed to write pending-domains.json');
      await client.chat.postMessage({
        channel: command.channel_id,
        thread_ts: threadTs,
        text: `:warning: Could not save domain to the verification queue.\nError: \`${err.message}\`\nPlease add it manually to \`data/pending-domains.json\`.`,
      });
    }
  });
}

module.exports = { registerCommands };
