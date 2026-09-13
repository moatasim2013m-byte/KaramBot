#!/usr/bin/env python3
"""Release a new version of Firebase Hosting site shifts-ai-app: same Cloud Run rewrite as today,
plus a static robots.txt (Disallow: /) and X-Robots-Tag: noindex on every response.
Usage: python3 marketing/deploy_app_noindex.py <channel>   (channel 'live' releases to production)"""
import gzip, hashlib, json, subprocess, sys, urllib.request, urllib.error

SITE, PROJECT = "shifts-ai-app", "karam-bot"
BASE = "https://firebasehosting.googleapis.com/v1beta1"
CHANNEL = sys.argv[1]
TOKEN = subprocess.check_output(["gcloud", "auth", "print-access-token"]).decode().strip()

def req(method, url, body=None, raw=None, ctype="application/json"):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Authorization", "Bearer " + TOKEN)
    r.add_header("x-goog-user-project", PROJECT)
    if data is not None: r.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(r) as resp: b = resp.read()
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code} {method} {url}\n{e.read().decode()}")
    return json.loads(b) if b else {}

ROBOTS = b"User-agent: *\nDisallow: /\n"
CONFIG = {"config": {
    "headers": [
        {"glob": "**", "headers": {"X-Robots-Tag": "noindex, nofollow"}},
        {"glob": "/robots.txt", "headers": {"Cache-Control": "public, max-age=300"}},
        {"glob": "/assets/**", "headers": {"Cache-Control": "public, max-age=31536000, immutable"}},
    ],
    "rewrites": [{"glob": "**", "run": {"serviceId": "karambot", "region": "europe-west1"}}],
}}

v = req("POST", f"{BASE}/sites/{SITE}/versions", CONFIG)
vname = v["name"]
gz = gzip.compress(ROBOTS, mtime=0)
h = hashlib.sha256(gz).hexdigest()
pop = req("POST", f"{BASE}/{vname}:populateFiles", {"files": {"/robots.txt": h}})
if h in pop.get("uploadRequiredHashes", []):
    req("POST", f"{pop['uploadUrl']}/{h}", raw=gz, ctype="application/octet-stream")
req("PATCH", f"{BASE}/{vname}?update_mask=status", {"status": "FINALIZED"})

if CHANNEL == "live":
    rel = req("POST", f"{BASE}/sites/{SITE}/releases?versionName={vname}")
    print("released live:", rel.get("name"), vname)
else:
    ch = f"{BASE}/sites/{SITE}/channels/{CHANNEL}"
    r = urllib.request.Request(ch, method="GET")
    r.add_header("Authorization", "Bearer " + TOKEN); r.add_header("x-goog-user-project", PROJECT)
    try: urllib.request.urlopen(r)
    except urllib.error.HTTPError:
        req("POST", f"{BASE}/sites/{SITE}/channels?channelId={CHANNEL}", {"ttl": "86400s"})
    rel = req("POST", f"{ch}/releases?versionName={vname}")
    print("released to channel:", CHANNEL, vname)
    print(req("GET", ch).get("url"))
