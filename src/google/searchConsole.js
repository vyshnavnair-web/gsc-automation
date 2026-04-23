// Wraps the Google Search Console (Webmasters) API.
// addSiteToGSC() registers the property; submitSitemap() submits a sitemap URL.

const { google } = require('googleapis');
const { getAuthClient } = require('./auth');

function getWebmastersClient() {
  return google.webmasters({ version: 'v3', auth: getAuthClient() });
}

/**
 * Registers a site property in Google Search Console.
 * Safe to call even if the property already exists — GSC ignores duplicates.
 * @param {string} domain - e.g. "https://example.com"
 */
async function addSiteToGSC(domain) {
  const wm = getWebmastersClient();
  await wm.sites.add({ siteUrl: domain });
}

/**
 * Submits a sitemap for an already-registered GSC property.
 * @param {string} domain - e.g. "https://example.com"
 * @param {string} sitemapPath - e.g. "/sitemap.xml"
 */
async function submitSitemap(domain, sitemapPath) {
  const wm = getWebmastersClient();
  // Ensure there's no double-slash when joining domain + path.
  const feedpath = domain.replace(/\/$/, '') + '/' + sitemapPath.replace(/^\//, '');
  await wm.sitemaps.submit({ siteUrl: domain, feedpath });
}

module.exports = { addSiteToGSC, submitSitemap };
