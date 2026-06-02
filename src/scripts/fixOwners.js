// One-off script to add GSC owners to an already-verified domain.
// Usage: node src/scripts/fixOwners.js https://www.tours-bogota.com/

require('dotenv').config();

const { addOwners } = require('../google/verification');

const domain = process.argv[2];
if (!domain) {
  console.error('Usage: node src/scripts/fixOwners.js <domain>');
  process.exit(1);
}

const emails = (process.env.GSC_OWNER_EMAILS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

if (emails.length === 0) {
  console.error('GSC_OWNER_EMAILS is not set');
  process.exit(1);
}

console.log(`Adding owners to ${domain}:`, emails);
addOwners(domain, emails)
  .then(() => console.log('Done.'))
  .catch(err => { console.error('Failed:', err.message); process.exit(1); });
