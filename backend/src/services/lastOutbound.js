'use strict';

/**
 * Conversation.last_outbound_at: when a message was last sent to this customer.
 *
 * «A customer is waiting» is last_inbound_at newer than this (spec: the unanswered and
 * handoff_waiting attention rules). It used to be read off last_message_at, which an inbound
 * message moves too, so every conversation looked unanswered. Every place that saves an outbound
 * row calls this one function, so the bot, staff sends from either inbox, templates and the
 * outside automation's reported replies all count.
 *
 * Never moves backwards: two sends of one conversation can commit out of order (a staff reply
 * racing a bot part), the same reason insertInbound guards last_inbound_at.
 *
 * Best effort: the message has already reached WhatsApp when this runs, so a failure is logged
 * and never turned into «not sent» (staff would retry and the customer would get it twice).
 */

const prisma = require('../config/prisma');

function validDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {string} conversationId
 * @param {Date|string} [at] the outbound message's time (its created_at); now when absent
 * @returns {Promise<boolean>} whether the column moved
 */
async function markOutbound(conversationId, at) {
  if (!conversationId) return false;
  const when = (at !== undefined && at !== null && validDate(at)) || new Date();
  try {
    const { count } = await prisma.conversation.updateMany({
      where: { id: conversationId, OR: [{ last_outbound_at: null }, { last_outbound_at: { lt: when } }] },
      data: { last_outbound_at: when },
    });
    return count > 0;
  } catch (err) {
    console.error(`[last_outbound] not stamped conversation=${conversationId}: ${err.message}`);
    return false;
  }
}

module.exports = { markOutbound };
