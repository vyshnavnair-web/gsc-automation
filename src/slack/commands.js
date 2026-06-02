// Registers all Slack slash command handlers on the given Bolt app instance.
// On /gsc-add: fetches the verification token and commits the domain to
// data/pending-domains.json in the GitHub repo via the GitHub API.

const { Octokit } = require('@octokit/rest');
const { getVerificationToken } = require('../google/verification');

const GITHUB_OWNER = process.env.GITHUB_REPO_OWNER;  // e.g. vyshnavnair-web
const GITHUB_REPO  = process.env.GITHUB_REPO_NAME;   // e.g. gsc-automation
const FILE_PATH    = 'data/pending-domains.json';

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

async function readPendingFromGitHub(octokit) {
  const { data } = await octokit.repos.getContent({
    owner: GITHUB_OWNER,
    repo:  GITHUB_REPO,
    path:  FILE_PATH,
  });
  const content = Buffer.from(data.content, 'base64').toString('utf8');
  return { entries: JSON.parse(content), sha: data.sha };
}

async function writePendingToGitHub(octokit, entries, sha) {
  const content = Buffer.from(JSON.stringify(entries, null, 2)).toString('base64');
  await octokit.repos.createOrUpdateFileContents({
    owner:   GITHUB_OWNER,
    repo:    GITHUB_REPO,
    path:    FILE_PATH,
    message: 'chore: add pending domain [skip ci]',
    content,
    sha,
  });
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

    // Commit the domain to pending-domains.json in the GitHub repo.
    try {
      const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
      const { entries, sha } = await readPendingFromGitHub(octokit);

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
        await writePendingToGitHub(octokit, entries, sha);
        logger.info({ domain }, 'Domain committed to pending-domains.json on GitHub');
      } else {
        await client.chat.postMessage({
          channel: command.channel_id,
          thread_ts: threadTs,
          text: `:information_source: This domain was already in the verification queue. No duplicate added.`,
        });
      }
    } catch (err) {
      logger.error({ err, domain }, 'Failed to commit pending-domains.json to GitHub');
      await client.chat.postMessage({
        channel: command.channel_id,
        thread_ts: threadTs,
        text: `:warning: Could not save domain to the verification queue.\nError: \`${err.message}\``,
      });
    }
  });
}

module.exports = { registerCommands };
