// Verification script — run by GitHub Actions twice daily.
// Reads data/pending-domains.json, attempts verification for each domain,
// then writes the updated file back (GitHub Actions commits the change).

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { WebClient } = require('@slack/web-api');
const { verifySite, addOwners } = require('../google/verification');
const { addSiteToGSC, submitSitemap } = require('../google/searchConsole');

const PENDING_FILE = path.resolve(__dirname, '../../data/pending-domains.json');
const MAX_ATTEMPTS = 6; // 3 days at twice-daily checks
const GSC_MANUAL_URL = 'https://search.google.com/search-console';

const SITEMAP_PATHS = (process.env.SITEMAP_PATHS || '/sitemap.xml')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const GSC_OWNER_EMAILS = (process.env.GSC_OWNER_EMAILS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

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

async function notify(slack, channel, threadTs, text) {
  try {
    await slack.chat.postMessage({ channel, thread_ts: threadTs, text });
  } catch (err) {
    console.error(`[notify] Failed to post to Slack thread ${threadTs}:`, err.message);
  }
}

async function processDomain(slack, entry) {
  const { domain, slackChannel: channel, slackThreadTs: threadTs } = entry;
  console.log(`[${domain}] Attempt ${entry.attempts + 1}/${MAX_ATTEMPTS}`);

  try {
    await verifySite(domain);
    console.log(`[${domain}] Verified OK`);
  } catch (err) {
    // Verification failed — increment counter and decide whether to keep retrying.
    entry.attempts += 1;
    console.log(`[${domain}] Verification failed: ${err.message}`);

    if (entry.attempts >= MAX_ATTEMPTS) {
      await notify(
        slack, channel, threadTs,
        `:x: *Verification failed* for *${domain}* after ${MAX_ATTEMPTS} attempts over ~3 days.\nThe meta tag was never detected. Please check manually: ${GSC_MANUAL_URL}`,
      );
      return null; // signal: remove from queue
    }

    await notify(
      slack, channel, threadTs,
      `:arrows_counterclockwise: Verification attempt ${entry.attempts}/${MAX_ATTEMPTS} failed for *${domain}* — meta tag not detected yet.\nWill retry at the next scheduled run (10 AM or 6 PM IST).`,
    );
    return entry; // signal: keep in queue with updated attempts
  }

  // --- Verification succeeded — run post-verification steps ---
  const completed = [];
  const failed = [];

  try {
    await addSiteToGSC(domain);
    completed.push('Registered site in Google Search Console');
  } catch (err) {
    console.error(`[${domain}] addSiteToGSC failed:`, err.message);
    failed.push(`Register GSC property: \`${err.message}\``);
  }

  if (GSC_OWNER_EMAILS.length > 0) {
    try {
      await addOwners(domain, GSC_OWNER_EMAILS);
      completed.push(`Added owners: ${GSC_OWNER_EMAILS.join(', ')}`);
    } catch (err) {
      console.error(`[${domain}] addOwners failed:`, err.message);
      failed.push(`Add owners: \`${err.message}\``);
    }
  }

  for (const sitemapPath of SITEMAP_PATHS) {
    try {
      await submitSitemap(domain, sitemapPath);
      completed.push(`Submitted sitemap: \`${sitemapPath}\``);
    } catch (err) {
      console.error(`[${domain}] submitSitemap(${sitemapPath}) failed:`, err.message);
      failed.push(`Submit \`${sitemapPath}\`: \`${err.message}\``);
    }
  }

  const completedLines = completed.map((s) => `:white_check_mark: ${s}`).join('\n');
  const failedLines = failed.length
    ? '\n\n*Partial failures (manual follow-up needed):*\n' +
      failed.map((s) => `:warning: ${s}`).join('\n')
    : '';

  await notify(
    slack, channel, threadTs,
    `:tada: *GSC onboarding complete for ${domain}*\n\n${completedLines}${failedLines}`,
  );

  return null; // signal: remove from queue
}

async function main() {
  const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
  const entries = readPending();

  if (entries.length === 0) {
    console.log('No pending domains. Exiting.');
    return;
  }

  console.log(`Processing ${entries.length} pending domain(s)...`);
  const remaining = [];

  for (const entry of entries) {
    const result = await processDomain(slack, entry);
    if (result !== null) remaining.push(result);
  }

  writePending(remaining);
  console.log(`Done. ${remaining.length} domain(s) still pending.`);
}

main().catch((err) => {
  console.error('runVerification fatal error:', err);
  process.exit(1);
});
