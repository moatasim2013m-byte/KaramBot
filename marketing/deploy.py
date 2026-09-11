#!/usr/bin/env python3
"""Deploy ./site to Firebase Hosting site `shifts-ai-site` via the REST API.
Auth: gcloud user credentials (`gcloud auth print-access-token`). No firebase-tools needed."""
import gzip, hashlib, io, json, os, subprocess, sys, urllib.request, urllib.error, argparse

SITE    = "shifts-ai-site"
PROJECT = "karam-bot"
ROOT    = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site")
BASE    = "https://firebasehosting.googleapis.com/v1beta1"
APP     = "https://app.shifts-ai.store"

ap = argparse.ArgumentParser(description="Deploy ./site to Firebase Hosting (live by default).")
ap.add_argument("--channel", help="deploy to a preview channel id (e.g. preview) instead of live; prints its URL")
ap.add_argument("--expires", default="7d", help="preview channel TTL (default 7d)")
ARGS = ap.parse_args()
TOKEN = subprocess.check_output(["gcloud", "auth", "print-access-token"]).decode().strip()

def req(method, url, body=None, ctype="application/json", raw=False):
    data = body if raw else (json.dumps(body).encode() if body is not None else None)
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Authorization", "Bearer " + TOKEN)
    r.add_header("x-goog-user-project", PROJECT)
    if data is not None: r.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(r) as resp: b = resp.read()
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code} {method} {url}\n{e.read().decode()}")
    return json.loads(b) if b and not raw else b

NO_CACHE = {"Cache-Control": "public, max-age=0, must-revalidate"}
SECURITY = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}
CONFIG = {"config": {
    "cleanUrls": True,
    # dashboard routes live on the app subdomain
    "redirects": [{"glob": p, "location": APP + p, "statusCode": 302} for p in
                  ["/login", "/overview", "/inbox", "/orders", "/menu",
                   "/clinic", "/reports", "/staff", "/settings"]],
    "headers": [
        {"glob": "**",              "headers": SECURITY},
        {"regex": "^/([^.]*)$",     "headers": NO_CACHE},   # "/" and clean URLs (/privacy …)
        {"glob": "**/*.html",       "headers": NO_CACHE},
        {"glob": "/assets/**",      "headers": {"Cache-Control": "public, max-age=31536000, immutable"}},
    ],
}}

ver = req("POST", f"{BASE}/sites/{SITE}/versions", CONFIG)["name"]
print("version:", ver)

import re as _re

# /assets/** is served "immutable" for a year, but file names carry no hash. So every HTML file is uploaded with
# its local asset references rewritten to ?v=<content hash>: a changed CSS/JS file gets a new URL, an unchanged
# one keeps its cache. The files on disk are not modified.
def _asset_hash(rel):
    fp = os.path.join(ROOT, rel.lstrip("/").split("?")[0])
    return hashlib.sha256(open(fp, "rb").read()).hexdigest()[:10] if os.path.isfile(fp) else None

def stamp_assets(html):
    def sub(m):
        attr, q, url = m.group(1), m.group(2), m.group(3)
        h = _asset_hash(url)
        return f'{attr}={q}{url}?v={h}{q}' if h else m.group(0)
    return _re.sub(r'(src|href)=(["\'])(/?assets/[^"\'?#]+\.(?:css|js|png|svg|webp|jpg))\2', sub, html)

files, blobs = {}, {}
for dirpath, _, names in os.walk(ROOT):
    for n in sorted(names):
        full = os.path.join(dirpath, n)
        path = "/" + os.path.relpath(full, ROOT).replace(os.sep, "/")
        buf = io.BytesIO()
        data = open(full, "rb").read()
        if full.endswith(".html"):
            data = stamp_assets(data.decode("utf-8")).encode("utf-8")
        with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as gz:
            gz.write(data)
        gzb = buf.getvalue(); h = hashlib.sha256(gzb).hexdigest()
        files[path] = h; blobs[h] = gzb
        print(f"  {path:22s} {h[:12]}  {len(gzb):>7} B gz")

pop = req("POST", f"{BASE}/{ver}:populateFiles", {"files": files})
for h in pop.get("uploadRequiredHashes", []):
    req("PUT", f"{pop['uploadUrl']}/{h}", blobs[h], ctype="application/octet-stream", raw=True)
    print("  uploaded", h[:12])

print("finalize:", req("PATCH", f"{BASE}/{ver}?updateMask=status", {"status": "FINALIZED"})["status"])
if ARGS.channel:
    ch = f"{BASE}/sites/{SITE}/channels/{ARGS.channel}"
    try:
        info = req("GET", ch)
    except SystemExit:
        info = req("POST", f"{BASE}/sites/{SITE}/channels?channelId={ARGS.channel}", {"ttl": ARGS.expires.replace("d", "") and str(int(ARGS.expires.rstrip("d")) * 86400) + "s"})
    rel = req("POST", f"{ch}/releases?versionName={ver}", {})
    print("released to channel:", rel["name"])
    print("PREVIEW URL:", info.get("url"))
else:
    print("released LIVE:", req("POST", f"{BASE}/sites/{SITE}/releases?versionName={ver}", {})["name"])
