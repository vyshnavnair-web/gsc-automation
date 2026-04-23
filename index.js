// Entry point for the GSC onboarding Slack bot (Socket Mode).
// Boots the Slack app and registers slash command handlers.
// Verification is handled separately by src/scripts/runVerification.js via GitHub Actions.

require('dotenv').config();

const { App } = require('@slack/bolt');
const { registerCommands } = require('./src/slack/commands');

const required = [
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET',
  'SLACK_APP_TOKEN',
  'GOOGLE_SERVICE_ACCOUNT_JSON',
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`[startup] Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

registerCommands(app);

process.on('SIGTERM', async () => { await app.stop(); process.exit(0); });
process.on('SIGINT',  async () => { await app.stop(); process.exit(0); });

(async () => {
  await app.start();
  app.logger.info('GSC Automation is running (Socket Mode)');
})().catch((err) => {
  console.error('[startup] Failed to start app:', err);
  process.exit(1);
});
