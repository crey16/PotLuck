#!/bin/zsh
# Publish solver output into the app: gunzip out/<flop>.json.gz into
# public/solves/srp-btn-bb/<flop>.json and write the index.json manifest.
set -e
cd "$(dirname "$0")"
SPOT="srp-btn-bb"
DEST="../public/solves/$SPOT"
mkdir -p "$DEST"

python3 - <<'EOF'
import gzip, json, pathlib

out = pathlib.Path("out")
dest = pathlib.Path("../public/solves/srp-btn-bb")
flops = []
for path in sorted(out.glob("*.json.gz")):
    data = json.loads(gzip.decompress(path.read_bytes()))
    flop = data["flop"]
    (dest / f"{flop}.json").write_text(json.dumps(data, separators=(",", ":")))
    flops.append({"flop": flop, "instances": len(data["instances"])})
    pot, stack = data["pot"], data["stack"]

manifest = {"spot": "srp-btn-bb", "pot": pot, "stack": stack, "flops": flops}
(dest / "index.json").write_text(json.dumps(manifest, separators=(",", ":")))
print(f"published {len(flops)} flops, "
      f"{sum(f['instances'] for f in flops)} instances")
EOF
du -sh "$DEST"
