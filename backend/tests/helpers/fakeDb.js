'use strict';

/**
 * In-memory database for layer-2/3 tests (pr1-contracts §2.2).
 *
 * One store backs both a fake PrismaClient and a fake db/jsonb, so a test can drive the real batcher,
 * sweeper or inbox route and see the same interleavings production would (a lease written through
 * jsonb is visible to prisma.conversation.findUnique, a staff send's metadata key survives a sweeper
 * claim, …) without any SQL.
 *
 * Usage (a per-test-file singleton — Jest shares the registry inside one file; never resetModules):
 *   jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
 *   jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
 *   const db = require('./helpers/fakeDb').getFakeDb();
 *   beforeEach(() => db.reset());
 */

const TABLES = ['conversations'];
const COLUMNS = ['workflow_data', 'metadata'];
const LEASE_TTL_MS = 60000;

const RAW_SQL_ERROR = 'fakeDb: raw SQL is only allowed inside db/jsonb.js';

// Prisma model name → store key.
const MODELS = {
  business: 'businesses',
  conversation: 'conversations',
  message: 'messages',
  user: 'users',
  order: 'orders',
};

// Relations that routes ask for with `include`.
const RELATIONS = {
  assigned_staff: { store: 'users', fk: 'assigned_staff_id' },
  sent_by_user: { store: 'users', fk: 'sent_by_user_id' },
  business: { store: 'businesses', fk: 'business_id' },
  conversation: { store: 'conversations', fk: 'conversation_id' },
};

const DATE_FIELDS = new Set(['created_at', 'updated_at', 'last_message_at', 'last_inbound_at', 'last_login']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

// Hand-rolled deep clone: structuredClone would build Dates from Node's realm, and `instanceof Date`
// inside Jest's sandbox would then be false.
function clone(v) {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Date) return new Date(v.getTime());
  if (Array.isArray(v)) return v.map(clone);
  const out = {};
  for (const [k, val] of Object.entries(v)) out[k] = clone(val);
  return out;
}

function prismaError(code, message) {
  return Object.assign(new Error(message), { code });
}

// Postgres refuses U+0000 in text (22021) and in jsonb (22P05); Prisma surfaces it as an error without a P-code.
// The fake used to store it, hiding a message that could never be persisted (tests/integration/pg.test.js).
function hasNul(v) {
  if (typeof v === 'string') return v.includes(String.fromCharCode(0));
  if (Array.isArray(v)) return v.some(hasNul);
  if (isPlainObject(v)) return Object.entries(v).some(([k, val]) => hasNul(k) || hasNul(val));
  return false;
}

function rejectNul(data) {
  if (hasNul(data)) throw new Error('fakeDb: invalid byte sequence for encoding "UTF8": 0x00 (Postgres 22021/22P05)');
}

function createFakeDb() {
  const store = { businesses: [], conversations: [], messages: [], users: [], orders: [] };
  let fixedNow = null;
  let idSeq = 0;
  const failures = new Map();

  const clock = {
    now() {
      return fixedNow === null ? new Date() : new Date(fixedNow);
    },
    set(value) {
      fixedNow = value === null || value === undefined ? null : new Date(value).getTime();
    },
    advance(ms) {
      const base = fixedNow === null ? Date.now() : fixedNow;
      fixedNow = base + ms;
    },
  };

  function nextId() {
    idSeq += 1;
    return `cfake${idSeq.toString(36).padStart(6, '0')}`;
  }

  function failNext(key, err) {
    if (!failures.has(key)) failures.set(key, []);
    failures.get(key).push(err || new Error(`fakeDb: injected failure for ${key}`));
  }

  // Throws the queued error for this call, if any (one-shot, FIFO).
  function checkFailure(key) {
    const queue = failures.get(key);
    if (queue && queue.length) {
      const err = queue.shift();
      if (!queue.length) failures.delete(key);
      throw err;
    }
  }

  // ─── Defaults (mirror prisma/schema.prisma) ───────────────────────────────

  function withDefaults(storeKey, data) {
    const now = clock.now();
    const id = data.id || nextId();
    const common = { id, created_at: now, updated_at: now };
    let defaults;
    switch (storeKey) {
      case 'businesses':
        defaults = {
          name: 'Test business', slug: id, business_type: 'restaurant', logo_url: null,
          language_default: 'ar', timezone: 'Asia/Amman', currency: 'JOD', address: null,
          wa_phone_number_id: `pnid_${id}`, wa_business_account_id: null, wa_access_token: null,
          opening_hours: [], status: 'active', ai_config: {}, policies: {},
        };
        break;
      case 'conversations':
        defaults = {
          business_id: null, customer_wa_id: null, profile_name: null, status: 'open',
          assigned_staff_id: null, last_message_at: now, last_inbound_at: null, unread_count: 0,
          ai_enabled: true, current_workflow_type: null, current_state: null,
          workflow_data: {}, metadata: {},
        };
        break;
      case 'messages':
        defaults = {
          business_id: null, conversation_id: null, meta_message_id: null, direction: 'inbound',
          message_type: 'text', text_body: null, media_id: null, media_mime_type: null, media_url: null,
          interactive_reply: null, location: null, status: 'pending', sender_wa_id: null,
          sent_by_user_id: null, is_ai_generated: false, raw_payload: null,
        };
        break;
      case 'users':
        defaults = {
          name: 'Staff', email: `${id}@test.local`, password: '', role: 'staff', business_id: null,
          active: true, last_login: null,
        };
        break;
      default:
        defaults = {};
    }
    const row = { ...common, ...defaults, ...clone(data), id };
    for (const f of DATE_FIELDS) {
      if (row[f] !== null && row[f] !== undefined && !(row[f] instanceof Date)) row[f] = new Date(row[f]);
    }
    return row;
  }

  // ─── where / orderBy ──────────────────────────────────────────────────────

  function comparable(v) {
    if (v instanceof Date) return v.getTime();
    return v;
  }

  // Coerce the filter operand to the row value's type so `created_at: {gt: '2026-…'}` works like Prisma.
  function operand(rowValue, filterValue) {
    if (rowValue instanceof Date && filterValue !== null && filterValue !== undefined) {
      return new Date(filterValue).getTime();
    }
    return comparable(filterValue);
  }

  function equals(rowValue, filterValue) {
    if (filterValue === null) return rowValue === null || rowValue === undefined;
    if (rowValue === null || rowValue === undefined) return false;
    return comparable(rowValue) === operand(rowValue, filterValue);
  }

  const OPERATORS = new Set(['mode', 'equals', 'in', 'notIn', 'not', 'lt', 'lte', 'gt', 'gte', 'contains', 'startsWith', 'endsWith']);

  // Checked up front so a forbidden filter fails even when the table is empty.
  function validateWhere(where) {
    if (!where) return;
    for (const [key, cond] of Object.entries(where)) {
      if (key === 'OR' || key === 'AND' || key === 'NOT') {
        (Array.isArray(cond) ? cond : [cond]).forEach(validateWhere);
      } else if (key === 'business_id_customer_wa_id') {
        validateWhere(cond);
      } else if (isPlainObject(cond)) {
        for (const op of Object.keys(cond)) {
          // JSON-path filters and relation filters are not allowed by the contract (§2.1).
          if (!OPERATORS.has(op)) throw new Error(`fakeDb: unsupported where operator "${op}" on ${key}`);
          if (op === 'not' && isPlainObject(cond.not)) validateWhere({ [key]: cond.not });
        }
      }
    }
  }

  function matchField(row, field, cond) {
    const value = row[field];
    if (!isPlainObject(cond)) return equals(value, cond);

    const insensitive = cond.mode === 'insensitive';
    for (const [op, arg] of Object.entries(cond)) {
      switch (op) {
        case 'mode':
          break;
        case 'equals':
          if (!equals(value, arg)) return false;
          break;
        case 'in':
          if (value === null || value === undefined) return false;
          if (!arg.some((a) => equals(value, a))) return false;
          break;
        case 'notIn':
          if (value === null || value === undefined) return false;
          if (arg.some((a) => equals(value, a))) return false;
          break;
        case 'not':
          if (arg === null) {
            if (value === null || value === undefined) return false;
          } else if (isPlainObject(arg)) {
            if (matchField(row, field, arg)) return false;
          } else if (value === null || value === undefined || equals(value, arg)) {
            // SQL semantics: `col <> x` never matches NULL.
            return false;
          }
          break;
        case 'lt': case 'lte': case 'gt': case 'gte': {
          if (value === null || value === undefined || arg === null || arg === undefined) return false;
          const a = comparable(value);
          const b = operand(value, arg);
          if (op === 'lt' && !(a < b)) return false;
          if (op === 'lte' && !(a <= b)) return false;
          if (op === 'gt' && !(a > b)) return false;
          if (op === 'gte' && !(a >= b)) return false;
          break;
        }
        case 'contains': case 'startsWith': case 'endsWith': {
          if (typeof value !== 'string') return false;
          const hay = insensitive ? value.toLowerCase() : value;
          const needle = insensitive ? String(arg).toLowerCase() : String(arg);
          if (op === 'contains' && !hay.includes(needle)) return false;
          if (op === 'startsWith' && !hay.startsWith(needle)) return false;
          if (op === 'endsWith' && !hay.endsWith(needle)) return false;
          break;
        }
        default:
          throw new Error(`fakeDb: unsupported where operator "${op}" on ${field}`);
      }
    }
    return true;
  }

  function matches(row, where) {
    if (!where) return true;
    for (const [key, cond] of Object.entries(where)) {
      if (cond === undefined) continue;
      if (key === 'OR') {
        if (!cond.some((w) => matches(row, w))) return false;
      } else if (key === 'AND') {
        const list = Array.isArray(cond) ? cond : [cond];
        if (!list.every((w) => matches(row, w))) return false;
      } else if (key === 'NOT') {
        const list = Array.isArray(cond) ? cond : [cond];
        if (list.some((w) => matches(row, w))) return false;
      } else if (key === 'business_id_customer_wa_id' && isPlainObject(cond)) {
        if (!matches(row, cond)) return false;
      } else if (!matchField(row, key, cond)) {
        return false;
      }
    }
    return true;
  }

  // Postgres order: NULLs last for ASC, first for DESC; ties keep insertion order (ASC) or newest first (DESC).
  function sortRows(rows, orderBy) {
    if (!orderBy) return rows;
    const specs = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) => Object.entries(o));
    const indexed = rows.map((row, i) => ({ row, i }));
    indexed.sort((x, y) => {
      for (const [field, dir] of specs) {
        const desc = dir === 'desc';
        const a = x.row[field];
        const b = y.row[field];
        const aNull = a === null || a === undefined;
        const bNull = b === null || b === undefined;
        if (aNull || bNull) {
          if (aNull && bNull) continue;
          return (aNull ? 1 : -1) * (desc ? -1 : 1);
        }
        const ca = comparable(a);
        const cb = comparable(b);
        if (ca < cb) return desc ? 1 : -1;
        if (ca > cb) return desc ? -1 : 1;
      }
      const lastDesc = specs.length && specs[specs.length - 1][1] === 'desc';
      return lastDesc ? y.i - x.i : x.i - y.i;
    });
    return indexed.map((e) => e.row);
  }

  // Prisma returns only the selected scalar fields (plus selected relations); code that reads a field it did not
  // select gets undefined on Postgres. The fake used to ignore `select` and hide such reads.
  function project(row, include, selectSpec) {
    if (isPlainObject(selectSpec)) {
      const picked = {};
      const relations = {};
      for (const [k, on] of Object.entries(selectSpec)) {
        if (!on) continue;
        if (RELATIONS[k]) relations[k] = on;
        else picked[k] = clone(row[k]);
      }
      return Object.keys(relations).length ? { ...picked, ...projectRelations(row, relations) } : picked;
    }
    return { ...clone(row), ...(include ? projectRelations(row, include) : {}) };
  }

  function projectRelations(row, include) {
    const out = {};
    if (include) {
      for (const [name, spec] of Object.entries(include)) {
        const rel = RELATIONS[name];
        if (!rel || !spec) continue;
        const target = row[rel.fk] ? store[rel.store].find((r) => r.id === row[rel.fk]) : null;
        if (!target) {
          out[name] = null;
        } else if (isPlainObject(spec) && isPlainObject(spec.select)) {
          out[name] = {};
          for (const [k, on] of Object.entries(spec.select)) if (on) out[name][k] = clone(target[k]);
        } else {
          out[name] = clone(target);
        }
      }
    }
    return out;
  }

  // ─── writes ───────────────────────────────────────────────────────────────

  function applyData(row, data) {
    for (const [key, value] of Object.entries(data || {})) {
      if (value === undefined) continue;
      if (isPlainObject(value) && ('increment' in value || 'decrement' in value || 'set' in value)
        && Object.keys(value).every((k) => ['increment', 'decrement', 'set'].includes(k))) {
        if ('set' in value) row[key] = clone(value.set);
        if ('increment' in value) row[key] = (Number(row[key]) || 0) + value.increment;
        if ('decrement' in value) row[key] = (Number(row[key]) || 0) - value.decrement;
      } else {
        row[key] = clone(value);
      }
      if (DATE_FIELDS.has(key) && row[key] !== null && !(row[key] instanceof Date)) row[key] = new Date(row[key]);
    }
  }

  function checkUnique(storeKey, candidate, selfRow) {
    const rows = store[storeKey];
    if (storeKey === 'messages' && candidate.meta_message_id) {
      if (rows.some((r) => r !== selfRow && r.meta_message_id === candidate.meta_message_id)) {
        throw prismaError('P2002', 'Unique constraint failed on the fields: (`meta_message_id`)');
      }
    }
    if (storeKey === 'conversations' && candidate.business_id && candidate.customer_wa_id) {
      if (rows.some((r) => r !== selfRow && r.business_id === candidate.business_id
        && r.customer_wa_id === candidate.customer_wa_id)) {
        throw prismaError('P2002', 'Unique constraint failed on the fields: (`business_id`,`customer_wa_id`)');
      }
    }
  }

  function makeModel(modelName) {
    const storeKey = MODELS[modelName];
    const rows = () => store[storeKey];
    const guard = (method) => checkFailure(`${modelName}.${method}`);

    function select(args = {}) {
      validateWhere(args.where);
      let result = sortRows(rows().filter((r) => matches(r, args.where)), args.orderBy);
      if (args.skip) result = result.slice(args.skip);
      if (args.take !== undefined && args.take !== null) {
        result = args.take >= 0 ? result.slice(0, args.take) : result.slice(args.take);
      }
      return result;
    }

    return {
      async findUnique(args = {}) {
        guard('findUnique');
        validateWhere(args.where);
        const row = rows().find((r) => matches(r, args.where));
        return row ? project(row, args.include, args.select) : null;
      },
      async findFirst(args = {}) {
        guard('findFirst');
        const [row] = select({ ...args, take: 1 });
        return row ? project(row, args.include, args.select) : null;
      },
      async findMany(args = {}) {
        guard('findMany');
        return select(args).map((r) => project(r, args.include, args.select));
      },
      async count(args = {}) {
        guard('count');
        validateWhere(args.where);
        return rows().filter((r) => matches(r, args.where)).length;
      },
      async create(args = {}) {
        guard('create');
        rejectNul(args.data);
        const row = withDefaults(storeKey, args.data || {});
        checkUnique(storeKey, row, null);
        rows().push(row);
        return project(row, args.include, args.select);
      },
      async update(args = {}) {
        guard('update');
        rejectNul(args.data);
        validateWhere(args.where);
        const row = rows().find((r) => matches(r, args.where));
        if (!row) throw prismaError('P2025', 'Record to update not found.');
        const next = { ...row };
        applyData(next, args.data);
        checkUnique(storeKey, next, row);
        Object.assign(row, next, { updated_at: clock.now() });
        return project(row, args.include, args.select);
      },
      async updateMany(args = {}) {
        guard('updateMany');
        rejectNul(args.data);
        validateWhere(args.where);
        const targets = rows().filter((r) => matches(r, args.where));
        for (const row of targets) {
          const next = { ...row };
          applyData(next, args.data);
          checkUnique(storeKey, next, row);
          Object.assign(row, next, { updated_at: clock.now() });
        }
        return { count: targets.length };
      },
    };
  }

  /**
   * Interactive transaction client. Postgres rolls a failed transaction back and D24 (persistInbound)
   * relies on it, so every write made through `tx` is journalled and undone if the callback throws.
   * No isolation: other code sees the writes before the commit (enough for the single-writer tests).
   * Methods are looked up on `prisma` at call time, so jest spies and failNext still apply inside a tx.
   */
  function txClient(journal) {
    const tx = {};
    for (const name of Object.keys(MODELS)) {
      const storeKey = MODELS[name];
      const snapshotWhere = (where) => store[storeKey].filter((r) => matches(r, where)).map((r) => ({ id: r.id, before: clone(r) }));
      tx[name] = {
        findUnique: (a) => prisma[name].findUnique(a),
        findFirst: (a) => prisma[name].findFirst(a),
        findMany: (a) => prisma[name].findMany(a),
        count: (a) => prisma[name].count(a),
        async create(a) {
          const created = await prisma[name].create(a);
          journal.push(() => {
            const i = store[storeKey].findIndex((r) => r.id === created.id);
            if (i >= 0) store[storeKey].splice(i, 1);
          });
          return created;
        },
        async update(a) {
          const before = snapshotWhere(a && a.where).slice(0, 1);
          const out = await prisma[name].update(a);
          journal.push(() => restoreRows(storeKey, before));
          return out;
        },
        async updateMany(a) {
          const before = snapshotWhere(a && a.where);
          const out = await prisma[name].updateMany(a);
          journal.push(() => restoreRows(storeKey, before));
          return out;
        },
      };
    }
    return tx;
  }

  function restoreRows(storeKey, snapshots) {
    for (const { id, before } of snapshots) {
      const row = store[storeKey].find((r) => r.id === id);
      if (!row) continue;
      for (const k of Object.keys(row)) delete row[k];
      Object.assign(row, clone(before));
    }
  }

  const prisma = {
    $transaction(arg) {
      checkFailure('$transaction');
      if (Array.isArray(arg)) return Promise.all(arg);
      if (typeof arg === 'function') {
        const journal = [];
        return Promise.resolve()
          .then(() => arg(txClient(journal)))
          .catch((err) => {
            for (const undo of journal.reverse()) undo();
            throw err;
          });
      }
      throw new Error('fakeDb: $transaction expects an array or a function');
    },
    $executeRaw() { throw new Error(RAW_SQL_ERROR); },
    $queryRaw() { throw new Error(RAW_SQL_ERROR); },
    $executeRawUnsafe() { throw new Error(RAW_SQL_ERROR); },
    $queryRawUnsafe() { throw new Error(RAW_SQL_ERROR); },
    async $connect() {},
    async $disconnect() {},
  };
  for (const name of Object.keys(MODELS)) prisma[name] = makeModel(name);

  // ─── jsonb fake (same exports and semantics as src/db/jsonb.js) ───────────

  function ident(name, allowed) {
    if (typeof name !== 'string' || !allowed.includes(name)) throw new Error('jsonb: bad identifier');
  }

  function checkPath(path) {
    if (!Array.isArray(path) || path.length === 0 || !path.every((p) => typeof p === 'string' && p)) {
      throw new Error('jsonb: bad path');
    }
  }

  function ttl(ttlMs) {
    const n = Math.round(Number(ttlMs));
    return Number.isFinite(n) && n > 0 ? n : LEASE_TTL_MS;
  }

  function conversationRow(id) {
    return store.conversations.find((r) => r.id === id) || null;
  }

  // Postgres `->>` text form of a jsonb value.
  function textOf(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return v;
    return JSON.stringify(v);
  }

  function intOf(v) {
    const n = parseInt(textOf(v), 10);
    return Number.isNaN(n) ? 0 : n;
  }

  function writeColumn(row, column, value) {
    row[column] = value;
    row.updated_at = clock.now();
  }

  const jsonb = {
    LEASE_TTL_MS,

    async patchJson(table, id, column, patch, { ifVersion, remove = [] } = {}) {
      ident(table, TABLES);
      ident(column, COLUMNS);
      checkFailure('jsonb.patchJson');
      rejectNul(patch);
      const removeKeys = Array.isArray(remove) ? remove.filter((k) => typeof k === 'string') : [];
      // JSON round-trip mirrors `::jsonb`: undefined keys drop, Dates become ISO strings.
      const parsed = JSON.parse(JSON.stringify(patch || {}));
      if (Object.keys(parsed).length === 0 && removeKeys.length === 0) return { ok: true, count: 0 };

      const row = conversationRow(id);
      if (!row) return { ok: false, count: 0 };
      const current = isPlainObject(row[column]) ? row[column] : {};
      if (Number.isInteger(ifVersion) && intOf(current.lead?.version) !== ifVersion) {
        return { ok: false, count: 0 };
      }
      const next = { ...clone(current) };
      for (const k of removeKeys) delete next[k];
      Object.assign(next, parsed);
      writeColumn(row, column, next);
      return { ok: true, count: 1 };
    },

    async mergeObjectKey(table, id, column, key, patch, { match } = {}) {
      ident(table, TABLES);
      ident(column, COLUMNS);
      checkPath([key]);
      checkFailure('jsonb.mergeObjectKey');
      rejectNul(patch);
      const parsed = JSON.parse(JSON.stringify(patch || {}));
      if (Object.keys(parsed).length === 0) return false;
      const row = conversationRow(id);
      if (!row || !isPlainObject(row[column]) || !isPlainObject(row[column][key])) return false;
      const target = row[column][key];
      if (match) {
        // jsonb @> on a flat object: every match key present with an equal value (null matches null only).
        const wanted = JSON.parse(JSON.stringify(match));
        const contained = Object.entries(wanted).every(([k, v]) => Object.prototype.hasOwnProperty.call(target, k)
          && JSON.stringify(target[k]) === JSON.stringify(v));
        if (!contained) return false;
      }
      writeColumn(row, column, { ...clone(row[column]), [key]: { ...clone(target), ...parsed } });
      return true;
    },

    async claimFlag(table, id, column, path) {
      ident(table, TABLES);
      ident(column, COLUMNS);
      checkPath(path);
      checkFailure('jsonb.claimFlag');
      const row = conversationRow(id);
      if (!row || !isPlainObject(row[column])) return false;
      const next = clone(row[column]);
      let parent = next;
      for (const key of path.slice(0, -1)) {
        parent = parent[key];
        if (!isPlainObject(parent)) return false;
      }
      const leaf = path[path.length - 1];
      if (parent[leaf] !== null && parent[leaf] !== undefined) return false;
      parent[leaf] = clock.now().toISOString();
      writeColumn(row, column, next);
      return true;
    },

    async claimValue(table, id, column, key, value) {
      ident(table, TABLES);
      ident(column, COLUMNS);
      checkPath([key]);
      checkFailure('jsonb.claimValue');
      const row = conversationRow(id);
      if (!row) return false;
      const v = value === null || value === undefined ? null : String(value);
      const current = isPlainObject(row[column]) ? row[column] : {};
      if (textOf(current[key]) === v) return false;
      writeColumn(row, column, { ...clone(current), [key]: v });
      return true;
    },

    async incrementCounter(table, id, column, key, by = 1) {
      ident(table, TABLES);
      ident(column, COLUMNS);
      checkPath([key]);
      checkFailure('jsonb.incrementCounter');
      const row = conversationRow(id);
      if (!row) return null;
      const step = Number.isInteger(by) ? by : 1;
      const current = isPlainObject(row[column]) ? row[column] : {};
      const n = intOf(current[key]) + step;
      writeColumn(row, column, { ...clone(current), [key]: n });
      return n;
    },

    async acquireLease(conversationId, token, ttlMs = LEASE_TTL_MS) {
      checkFailure('jsonb.acquireLease');
      const row = conversationRow(conversationId);
      if (!row) return false;
      const meta = isPlainObject(row.metadata) ? row.metadata : {};
      const now = clock.now().getTime();
      const free = meta.lease_token === null || meta.lease_token === undefined
        || meta.reply_lease_until === null || meta.reply_lease_until === undefined
        || new Date(meta.reply_lease_until).getTime() < now
        || meta.lease_token === String(token);
      if (!free) return false;
      writeColumn(row, 'metadata', {
        ...clone(meta),
        lease_token: String(token),
        reply_lease_until: new Date(now + ttl(ttlMs)).toISOString(),
      });
      return true;
    },

    async renewLease(conversationId, token, ttlMs = LEASE_TTL_MS) {
      checkFailure('jsonb.renewLease');
      const row = conversationRow(conversationId);
      if (!row || !isPlainObject(row.metadata) || row.metadata.lease_token !== String(token)) return false;
      // D20: an expired lease is never renewed, even before someone else takes it.
      const until = row.metadata.reply_lease_until ? new Date(row.metadata.reply_lease_until).getTime() : NaN;
      if (!(until > clock.now().getTime())) return false;
      writeColumn(row, 'metadata', {
        ...clone(row.metadata),
        reply_lease_until: new Date(clock.now().getTime() + ttl(ttlMs)).toISOString(),
      });
      return true;
    },

    async preSendCheck(conversationId, { leaseToken = null, ttlMs = LEASE_TTL_MS, humanGuard = true, optedOutSince = null, claim = null } = {}) {
      checkFailure('jsonb.preSendCheck');
      const claims = Array.isArray(claim) ? claim : claim ? [claim] : [];
      for (const c of claims) {
        ident(c && c.column, COLUMNS);
        checkPath(c.path);
      }
      const row = conversationRow(conversationId);
      if (!row) return false;
      // `#>> path = value::text`: a missing path is NULL and never equal.
      for (const c of claims) {
        let v = row[c.column];
        for (const k of c.path) v = isPlainObject(v) ? v[k] : undefined;
        if (textOf(v) === null || textOf(v) !== String(c.value)) return false;
      }
      const meta = isPlainObject(row.metadata) ? row.metadata : {};
      const wd = isPlainObject(row.workflow_data) ? row.workflow_data : {};
      const now = clock.now().getTime();
      const hasLease = leaseToken !== null && leaseToken !== undefined && leaseToken !== '';
      if (hasLease) {
        const until = meta.reply_lease_until ? new Date(meta.reply_lease_until).getTime() : NaN;
        if (meta.lease_token !== String(leaseToken) || !(until > now)) return false;
      }
      if (humanGuard) {
        if (row.status === 'human_takeover' || row.ai_enabled !== true) return false;
        if (meta.human_active_until && new Date(meta.human_active_until).getTime() > now) return false;
      }
      const since = optedOutSince ? new Date(optedOutSince).getTime() : NaN;
      if (Number.isFinite(since) && wd.marketing_opted_out_at && new Date(wd.marketing_opted_out_at).getTime() > since) {
        return false;
      }
      if (hasLease) {
        writeColumn(row, 'metadata', { ...clone(meta), reply_lease_until: new Date(now + ttl(ttlMs)).toISOString() });
      }
      return true;
    },

    async touchBatchDue(conversationId, quietMs, capMs) {
      checkFailure('jsonb.touchBatchDue');
      const row = conversationRow(conversationId);
      if (!row) return null;
      const meta = isPlainObject(row.metadata) ? row.metadata : {};
      const now = clock.now().getTime();
      const quiet = Math.max(0, Math.round(Number(quietMs)) || 0);
      const cap = Math.max(0, Math.round(Number(capMs)) || 0);
      const prevDue = meta.batch_due_at ? new Date(meta.batch_due_at).getTime() : NaN;
      const fresh = !meta.batch_due_at || !meta.batch_first_at || prevDue < now;
      const firstAt = fresh ? now : new Date(meta.batch_first_at).getTime();
      const due = Math.min(now + quiet, firstAt + cap);
      writeColumn(row, 'metadata', {
        ...clone(meta),
        batch_first_at: new Date(firstAt).toISOString(),
        batch_due_at: new Date(due).toISOString(),
      });
      return { dueAt: new Date(due), delayMs: Math.max(0, due - now) };
    },

    async casBusinessConfig(businessId, key, expected, value) {
      checkPath([key]);
      checkFailure('jsonb.casBusinessConfig');
      const row = store.businesses.find((b) => b.id === businessId);
      if (!row) return false;
      const cfg = isPlainObject(row.ai_config) ? row.ai_config : {};
      const current = Object.prototype.hasOwnProperty.call(cfg, key) ? cfg[key] : null;
      const want = expected === undefined ? null : expected;
      // jsonb IS NOT DISTINCT FROM: structural equality (key order does not matter in jsonb).
      const canon = (v) => JSON.stringify(v, (k, x) => (isPlainObject(x) ? Object.keys(x).sort().reduce((o, kk) => { o[kk] = x[kk]; return o; }, {}) : x));
      if (canon(current === undefined ? null : current) !== canon(JSON.parse(JSON.stringify(want)))) return false;
      row.ai_config = { ...clone(cfg), [key]: JSON.parse(JSON.stringify(value)) };
      row.updated_at = clock.now();
      return true;
    },

    async resolveNeedsTeam(conversationId, { match, resolvedAt }) {
      if (!isPlainObject(match) || !Object.keys(match).length) throw new Error('jsonb: resolveNeedsTeam needs a match');
      checkFailure('jsonb.resolveNeedsTeam');
      const row = conversationRow(conversationId);
      const nt = row && isPlainObject(row.workflow_data) ? row.workflow_data.needs_team : null;
      if (!isPlainObject(nt) || (nt.resolved_at !== null && nt.resolved_at !== undefined)) return false;
      const wanted = JSON.parse(JSON.stringify(match));
      if (!Object.entries(wanted).every(([k, v]) => Object.prototype.hasOwnProperty.call(nt, k)
        && JSON.stringify(nt[k]) === JSON.stringify(v))) return false;
      // One statement in SQL: both columns change together or neither does.
      row.workflow_data = { ...clone(row.workflow_data), needs_team: { ...clone(nt), resolved_at: String(resolvedAt) } };
      if (row.status === 'pending') row.status = 'open';
      row.updated_at = clock.now();
      return true;
    },

    async writeConversationState(conversationId, {
      status, currentState, patch = {}, needsTeam = null, priorities = {}, defaultPriority = 1,
    } = {}) {
      if (typeof status !== 'string' || !status) throw new Error('jsonb: writeConversationState needs a status');
      checkFailure('jsonb.writeConversationState');
      rejectNul([patch, needsTeam]);
      const row = conversationRow(conversationId);
      if (!row || row.status === 'human_takeover') return { ok: false, needsTeam: null };
      const prio = (reason) => (typeof reason === 'string' && Object.prototype.hasOwnProperty.call(priorities, reason)
        ? Number(priorities[reason]) : defaultPriority);
      const wd = isPlainObject(row.workflow_data) ? clone(row.workflow_data) : {};
      const stored = wd.needs_team;
      Object.assign(wd, JSON.parse(JSON.stringify(patch || {})));
      const entry = isPlainObject(needsTeam) ? JSON.parse(JSON.stringify(needsTeam)) : null;
      // Same test as the SQL CASE: evaluated on the needs_team stored before this write.
      const replace = entry && (!isPlainObject(stored)
        || (stored.resolved_at !== null && stored.resolved_at !== undefined)
        || (stored.claimed_at !== null && stored.claimed_at !== undefined)
        || prio(stored.reason) < prio(entry.reason));
      if (replace) wd.needs_team = entry;
      // One statement in SQL: every column changes together or none does.
      row.workflow_data = wd;
      if (currentState !== undefined) row.current_state = currentState === null ? null : String(currentState);
      row.status = status;
      row.updated_at = clock.now();
      const nt = isPlainObject(wd.needs_team) ? wd.needs_team : null;
      return { ok: true, needsTeam: nt && (nt.at || nt.reason) ? { reason: textOf(nt.reason), at: textOf(nt.at) } : null };
    },

    async releaseLease(conversationId, token) {
      checkFailure('jsonb.releaseLease');
      const row = conversationRow(conversationId);
      if (!row || !isPlainObject(row.metadata) || row.metadata.lease_token !== String(token)) return false;
      const next = clone(row.metadata);
      delete next.lease_token;
      delete next.reply_lease_until;
      writeColumn(row, 'metadata', next);
      return true;
    },
  };

  // ─── seed / reset ─────────────────────────────────────────────────────────

  function seed(data = {}) {
    const inserted = {};
    for (const storeKey of Object.keys(store)) {
      const list = data[storeKey];
      if (!Array.isArray(list)) continue;
      inserted[storeKey] = list.map((item) => {
        const row = withDefaults(storeKey, item || {});
        store[storeKey].push(row);
        return clone(row);
      });
    }
    return inserted;
  }

  function reset() {
    // Empty in place so a test holding `db.store` keeps a live reference.
    for (const key of Object.keys(store)) store[key].length = 0;
    fixedNow = null;
    idSeq = 0;
    failures.clear();
  }

  return { prisma, jsonb, store, seed, reset, clock, failNext };
}

// Kept on the test file's global, not in this module: jest.isolateModules (a second "instance" of the
// service code in the same test) re-evaluates this helper, and both instances must share one database.
const INSTANCE_KEY = Symbol.for('karambot.fakeDb');

function getFakeDb() {
  if (!global[INSTANCE_KEY]) global[INSTANCE_KEY] = createFakeDb();
  return global[INSTANCE_KEY];
}

module.exports = { getFakeDb, createFakeDb };
