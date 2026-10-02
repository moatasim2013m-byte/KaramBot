/**
 * Records which Meta app owns each existing number, by asking Meta rather than assuming.
 *
 * `wa_app_id` gates the webhook: a delivery on one app's endpoint is refused for a number
 * another app owns. A wrong value here would silently drop a live number's messages, so
 * the value only ever comes from that WABA's own `subscribed_apps`, and a row whose app
 * cannot be read is left null — which fails open, exactly as before this column was read.
 *
 * Numbers onboarded through Embedded Signup already carry their app id; this is only for
 * the rows that predate it.
 *
 *   DATABASE_URL=... TOKEN_ENCRYPTION_KEY=... node scripts/backfill-wa-app-id.js [--apply]
 *
 * Dry run unless --apply is passed.
 */
const { PrismaClient } = require('@prisma/client');
const { decrypt } = require('../src/utils/tokenCrypto');

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

async function graph(url, token) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || `HTTP ${r.status}`);
  return j;
}

/**
 * Every app subscribed to a WABA, following paging to the end.
 *
 * A single page is not enough to call an owner unambiguous: a second page holding the Tech
 * Provider app would make the first page's legacy app the wrong answer, and writing it would
 * mute that customer on the endpoint that actually serves them.
 */
async function subscribedAppIds(wabaId, token) {
  let url = `https://graph.facebook.com/v23.0/${wabaId}/subscribed_apps?limit=50`;
  const ids = [];
  for (let page = 0; url && page < 20; page += 1) {
    const j = await graph(url, token);
    for (const d of j.data || []) {
      const id = d.whatsapp_business_api_data?.id;
      if (id) ids.push(String(id));
    }
    url = j.paging?.next || null;
  }
  if (url) throw new Error('more pages than expected; refusing to decide');
  return ids;
}

(async () => {
  const rows = await prisma.business.findMany({
    select: {
      id: true, name: true, wa_business_account_id: true,
      wa_phone_number_id: true, wa_app_id: true, wa_access_token: true,
    },
  });

  for (const b of rows) {
    const label = `${b.name} (${b.wa_phone_number_id})`;
    if (b.wa_app_id) { console.log(`skip   ${label} — already ${b.wa_app_id}`); continue; }
    if (!b.wa_business_account_id || b.wa_business_account_id.startsWith('SIM_')) {
      console.log(`skip   ${label} — no real WABA`); continue;
    }

    let token = null;
    try { token = decrypt(b.wa_access_token); } catch { /* reported below */ }
    if (!token) { console.log(`LEAVE  ${label} — no usable token, cannot verify`); continue; }

    let ids;
    try { ids = await subscribedAppIds(b.wa_business_account_id, token); }
    catch (e) { console.log(`LEAVE  ${label} — subscribed_apps failed: ${e.message}`); continue; }

    // Two subscribed apps means the owner is genuinely ambiguous; guessing could mute the number.
    if (ids.length !== 1) {
      console.log(`LEAVE  ${label} — ${ids.length} subscribed apps ${JSON.stringify(ids)}, ambiguous`);
      continue;
    }

    const appId = ids[0];
    if (!APPLY) { console.log(`would  ${label} → ${appId}`); continue; }

    // Conditional on the row still looking the way it did when it was read. Onboarding can
    // finish while this script is talking to Graph, and it writes the authoritative app id;
    // a blind update by id would overwrite that with an answer about the previous WABA and
    // mute the number on the endpoint that now serves it.
    const { count } = await prisma.business.updateMany({
      where: {
        id: b.id,
        wa_app_id: null,
        wa_business_account_id: b.wa_business_account_id,
        wa_phone_number_id: b.wa_phone_number_id,
      },
      data: { wa_app_id: appId },
    });
    if (count === 1) console.log(`SET    ${label} → ${appId}`);
    else console.log(`LEAVE  ${label} — row changed while being read; left to onboarding`);
  }

  await prisma.$disconnect();
})().catch(async (e) => { console.error('FAILED:', e.message); await prisma.$disconnect(); process.exit(1); });
