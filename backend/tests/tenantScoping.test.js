/**
 * Request scoping must fail closed.
 *
 * The hole these tests lock shut: a non-admin whose business_id was null fell past the
 * "pin to your own business" branch and into the request's own params, so `?businessId=`
 * named any tenant — and with no param the scope became `{ business_id: undefined }`,
 * which Prisma drops, returning every tenant's rows.
 */
require('./setup');

const httpMocks = { };
const { attachBusinessId } = require('../src/middleware/auth');

function run(user, { params = {}, query = {} } = {}) {
  const req = { user, params, query };
  const res = {
    statusCode: null, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  let nexted = false;
  attachBusinessId(req, res, () => { nexted = true; });
  return { req, res, nexted };
}

describe('a tenant user', () => {
  test('is pinned to their own business', () => {
    const { req, nexted } = run({ role: 'business_owner', business_id: 'b1' });
    expect(nexted).toBe(true);
    expect(req.businessId).toBe('b1');
  });

  test('cannot widen scope with a query parameter', () => {
    const { req } = run({ role: 'business_owner', business_id: 'b1' }, { query: { businessId: 'b2' } });
    expect(req.businessId).toBe('b1');   // their own, never the one they asked for
  });

  test('cannot widen scope with a route parameter', () => {
    const { req } = run({ role: 'staff', business_id: 'b1' }, { params: { businessId: 'b2' } });
    expect(req.businessId).toBe('b1');
  });
});

describe('a user with no business — the shape that leaked', () => {
  test('is refused rather than left unscoped', () => {
    const { res, nexted, req } = run({ role: 'staff', business_id: null });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(req.businessId).toBeUndefined();
  });

  test('cannot read another tenant by naming it', () => {
    const { res, nexted } = run({ role: 'staff', business_id: null }, { query: { businessId: 'someone_else' } });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  test('cannot reach an unscoped query by supplying nothing', () => {
    // The dangerous one: req.businessId stayed undefined and Prisma drops undefined keys,
    // so `where: { business_id: undefined }` matched every row in the table.
    const { req, nexted } = run({ role: 'manager', business_id: null });
    expect(nexted).toBe(false);
    expect(req.businessId).toBeUndefined();
  });
});

describe('platform_admin', () => {
  test('must name the account explicitly', () => {
    const { res, nexted } = run({ role: 'platform_admin', business_id: null });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(400);
  });

  test('is scoped to the account it names', () => {
    const { req, nexted } = run({ role: 'platform_admin', business_id: null }, { query: { businessId: 'b9' } });
    expect(nexted).toBe(true);
    expect(req.businessId).toBe('b9');
  });

  test('carrying a business_id still must name one — the field is not a default', () => {
    const { res } = run({ role: 'platform_admin', business_id: 'b1' });
    expect(res.statusCode).toBe(400);
  });
});
