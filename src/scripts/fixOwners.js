// One-off script to add GSC owners to one or more already-verified domains.
// Usage: node src/scripts/fixOwners.js https://www.tours-bogota.com/ https://www.other-site.com/

require('dotenv').config();

const { addOwners } = require('../google/verification');

const domains = process.argv.slice(2);
if (domains.length === 0) {
  console.error('Usage: node src/scripts/fixOwners.js <domain> [domain...]');
  process.exit(1);
}

const emails = (process.env.GSC_OWNER_EMAILS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

if (emails.length === 0) {
  console.error('GSC_OWNER_EMAILS is not set');
  process.exit(1);
}

async function main() {
  let hadFailure = false;
  for (const domain of domains) {
    console.log(`Adding owners to ${domain}:`, emails);
    try {
      await addOwners(domain, emails);
      console.log(`[${domain}] Done.`);
    } catch (err) {
      hadFailure = true;
      console.error(`[${domain}] Failed:`, err.message);
    }
  }
  process.exit(hadFailure ? 1 : 0);
}

main();
