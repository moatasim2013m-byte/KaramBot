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

const safeJsonParse = (text) => {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
};

const accessToken = trimEnv('META_ACCESS_TOKEN') || trimEnv('WHATSAPP_ACCESS_TOKEN');

(async () => {
  if (!accessToken) {
    console.error('Missing token. Set META_ACCESS_TOKEN (preferred) or WHATSAPP_ACCESS_TOKEN.');
    process.exit(1);
  }

  const params = new URLSearchParams({
    fields: 'id,name',
    access_token: accessToken
  });

  const url = `${GRAPH_BASE}/me?${params.toString()}`;
  const response = await fetch(url);
  const text = await response.text();
  const payload = safeJsonParse(text);

  console.log('Meta /me query summary:');
  console.log(
    JSON.stringify(
      {
        graph_version: GRAPH_VERSION,
        endpoint: `/${GRAPH_VERSION}/me`,
        fields: 'id,name',
        access_token_preview: maskToken(accessToken),
        http_status: response.status,
        ok: response.ok
      },
      null,
      2
    )
  );

  console.log('\nMeta /me response:');
  console.log(JSON.stringify(payload || text, null, 2));

  if (!response.ok) process.exit(1);
})();
