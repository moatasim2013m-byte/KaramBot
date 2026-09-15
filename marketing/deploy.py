#!/usr/bin/env python3
"""Deploy ./site to Firebase Hosting site `shifts-ai-site` via the REST API.
Auth: gcloud user credentials (`gcloud auth print-access-token`). No firebase-tools needed."""
import gzip, hashlib, io, json, os, subprocess, sys, urllib.request, urllib.error, argparse

SITE    = "shifts-ai-site"
PROJECT = "karam-bot"
ROOT    = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site")
BASE    = "https://firebasehosting.googleapis.com/v1beta1"
DOMAIN  = "shifts-ai.com"  # official domain since 2026-09-14; shifts-ai.store 301-redirects here
APP     = f"https://app.{DOMAIN}"

ap = argparse.ArgumentParser(description="Deploy ./site to Firebase Hosting (live by default).")
ap.add_argument("--channel", help="deploy to a preview channel id (e.g. preview) instead of live; prints its URL")
ap.add_argument("--expires", default="7d", help="preview channel TTL (default 7d)")
ap.add_argument("--skip-build", action="store_true", help="upload site/ as it is, without rebuilding CSS/pages or running the gates")
ARGS = ap.parse_args()
# Node is not always on PATH (nvm shells, fresh sessions), so resolve it before the build steps run.
def node_bin():
    import glob, shutil
    found = shutil.which("node")
    if found:
        return found
    cands = sorted(glob.glob(os.path.expanduser("~/.nvm/versions/node/*/bin/node")) +
                   glob.glob("/usr/local/nvm/versions/node/*/bin/node") +
                   glob.glob("/usr/local/bin/node") + glob.glob("/usr/bin/node"), reverse=True)
    if not cands:
        sys.exit("deploy aborted: node not found — needed by the build steps (or pass --skip-build)")
    return cands[0]

# Build and gate before anything is uploaded: generated CSS and pre-rendered pages must match the source.
if not ARGS.skip_build:
    NODE = node_bin()
    TOOLS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tools")
    print(f"== node: {NODE}")
    for step in ["build-css.js", "check-consistency.js", "build-pages.js", "size.js"]:
        print(f"== {step}")
        r = subprocess.run([NODE, os.path.join(TOOLS, step)])
        if r.returncode != 0:
            sys.exit(f"deploy aborted: {step} failed")

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
                   "/clinic", "/reports", "/staff", "/settings"]] +
                 [{"glob": "/en/", "location": "/en", "statusCode": 301}],   # English home lives at /en
    "headers": [
        {"glob": "**",              "headers": SECURITY},
        {"regex": "^/([^.]*)$",     "headers": NO_CACHE},   # "/" and clean URLs (/privacy …)
        {"glob": "**/*.html",       "headers": NO_CACHE},
        {"glob": "/assets/**",      "headers": {"Cache-Control": "public, max-age=31536000, immutable"}},
    ],
}}

# IndexNow (Bing, Yandex, …): after a LIVE release, tell search engines which URLs changed. "Changed" means the
# page's built-HTML hash in src/lastmod.json differs from the hash last pinged (src/indexnow.json). The key file
# site/<key>.txt ships with the site. A failed ping never fails the deploy; unpinged URLs are retried next time.
def indexnow_ping():
    here = os.path.dirname(os.path.abspath(__file__))
    state_f, lastmod_f = os.path.join(here, "src/indexnow.json"), os.path.join(here, "src/lastmod.json")
    try:
        state = json.load(open(state_f, encoding="utf-8"))
        lastmod = json.load(open(lastmod_f, encoding="utf-8"))
    except Exception as e:
        print("indexnow: skipped —", e); return
    key, pinged = state.get("key"), state.setdefault("pinged", {})
    changed = [p for p, v in sorted(lastmod.items()) if pinged.get(p) != v.get("hash")]
    if not key or not changed:
        print("indexnow: nothing changed"); return
    body = {"host": DOMAIN, "key": key, "keyLocation": f"https://{DOMAIN}/{key}.txt",
            "urlList": [(f"https://{DOMAIN}" + p) for p in changed]}
    r = urllib.request.Request("https://api.indexnow.org/indexnow", data=json.dumps(body).encode(), method="POST",
                               headers={"Content-Type": "application/json; charset=utf-8"})
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            code = resp.status
    except urllib.error.HTTPError as e:
        code = e.code
    except Exception as e:
        print("indexnow: ping failed —", e); return
    if code in (200, 202):
        for p in changed: pinged[p] = lastmod[p]["hash"]
        json.dump(state, open(state_f, "w", encoding="utf-8"), indent=2); open(state_f, "a").write("\n")
        print(f"indexnow: {code} accepted — {len(changed)} URL(s): {', '.join(changed)}")
    else:
        print(f"indexnow: HTTP {code} — not recorded, will retry on next live deploy")

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
    indexnow_ping()
