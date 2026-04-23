// BullMQ queue and worker for the 'verify-domain' job.
// The queue is exported so the Slack command handler can enqueue jobs.
// The worker runs in the same process and handles retries internally
// rather than relying on BullMQ's built-in retry — this lets us post
// a Slack update on each attempt and control the exact delay between tries.

const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const { verifySite, addOwners } = require('../google/verification');
const { addSiteToGSC, submitSitemap } = require('../google/searchConsole');

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 3 * 60 * 60 * 1000; // 3 hours
const GSC_MANUAL_URL = 'https://search.google.com/search-console';

// BullMQ requires a dedicated ioredis connection per Queue/Worker instance.
function createRedisConnection() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL env variable is not set');
  return new IORedis(url, { maxRetriesPerRequest: null });
}

const verifyDomainQueue = new Queue('verify-domain', {
  connection: createRedisConnection(),
});

/**
 * Parses and deduplicates a comma-separated env var.
 * Returns an empty array if the variable is unset or blank.
 */
function parseCommaSeparated(envValue) {
  if (!envValue) return [];
  return envValue
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Posts a message to the job's original Slack thread.
 * Never throws — a notification failure should never abort the job.
 */
async function notify(slackClient, channel, threadTs, text, logger) {
  try {
    await slackClient.chat.postMessage({ channel, thread_ts: threadTs, text });
  } catch (err) {
    logger.error({ err }, 'Failed to post Slack notification');
  }
}

/**
 * Creates and starts the BullMQ worker.
 * @param {import('@slack/web-api').WebClient} slackClient
 * @param {object} logger - Bolt app logger (pino-compatible)
 */
function startVerifyDomainWorker(slackClient, logger) {
  const worker = new Worker(
    'verify-domain',
    async (job) => {
      const { domain, channel, threadTs } = job.data;
      logger.info({ jobId: job.id, domain }, 'verify-domain job started');

      await notify(
        slackClient, channel, threadTs,
        `:hourglass_flowing_sand: Verification check starting now for *${domain}*...`,
        logger,
      );

      // --- Retry loop for site verification ---
      let verified = false;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          await verifySite(domain);
          verified = true;
          break;
        } catch (err) {
          logger.warn({ attempt, domain, err: err.message }, 'verifySite attempt failed');

          if (attempt < MAX_ATTEMPTS) {
            await notify(
              slackClient, channel, threadTs,
              `:arrows_counterclockwise: Attempt ${attempt}/${MAX_ATTEMPTS} failed for *${domain}* — the meta tag may not be live yet.\nI'll check again in 3 hours.`,
              logger,
            );
            // Sleep inside the job rather than re-enqueuing, so the thread
            // stays coherent and we don't accumulate stale queue entries.
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          }
        }
      }

      if (!verified) {
        await notify(
          slackClient, channel, threadTs,
          `:x: *Verification failed* for *${domain}* — all 3 attempts over ~12 hours were exhausted and the meta tag was not detected.\nPlease check manually: ${GSC_MANUAL_URL}`,
          logger,
        );
        // Throw so BullMQ records this job as failed.
        throw new Error(`verifySite failed after ${MAX_ATTEMPTS} attempts for ${domain}`);
      }

      // --- Post-verification steps ---
      const ownerEmails = parseCommaSeparated(process.env.GSC_OWNER_EMAILS);
      const sitemapPaths = parseCommaSeparated(process.env.SITEMAP_PATHS);
      const completed = [];
      const failed = [];

      // 1. Register the property in GSC.
      try {
        await addSiteToGSC(domain);
        completed.push('Registered site in Google Search Console');
      } catch (err) {
        logger.error({ err, domain }, 'addSiteToGSC failed');
        failed.push(`Register GSC property: \`${err.message}\``);
      }

      // 2. Add owner accounts.
      if (ownerEmails.length > 0) {
        try {
          await addOwners(domain, ownerEmails);
          completed.push(`Added owners: ${ownerEmails.join(', ')}`);
        } catch (err) {
          logger.error({ err, domain }, 'addOwners failed');
          failed.push(`Add owners: \`${err.message}\``);
        }
      }

      // 3. Submit each sitemap — collect results rather than stopping on first failure.
      for (const path of sitemapPaths) {
        try {
          await submitSitemap(domain, path);
          completed.push(`Submitted sitemap: \`${path}\``);
        } catch (err) {
          logger.error({ err, domain, path }, 'submitSitemap failed');
          failed.push(`Submit \`${path}\`: \`${err.message}\``);
        }
      }

      // 4. Post success summary (with any partial failures noted).
      const completedLines = completed.map((s) => `:white_check_mark: ${s}`).join('\n');
      const failedLines = failed.length
        ? '\n\n*Partial failures (manual follow-up needed):*\n' +
          failed.map((s) => `:warning: ${s}`).join('\n')
        : '';

      await notify(
        slackClient, channel, threadTs,
        `:tada: *GSC onboarding complete for ${domain}*\n\n${completedLines}${failedLines}`,
        logger,
      );

      logger.info({ jobId: job.id, domain }, 'verify-domain job completed');
    },
    {
      connection: createRedisConnection(),
      concurrency: 3,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'verify-domain job permanently failed');
  });

  return worker;
}

module.exports = { verifyDomainQueue, startVerifyDomainWorker };
