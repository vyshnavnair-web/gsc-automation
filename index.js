// Entry point for the GSC onboarding Slack bot (Socket Mode).
// Also starts a minimal HTTP server on PORT for Render's health checks
// and cron-job.org pings (prevents free-tier spin-down).

require('dotenv').config();

const http = require('http');
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

// Minimal HTTP server — Render requires a port to be bound, and cron-job.org
// pings this to keep the free instance from spinning down.
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end();
});

process.on('SIGTERM', async () => {
  server.close();
  await app.stop();
  process.exit(0);
});
process.on('SIGINT', async () => {
  server.close();
  await app.stop();
  process.exit(0);
});

(async () => {
  await app.start();
  server.listen(PORT, () => {
    app.logger.info(`GSC Automation is running (Socket Mode) — HTTP health check on port ${PORT}`);
  });
})().catch((err) => {
  console.error('[startup] Failed to start app:', err);
  process.exit(1);
});
