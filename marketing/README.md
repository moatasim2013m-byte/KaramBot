# shifts-ai.store — marketing site (Firebase Hosting)

Static customer-facing site for **شِفت / SHIFT AI & Automation**, served by Firebase Hosting
in the `karam-bot` project. Two hosting sites, one config:

| Firebase site     | Domains                              | Serves                                  |
|-------------------|--------------------------------------|-----------------------------------------|
| `shifts-ai-site`  | shifts-ai.store, www.shifts-ai.store | `site/` — static files in this folder   |
| `shifts-ai-app`   | app.shifts-ai.store                  | rewrite → Cloud Run service `karambot`  |

## Files

- `site/index.html` — the interactive SHIFT landing page (self-contained React bundle;
  exported from the Claude artifact, head tags added). `index.green.bak` is not kept here.
- `site/privacy.html`, `site/data-deletion.html` — bilingual (ar/en) legal pages, clean URLs
  `/privacy` and `/data-deletion`.
- `site/404.html`, `site/robots.txt`, `site/sitemap.xml`
- `deploy.py` — deploys `site/` to `shifts-ai-site` through the Hosting REST API using
  `gcloud` user credentials (no `firebase login` needed). Config (redirects, headers,
  cleanUrls) lives at the top of the script.
- `firebase.json` / `.firebaserc` — the same config for `firebase deploy --only hosting`
  if you prefer the CLI (`firebase target:apply hosting site shifts-ai-site`, `… app shifts-ai-app`).

## Deploy

```bash
gcloud config set project karam-bot
python3 marketing/deploy.py
```

Prints the version id and release; changes are live within seconds (root and clean URLs are
served with `max-age=0`).

## Notes

- Dashboard routes (`/login`, `/overview`, …) on the marketing domain 302 to `app.shifts-ai.store`.
- `CORS_ORIGINS` on Cloud Run already includes all three domains.
- DNS is at Squarespace: `A @ 199.36.158.100`, `CNAME www → shifts-ai-site.web.app`,
  `CNAME app → shifts-ai-app.web.app`, `TXT @ hosting-site=shifts-ai-site`,
  plus `_acme-challenge` TXT records used for the first certificate issuance.
