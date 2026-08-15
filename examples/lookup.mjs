// Run after `npm run build`: node examples/lookup.mjs
import { AirClient, ApiError } from '../dist/esm/index.js';

// Auth resolves itself: AIR_API_KEY env, then ~/.config/air/auth.json (written by `air login`
// in any AIR client), then anonymous. Pass { apiKey } to skip that and use a token directly —
// required in the browser, where this SDK never touches the filesystem.
const client = new AirClient();

try {
  const { data: domain } = await client.domain('stripe.com');
  console.log(`${domain.hostname} — AIR ${domain.air_score}/10`);

  if (domain.ai_files.status === 'pending') {
    console.log('still gathering — check back in a minute');
  }

  const { data: results } = await client.search('payment processing');
  console.log(`${results.domains.length} domains matched "payment processing"`);

  const who = await client.user();
  console.log(`logged in as: ${who.name ?? who.email ?? 'anonymous'}`);
} catch (err) {
  if (err instanceof ApiError) {
    console.error(`AIR request failed (${err.status}): ${err.message}`);
    process.exitCode = 1;
  } else {
    throw err;
  }
}
