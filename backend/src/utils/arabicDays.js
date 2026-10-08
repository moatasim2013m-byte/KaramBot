'use strict';

/**
 * A count of days as a duration after a verb or an adjective («صالح 3 أيام»), in the accusative
 * Arabic wants there: «يومًا واحدًا», «يومين», «3 أيام», «15 يومًا». The noun agrees with the number,
 * so «صالح 3 يوم» or «1 يوم» never reach a customer. The frontend's daysAr is the nominative twin.
 */
function forDaysAr(n) {
  const k = Math.max(1, Math.round(Number(n) || 0));
  if (k === 1) return 'يومًا واحدًا';
  if (k === 2) return 'يومين';
  if (k <= 10) return `${k} أيام`;
  return `${k} يومًا`;
}

module.exports = { forDaysAr };
