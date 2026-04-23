// Wraps the Google Site Verification API.
// Three operations: fetch a token, verify a site, add owner accounts.

const { google } = require('googleapis');
const { getAuthClient } = require('./auth');

function getSiteVerificationClient() {
  return google.siteVerification({ version: 'v1', auth: getAuthClient() });
}

/**
 * Fetches the HTML meta tag token for a domain.
 * @param {string} domain - e.g. "https://example.com"
 * @returns {Promise<string>} Raw meta tag string from Google
 */
async function getVerificationToken(domain) {
  const sv = getSiteVerificationClient();
  const response = await sv.webResource.getToken({
    requestBody: {
      site: { type: 'SITE', identifier: domain },
      verificationMethod: 'META',
    },
  });
  return response.data.token;
}

/**
 * Submits META verification for a domain that already has the tag live.
 * @param {string} domain
 * @returns {Promise<true>} Resolves true on success, throws on failure.
 */
async function verifySite(domain) {
  const sv = getSiteVerificationClient();
  await sv.webResource.insert({
    verificationMethod: 'META',
    requestBody: {
      site: { type: 'SITE', identifier: domain },
    },
  });
  return true;
}

/**
 * Adds email addresses as owners of an already-verified site resource.
 * Reads the current owners list first to avoid clobbering existing owners.
 * @param {string} domain
 * @param {string[]} emails
 */
async function addOwners(domain, emails) {
  if (!emails || emails.length === 0) return;

  const sv = getSiteVerificationClient();

  // Fetch the current resource so we can merge rather than overwrite.
  const existing = await sv.webResource.list();
  const resource = (existing.data.items || []).find(
    (item) => item.site && item.site.identifier === domain,
  );

  if (!resource) {
    throw new Error(`Verified resource not found for ${domain} — cannot add owners`);
  }

  const currentOwners = resource.owners || [];
  const merged = Array.from(new Set([...currentOwners, ...emails]));

  await sv.webResource.patch({
    id: resource.id,
    requestBody: {
      ...resource,
      owners: merged,
    },
  });
}

module.exports = { getVerificationToken, verifySite, addOwners };
