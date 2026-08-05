#!/bin/zsh
# Publish solver output into the committed pack: gunzip out/<flop>.json.gz into
# solver/pack/<spot>/<flop>.json and write the index.json manifest.
#
# The destination is `solver/pack/`, NOT `public/solves/`. Vercel promotes
# public/ to static assets and strips it from the Python function bundle, so
# the pack the API grades against cannot live there — a deploy 500s at runtime
# while every local test passes. `scripts/sync-solve-pack.mjs` mirrors this
# committed pack into public/solves/ at build and dev time for the browser, and
# that copy is git-ignored.
#
# This script used to write straight into public/solves/. After the M8
# packaging fix that meant publishing into a directory that is both ignored by
# git AND overwritten by the sync script on the next build or dev start — new
# solver output silently vanished. gen-play-catalog.ts and validate.ts already
# read solver/pack/; this was the last file pointing at the old location.
#
# Full pipeline:  ./run-all.sh  ->  ./publish.sh
#                 -> npx tsx solver/gen-play-catalog.ts
#                 -> npx tsx solver/validate.ts
set -e
cd "$(dirname "$0")"
SPOT="srp-btn-bb"
DEST="pack/$SPOT"
mkdir -p "$DEST"

SPOT="$SPOT" python3 - <<'EOF'
import gzip, json, os, pathlib

spot = os.environ["SPOT"]
out = pathlib.Path("out")
dest = pathlib.Path("pack") / spot
flops = []
pot = stack = None
for path in sorted(out.glob("*.json.gz")):
    data = json.loads(gzip.decompress(path.read_bytes()))
    flop = data["flop"]
    (dest / f"{flop}.json").write_text(json.dumps(data, separators=(",", ":")))
    flops.append({"flop": flop, "instances": len(data["instances"])})
    pot, stack = data["pot"], data["stack"]

if pot is None:
    raise SystemExit("no solver output in out/ — run ./run-all.sh first")

manifest = {"spot": spot, "pot": pot, "stack": stack, "flops": flops}
(dest / "index.json").write_text(json.dumps(manifest, separators=(",", ":")))
print(f"published {len(flops)} flops, "
      f"{sum(f['instances'] for f in flops)} instances -> {dest}/")
EOF
du -sh "$DEST"
echo "next: npx tsx solver/gen-play-catalog.ts && npx tsx solver/validate.ts"
