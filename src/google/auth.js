// Builds and returns an authenticated Google API client using a service account.
// The service account JSON is loaded from GOOGLE_SERVICE_ACCOUNT_JSON (env var)
// so we never store credentials on disk in production.

const { google } = require('googleapis');

const SCOPES = [
  'https://www.googleapis.com/auth/siteverification',
  'https://www.googleapis.com/auth/webmasters',
];

function getAuthClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env variable is not set');
  }

  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON');
  }

  return new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
}

module.exports = { getAuthClient };
