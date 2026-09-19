#!/usr/bin/env node
/**
 * create-alert-template.js — submit the staff-alert utility template to a business's WhatsApp Business
 * Account, or check its approval status.
 *
 * Staff alerts (services/alerts.js) are free-form text while the staff number wrote to the business in the
 * last 24 h. Outside that window they need this approved template; set it on the business afterwards:
 *   UPDATE businesses SET ai_config = ai_config || '{"alert_template": {"name": "staff_alert", "language": "ar"}}'::jsonb
 *   WHERE id = '<business id>';
 *
 * The body is ALERT_TEMPLATE_BODY from services/alerts.js (the wording the code renders into the Inbox and
 * whose three variables it fills: {{1}} alert label, {{2}} customer name + number, {{3}} summary). For SHIFT
 * the template already exists (id 1012210055209109); this is for other businesses or a re-creation.
 *
 * Usage (from backend/, DATABASE_URL and TOKEN_ENCRYPTION_KEY in the environment or backend/.env):
 *   node scripts/create-alert-template.js --dry-run                 print the request, no DB and no network
 *   node scripts/create-alert-template.js --status [--business ID]  GET the template's status from Graph
 *   node scripts/create-alert-template.js [--business ID]           POST /{WABA_ID}/message_templates
 * Options: --business <id> (default: the SHIFT business), --name <staff_alert>, --language <ar>.
 *
 * Reads businesses.wa_business_account_id and the encrypted wa_access_token; writes nothing to the DB.
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { ALERT_TEMPLATE_NAME, ALERT_TEMPLATE_LANGUAGE, ALERT_TEMPLATE_BODY } = require('../src/services/alerts');

const SHIFT_BUSINESS_ID = 'shiftc6f194e723be82b9b363';

// Plainly transactional sample values (Meta reviews the example with the body).
const EXAMPLE = ['رسالة جديدة من عميل', 'محمد (+962791234567)', '«مرحبا، بدي أعرف أسعار البوت» · من إعلان: بوت واتساب لعيادتك'];

function parseArgs(argv) {
  const args = { dryRun: false, status: false, business: SHIFT_BUSINESS_ID, name: ALERT_TEMPLATE_NAME, language: ALERT_TEMPLATE_LANGUAGE };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--status') args.status = true;
    else if (a === '--business') args.business = argv[++i];
    else if (a === '--name') args.name = argv[++i];
    else if (a === '--language') args.language = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!/^[a-z0-9_]{1,512}$/.test(args.name || '')) throw new Error('--name must be lower-case letters, digits and _');
  if (!args.language) throw new Error('--language is required');
  if (!args.business) throw new Error('--business is required');
  return args;
}

/** The exact body Graph receives for POST /{WABA_ID}/message_templates. */
function templatePayload({ name = ALERT_TEMPLATE_NAME, language = ALERT_TEMPLATE_LANGUAGE } = {}) {
  return {
    name,
    language,
    category: 'UTILITY',
    components: [
      { type: 'BODY', text: ALERT_TEMPLATE_BODY, example: { body_text: [EXAMPLE] } },
    ],
  };
}

async function loadBusiness(id) {
  const prisma = require('../src/config/prisma');
  const { decrypt } = require('../src/utils/tokenCrypto');
  try {
    const biz = await prisma.business.findUnique({
      where: { id },
      select: { id: true, name: true, wa_business_account_id: true, wa_access_token: true },
    });
    if (!biz) throw new Error(`business ${id} not found`);
    if (!biz.wa_business_account_id) throw new Error(`business ${id} has no wa_business_account_id`);
    const token = decrypt(biz.wa_access_token);
    if (!token) throw new Error(`business ${id} has no WhatsApp access token`);
    return { name: biz.name, wabaId: biz.wa_business_account_id, token };
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

function graphError(err) {
  const e = err?.response?.data?.error;
  return e ? `${e.message} (code=${e.code}${e.error_subcode ? ` subcode=${e.error_subcode}` : ''}${e.error_user_msg ? `: ${e.error_user_msg}` : ''})` : err.message;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(require('fs').readFileSync(__filename, 'utf8').split('*/')[0]);
    return;
  }
  const { graphBase } = require('../src/services/whatsapp');
  const payload = templatePayload(args);

  if (args.dryRun) {
    console.log(`DRY RUN — nothing sent. business=${args.business}`);
    console.log(`POST ${graphBase()}/{WABA_ID}/message_templates`);
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const axios = require('axios');
  const biz = await loadBusiness(args.business);
  const headers = { Authorization: `Bearer ${biz.token}` };

  if (args.status) {
    const res = await axios.get(`${graphBase()}/${biz.wabaId}/message_templates`, {
      headers,
      params: { name: args.name, fields: 'id,name,language,status,category,rejected_reason,quality_score' },
      timeout: 15000,
    });
    const rows = (res.data?.data || []).filter((t) => t.name === args.name);
    if (!rows.length) console.log(`No template named ${args.name} on WABA ${biz.wabaId} (${biz.name}).`);
    for (const t of rows) {
      console.log(`${t.name}/${t.language}: ${t.status} category=${t.category} id=${t.id}`
        + `${t.rejected_reason && t.rejected_reason !== 'NONE' ? ` rejected_reason=${t.rejected_reason}` : ''}`);
    }
    if (rows.some((t) => t.status === 'APPROVED' && t.language === args.language)) {
      console.log(`\nApproved. Enable the fallback:\nUPDATE businesses SET ai_config = ai_config || '{"alert_template": {"name": "${args.name}", "language": "${args.language}"}}'::jsonb WHERE id = '${args.business}';`);
    }
    return;
  }

  console.log(`Creating ${args.name}/${args.language} on WABA ${biz.wabaId} (${biz.name})…`);
  const res = await axios.post(`${graphBase()}/${biz.wabaId}/message_templates`, payload, {
    headers: { ...headers, 'Content-Type': 'application/json' },
    timeout: 15000,
  });
  console.log(JSON.stringify(res.data));
  console.log('Meta reviews it (usually minutes). Check with --status; enable ai_config.alert_template once APPROVED.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Failed: ${graphError(err)}`);
    process.exitCode = 1;
  });
}

module.exports = { templatePayload, parseArgs, EXAMPLE };
