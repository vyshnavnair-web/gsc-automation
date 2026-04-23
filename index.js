// Entry point for the GSC onboarding automation.
// Boot order: env validation → Slack Bolt app (Socket Mode) → BullMQ worker.

require('dotenv').config();

const { App } = require('@slack/bolt');
const { registerCommands } = require('./src/slack/commands');
const { startVerifyDomainWorker } = require('./src/jobs/verifyDomain');

const required = [
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET',
  'SLACK_APP_TOKEN',
  'GOOGLE_SERVICE_ACCOUNT_JSON',
  'REDIS_URL',
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`[startup] Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  // Socket Mode keeps us behind a firewall — no public HTTP endpoint needed.
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

// Register slash command handlers.
registerCommands(app);

// Start the BullMQ worker, giving it the Bolt-managed Slack client so it can
// post messages back into threads when delayed jobs fire.
const worker = startVerifyDomainWorker(app.client, app.logger);

// Graceful shutdown: let in-flight jobs finish before exiting.
async function shutdown(signal) {
  app.logger.info(`Received ${signal}, shutting down gracefully...`);
  await worker.close();
  await app.stop();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

(async () => {
  await app.start();
  app.logger.info('GSC Automation is running (Socket Mode)');
})().catch((err) => {
  console.error('[startup] Failed to start app:', err);
  process.exit(1);
});
