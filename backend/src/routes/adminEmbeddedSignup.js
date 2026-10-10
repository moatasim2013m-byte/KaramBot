const express = require('express');
const prisma = require('../config/prisma');
const { authenticate, requireRole } = require('../middleware/auth');
const { config, mountAccountRoutes, refuseBusinessIdInput, wrap } = require('./embeddedSignup');

/**
 * Embedded Signup, SHIFT's side: a platform_admin connecting WhatsApp for a shop.
 *
 * The mirror of the owner's routes (routes/embeddedSignup.js), running the same handlers, with
 * the business taken from the URL as the admin user and contract routes already do:
 *
 *   GET  /api/admin/embedded-signup/config
 *   POST /api/admin/accounts/:id/embedded-signup/exchange
 *   POST /api/admin/accounts/:id/embedded-signup/retry   {pin?}
 *   POST /api/admin/accounts/:id/embedded-signup/events
 *   GET  /api/admin/accounts/:id/embedded-signup/status
 *
 * Not behind es_owner_enabled: this is how SHIFT runs G1 and the first attended connects while
 * the owner's button is still closed. Every AccountEvent written here is actor_kind 'shift' with
 * the admin's user id, so the shop's log says who connected it.
 *
 * Two routers, each mounted at its own path in app.js before admin.js, so these requests are
 * authenticated and rate-limited once and never fall through into admin.js.
 */

const NOT_FOUND = { error: 'not_found', message: 'لا يوجد حساب بهذا المعرّف' };
const ROUTE_NOT_FOUND = (req, res) => res.status(404).json({ error: 'Route not found' });

const configRouter = express.Router();
configRouter.use(authenticate, requireRole('platform_admin'));
configRouter.get('/config', config);
configRouter.use(ROUTE_NOT_FOUND);

// mergeParams: the :id is in the mount path (/api/admin/accounts/:id/embedded-signup).
const accountRouter = express.Router({ mergeParams: true });
accountRouter.use(
  authenticate,
  requireRole('platform_admin'),
  refuseBusinessIdInput,
  // An unknown id is a 404, never a row created against a business that does not exist.
  wrap(async (req, res, next) => {
    const business = await prisma.business.findUnique({ where: { id: String(req.params.id) }, select: { id: true } });
    if (!business) return res.status(404).json(NOT_FOUND);
    req.es = { businessId: business.id, actorKind: 'shift', actorUserId: req.user.id, audience: 'staff' };
    return next();
  }),
);
mountAccountRoutes(accountRouter);
accountRouter.use(ROUTE_NOT_FOUND);

module.exports = { configRouter, accountRouter };
