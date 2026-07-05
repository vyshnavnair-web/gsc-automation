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

// Google's stored identifier doesn't always echo back the exact string we
// submitted (e.g. trailing slash may be added or dropped), so comparisons
// strip it before matching rather than relying on byte-for-byte equality.
function normalizeIdentifier(value) {
  return decodeURIComponent(value).replace(/\/$/, '');
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

  // Retry the list lookup a few times — Google's API has a short propagation
  // delay after verifySite() and the resource may not appear immediately.
  let resource;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const existing = await sv.webResource.list();
    resource = (existing.data.items || []).find((item) => {
      if (!item.site) return false;
      return normalizeIdentifier(item.site.identifier) === normalizeIdentifier(domain);
    });
    if (resource) break;
    if (attempt < 5) await new Promise((r) => setTimeout(r, 5000)); // wait 5s between retries
  }

  if (!resource) {
    throw new Error(`Verified resource not found for ${domain} — cannot add owners`);
  }

  const currentOwners = resource.owners || [];
  const merged = Array.from(new Set([...currentOwners, ...emails]));

  // The googleapis client URL-encodes the id parameter itself, so we must pass
  // the decoded URL — passing resource.id (already encoded) causes double-encoding
  // and a "missing or invalid ID" error from the API.
  await sv.webResource.patch({
    id: decodeURIComponent(resource.id),
    requestBody: {
      site: resource.site,
      owners: merged,
    },
  });
}

module.exports = { getVerificationToken, verifySite, addOwners };
