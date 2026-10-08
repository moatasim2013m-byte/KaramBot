'use strict';

const accountEvents = require('../services/accountEvents');

/**
 * Every write to what the bot quotes from (the menu, a clinic's services, doctors and slots) leaves
 * an AccountEvent, so a wrong price the bot later promises a customer can be traced in «السجل» to
 * who changed it and when: the owner, a manager, or SHIFT through ?businessId= from «المعرفة»
 * (docs/panels/spec.md P4, "every change to every shop traceable to a person").
 *
 * One middleware rather than a line in each of the twenty-odd handlers: it wraps res.json and,
 * when a POST/PATCH/PUT/DELETE answers below 400, records `type` with what changed before the
 * answer goes out. Recording never throws (accountEvents.record), so a failed log write never
 * fails the edit itself. `skip(req)` leaves out paths that are not the bot's knowledge (a clinic's
 * appointments are bookings, not catalogue).
 */

const WRITES = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const ACTION_OF = { POST: 'added', PATCH: 'updated', PUT: 'updated', DELETE: 'removed' };

const actorKindOf = (req) => (req.user.role === 'platform_admin' ? 'shift'
  : req.user.role === 'business_owner' ? 'owner' : 'staff');

/**
 * The changed row's name and price, from the handler's own answer ({item: {...}}, {service: {...}},
 * …): «عدّل صنف «شاورما»» says more in the log than an id, and the price is what goes wrong.
 */
function rowIn(body) {
  if (!body || typeof body !== 'object') return {};
  for (const v of Object.values(body)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const name = v.name_ar || v.name || v.name_en;
      if (!name) continue;
      const price = v.price ?? v.price_jod;
      return { name: String(name).slice(0, 120), ...(price != null && Number.isFinite(Number(price)) ? { price: Number(price) } : {}) };
    }
  }
  return {};
}

function recordCatalogChange(type, { skip = () => false } = {}) {
  return (req, res, next) => {
    if (!WRITES.has(req.method) || skip(req)) return next();
    const [what = null, id = null] = req.path.split('/').filter(Boolean);
    const json = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 400 || !req.businessId || !req.user) return json(body);
      accountEvents.record({
        businessId: req.businessId, actorUserId: req.user.id, actorKind: actorKindOf(req), type,
        data: { what, action: ACTION_OF[req.method], id, ...rowIn(body) },
      }).then(() => json(body), () => json(body));
      return res;
    };
    return next();
  };
}

module.exports = { recordCatalogChange, actorKindOf };
