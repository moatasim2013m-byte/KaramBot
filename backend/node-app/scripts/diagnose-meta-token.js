#!/usr/bin/env node
require('dotenv').config();

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v25.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

const trimEnv = (name) => String(process.env[name] || '').trim();

const maskToken = (token) => {
  if (!token) return '(missing)';
  if (token.length <= 10) return `${token.slice(0, 3)}***`;
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
};

const token = trimEnv('WHATSAPP_ACCESS_TOKEN');
const appId = trimEnv('META_APP_ID');
const appSecret = trimEnv('META_APP_SECRET');

const safeJsonParse = (text) => {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
};

const callGraph = async (path, params = {}) => {
  const search = new URLSearchParams(params);
  const url = `${GRAPH_BASE}${path}?${search.toString()}`;
  const response = await fetch(url);
  const text = await response.text();
  const data = safeJsonParse(text);

  return {
    ok: response.ok,
    status: response.status,
    url,
    data,
    text
  };
};

const printBlock = (title, payload) => {
  console.log(`\n=== ${title} ===`);
  console.log(typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2));
};

(async () => {
  printBlock('Meta Token Diagnostic', {
    graph_version: GRAPH_VERSION,
    has_whatsapp_access_token: Boolean(token),
    token_preview: maskToken(token),
    has_meta_app_id: Boolean(appId),
    has_meta_app_secret: Boolean(appSecret)
  });

  if (!token) {
    printBlock('Action Required', 'Set WHATSAPP_ACCESS_TOKEN in backend/node-app/.env then rerun.');
    process.exit(1);
  }

  const me = await callGraph('/me', {
    fields: 'id,name',
    access_token: token
  });
  printBlock('GET /me?fields=id,name', me.data || me.text);

  const accounts = await callGraph('/me/accounts', {
    access_token: token,
    fields: 'id,name,category,access_token'
  });

  if (accounts.data?.data) {
    const compact = accounts.data.data.map((page) => ({
      id: page.id,
      name: page.name,
      category: page.category,
      has_page_access_token: Boolean(page.access_token)
    }));
    printBlock('GET /me/accounts (sanitized)', compact);
  } else {
    printBlock('GET /me/accounts', accounts.data || accounts.text);
  }

  const businesses = await callGraph('/me/businesses', {
    access_token: token,
    fields: 'id,name,verification_status'
  });
  printBlock('GET /me/businesses', businesses.data || businesses.text);

  if (appId && appSecret) {
    const appAccessToken = `${appId}|${appSecret}`;
    const debugToken = await callGraph('/debug_token', {
      input_token: token,
      access_token: appAccessToken
    });

    const tokenData = debugToken.data?.data;
    if (tokenData) {
      printBlock('GET /debug_token (sanitized)', {
        app_id: tokenData.app_id,
        type: tokenData.type,
        application: tokenData.application,
        is_valid: tokenData.is_valid,
        expires_at: tokenData.expires_at,
        issued_at: tokenData.issued_at,
        user_id: tokenData.user_id,
        scopes: tokenData.scopes || [],
        granular_scopes: tokenData.granular_scopes || []
      });
    } else {
      printBlock('GET /debug_token', debugToken.data || debugToken.text);
    }
  } else {
    printBlock(
      'Skipped /debug_token',
      'Set META_APP_ID and META_APP_SECRET to inspect expiry/scopes with /debug_token.'
    );
  }

  const hasCriticalFailure = !me.ok;
  if (hasCriticalFailure) process.exit(1);
})();
