# Meta Access Token Diagnostic

Use this when validating that a Meta token can access the expected user/page/business resources before wiring WhatsApp flows.

## Quick `/me` check (same as Graph API Explorer)

Use this cURL call to validate `id,name` from your access token:

```bash
curl -i -X GET \
  "https://graph.facebook.com/v25.0/me?fields=id%2Cname&access_token=<ACCESS_TOKEN>"
```

Equivalent JS SDK:

```js
FB.api('/me', 'GET', { fields: 'id,name' }, function (response) {
  // handle response
});
```

Equivalent Android SDK:

```java
GraphRequest request = GraphRequest.newMeRequest(
  accessToken,
  new GraphRequest.GraphJSONObjectCallback() {
    @Override
    public void onCompleted(JSONObject object, GraphResponse response) {
      // handle response
    }
  }
);

Bundle parameters = new Bundle();
parameters.putString("fields", "id,name");
request.setParameters(parameters);
request.executeAsync();
```

## Run full diagnostic script

```bash
cd backend/node-app
npm run diagnose:meta-token
```

## Run focused `/me` diagnostic script

```bash
cd backend/node-app
npm run meta:me
```

> `meta:me` uses `META_ACCESS_TOKEN` (preferred) and falls back to `WHATSAPP_ACCESS_TOKEN`.

## Required env vars

- `WHATSAPP_ACCESS_TOKEN` (required for `diagnose:meta-token`)
- `META_ACCESS_TOKEN` (optional, used by `meta:me` when provided)

## Optional env vars

- `META_APP_ID`
- `META_APP_SECRET`
- `META_GRAPH_VERSION` (default: `v25.0`)

When `META_APP_ID` and `META_APP_SECRET` are present, the script also calls `/debug_token` and prints token validity/scopes.

## What `diagnose:meta-token` checks

1. `GET /me?fields=id,name`
2. `GET /me/accounts`
3. `GET /me/businesses`
4. `GET /debug_token` (optional)

The scripts mask token values and only print a short preview.
