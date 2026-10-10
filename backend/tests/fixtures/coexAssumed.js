/**
 * Coexistence webhook payloads — ASSUMED, not recorded. REPLACE DURING G1.
 *
 * Shaped from Meta's documented examples for a business onboarded with its WhatsApp Business app
 * number (docs/panels/meta-facts.md Q4a–d; the coexistence onboarding page), with made-up ids.
 * Nothing here has been seen from Meta yet. The first coexistence number (one friendly Irbid shop,
 * docs/panels/coexistence.md «G1 test plan») records the real deliveries under
 * tests/fixtures/es/coex/, and these builders are then rewritten from them. The fields the code
 * relies on, and so the first to re-check:
 *   - every field: value.metadata.phone_number_id names the number, entry.id is the WABA;
 *   - smb_message_echoes: value.message_echoes[] with id (wamid), from (the shop), to (the customer),
 *     timestamp (seconds) and type with its body (text.body, or image.caption …);
 *   - history: value.history[] chunks, each with threads[] {id: the customer's wa_id, messages[]},
 *     each message with id, from, timestamp, type and history_context.status; a chunk carrying
 *     errors[] (the owner declined to share history) instead of threads;
 *   - smb_app_state_sync: value.state_sync[] contact changes {type:'contact', contact, action}.
 */

const { IDS } = require('./esAssumed');

const SHOP_NUMBER = '962791234567'; // the shop's own number, as Meta writes `from` on its messages
const CUSTOMER = '962795555555';

const metadata = (phone = IDS.PHONE) => ({ display_phone_number: SHOP_NUMBER, phone_number_id: phone });

function delivery(field, value, { waba = IDS.WABA } = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: waba, changes: [{ field, value: { messaging_product: 'whatsapp', ...value } }] }],
  };
}

// The owner answered a customer from the WhatsApp Business app on the shop's phone.
const echo = ({
  id = 'wamid.ECHO1', to = CUSTOMER, text = 'أهلين، الطلب جاهز', timestamp = 1791460800, phone = IDS.PHONE, waba,
} = {}) => delivery('smb_message_echoes', {
  metadata: metadata(phone),
  message_echoes: [{ from: SHOP_NUMBER, to, id, timestamp: String(timestamp), type: 'text', text: { body: text } }],
}, { waba });

// One chunk of the chats from before the connect: a customer's question and the owner's answer.
const history = ({ phone = IDS.PHONE, waba, customer = CUSTOMER, base = 1788000000 } = {}) => delivery('history', {
  metadata: metadata(phone),
  history: [{
    metadata: { phase: 0, chunk_order: 1, progress: 100 },
    threads: [{
      id: customer,
      messages: [
        {
          from: customer, id: 'wamid.H1', timestamp: String(base), type: 'text',
          text: { body: 'عندكم توصيل؟' }, history_context: { status: 'READ' },
        },
        {
          from: SHOP_NUMBER, id: 'wamid.H2', timestamp: String(base + 60), type: 'text',
          text: { body: 'نعم، داخل إربد' }, history_context: { status: 'DELIVERED' },
        },
      ],
    }],
  }],
}, { waba });

// The owner chose not to share the chat history (Meta's documented error for it).
const historyDeclined = ({ phone = IDS.PHONE, waba } = {}) => delivery('history', {
  metadata: metadata(phone),
  history: [{ errors: [{ code: 2593109, title: 'History sync is turned off by the business', message: 'History sync is turned off by the business' }] }],
}, { waba });

// The app's contacts.
const stateSync = ({ phone = IDS.PHONE, waba } = {}) => delivery('smb_app_state_sync', {
  metadata: metadata(phone),
  state_sync: [
    { type: 'contact', contact: { full_name: 'أبو أحمد', first_name: 'أبو أحمد', phone_number: CUSTOMER }, action: 'add', metadata: { timestamp: '1791460800' } },
    { type: 'contact', contact: { full_name: 'سارة', first_name: 'سارة', phone_number: '962796666666' }, action: 'add', metadata: { timestamp: '1791460801' } },
  ],
}, { waba });

// POST /{phone_number_id}/smb_app_data answers.
const syncAccepted = () => ({ success: true });
const syncRefused = (code = 131000) => {
  const err = new Error('Request failed with status code 400');
  err.response = { status: 400, data: { error: { message: 'Something went wrong', type: 'OAuthException', code } } };
  return err;
};

module.exports = {
  SHOP_NUMBER, CUSTOMER, echo, history, historyDeclined, stateSync, syncAccepted, syncRefused,
};
