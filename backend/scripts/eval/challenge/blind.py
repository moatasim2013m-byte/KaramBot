import json, sys, random, os, hashlib
runs_dir, out, labels = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
runs = {l: {r['id']: r for r in json.load(open(os.path.join(runs_dir, l + '.json')))['results']} for l in labels}
ids = list(next(iter(runs.values())).keys())
cases, mapping = [], {}
for cid in ids:
    rng = random.Random(int(hashlib.sha256(cid.encode()).hexdigest(), 16))
    order = labels[:]; rng.shuffle(order)
    letters = 'ABCDEFGH'
    base = runs[labels[0]][cid]
    variants = {}
    for letter, l in zip(letters, order):
        r = runs[l].get(cid)
        if not r: continue
        mapping.setdefault(cid, {})[letter] = l
        variants[letter] = {
            'error': r['error'],
            'turns': [{'bot_replies': t['bot'], 'server_actions': t['actions'], 'stage_after': t['stage'], 'status_after': t['status']} for t in r['turns']],
            'final': r['final'],
            'advisory_gate_failures': r['gate_failures'],
        }
    cases.append({
        'id': cid, 'title': base['title'], 'category': base['category'], 'source': base['source'], 'why': base['why'],
        'must': base['must'], 'must_not': base['must_not'],
        'customer_turns': [{'messages': t['customer'], 'media_transcripts': [m.get('transcript') for m in t.get('media') or []]} for t in base['turns']],
        'variants': variants,
    })
json.dump(cases, open(out, 'w'), ensure_ascii=False, indent=1)
json.dump(mapping, open(out.replace('.json', '.mapping.json'), 'w'), indent=1)
print(len(cases), 'cases blinded')
