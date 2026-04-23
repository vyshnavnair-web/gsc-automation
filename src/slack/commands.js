// Registers all Slack slash command handlers on the given Bolt app instance.
// Currently handles: /gsc-add <domain>

const { getVerificationToken } = require('../google/verification');
const { verifyDomainQueue } = require('../jobs/verifyDomain');

const DELAY_MS = 5.5 * 60 * 60 * 1000; // 5.5 hours

/**
 * Validates that a string is an absolute HTTP/HTTPS URL.
 * Returns a normalized URL string, or null if invalid.
 */
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

function registerCommands(app) {
  app.command('/gsc-add', async ({ command, ack, respond, client, logger }) => {
    // Acknowledge the command immediately — Slack requires a response within 3 s.
    await ack();

    const domain = parseUrl(command.text);

    if (!domain) {
      await respond({
        response_type: 'ephemeral',
        text: `Invalid URL: \`${command.text || '(empty)'}\`\nUsage: \`/gsc-add https://example.com\``,
      });
      return;
    }

    let metaTag;
    try {
      metaTag = await getVerificationToken(domain);
    } catch (err) {
      logger.error({ err, domain }, 'Failed to fetch verification token');
      await respond({
        response_type: 'ephemeral',
        text: `Could not fetch a verification token for *${domain}* from Google. Check that the service account has Site Verification API access.\nError: \`${err.message}\``,
      });
      return;
    }

    // Post a visible message in the channel so we have a thread to reply to.
    const initial = await client.chat.postMessage({
      channel: command.channel_id,
      text: `GSC onboarding started for *${domain}*`,
    });

    const threadTs = initial.ts;

    // Reply inside that thread with the meta tag and instructions.
    await client.chat.postMessage({
      channel: command.channel_id,
      thread_ts: threadTs,
      text: [
        `:white_check_mark: Verification token fetched for *${domain}*`,
        '',
        'Paste this into your *Payload domain document* (inside the `<head>` of the site):',
        '```',
        metaTag,
        '```',
        `Google will automatically verify the domain and add owners in *~5.5 hours*. Make sure the tag is live before then.`,
      ].join('\n'),
    });

    // Enqueue the delayed verification job.
    try {
      await verifyDomainQueue.add(
        'verify-domain',
        { domain, channel: command.channel_id, threadTs },
        { delay: DELAY_MS },
      );
      logger.info({ domain, delayMs: DELAY_MS }, 'verify-domain job enqueued');
    } catch (err) {
      logger.error({ err, domain }, 'Failed to enqueue verify-domain job');
      await client.chat.postMessage({
        channel: command.channel_id,
        thread_ts: threadTs,
        text: `:warning: Could not schedule the automatic verification job. Please manually trigger verification later.\nError: \`${err.message}\``,
      });
    }
  });
}

module.exports = { registerCommands };
