# Release gates

Scripts that verify a shipped milestone against **production**, for the checks
that unit tests structurally cannot reach.

## `m85_release_gate.py`

```
POTLUCK_GATE_OK=1 .venv/bin/python scripts/gate/m85_release_gate.py
```

47 checks. Runs the real FastAPI route functions against the real production
schema with a connection whose `commit()` is a no-op, rolls the transaction back,
then re-reads production on a fresh connection and fails if any counter moved.

It is **not** part of `npm test` or `pytest`, and refuses to run without
`POTLUCK_GATE_OK=1`, because it needs the production `DATABASE_URL`.

Why it exists: the Python suites are pure units by design ("no DB, no HTTP"), so
the SQL half of M8.5 had no automated coverage at all. Its release gate was a
manual click-through, and it stayed unexecuted for that reason. Read
`docs/12-m85-status.md` for what each check proves.

M13's release audit should run this again.

### The two accounts it uses

`ACTIVE` is `tester` (has history); `FRESH` is the account with no attempts and
no progress, which is the closest available stand-in for a new signup. Both are
existing rows — the gate creates no accounts. If either is deleted, update the
constants at the top of the script.

---

## What no gate script can cover

Behaviour that only exists in a browser, and needs a real signup. Claude cannot
create accounts or enter passwords, so these stay manual.

Use a **fresh incognito window per account** — the nudge dismissal is a cookie.

### 1. Signup from a deep link must ignore `?next=`  ← the one that matters

This is the bug that made placement unreachable for every new user. The fix is a
single client-side branch (`app/login/page.tsx:141`) and nothing automated
covers it.

1. Incognito → `https://potluck-poker.vercel.app/learn/3/12`
2. You land on `/login?next=%2Flearn%2F3%2F12`. Click **CREATE ACCOUNT**.
3. Sign up.

**Expected:** `/placement`. Not `/learn/3/12`, not `/drill`.

### 2. Complete placement

Answer the nine questions, getting roughly two-thirds right, using **Not sure**
at least once.

**Expected:** hand-off to `/learn`, entry module visibly above the first, some
lessons already satisfied. Then `/` shows the dashboard and does not redirect.

*(Every row behind this is gate-verified; this confirms the player sees it.)*

### 3. Skip

Second fresh account → `/placement` → **Skip**.

**Expected:** `/learn` at cold start, no further redirect.

### 4. Abandon, and the nudge

Third fresh account → answer exactly 2 questions → navigate to `/`.

**Expected:** the nudge reads **"You left your placement half-finished."** and
links back to `/placement`. It is the only way back in.

Then click **Dismiss** and reload — it must stay gone.

### 5. The explanation is actually shown

On each of the four answer surfaces, answer **Not sure** and confirm the full
explanation appears. The gate proves the grade and the stored row; that the
player is *taught* rather than merely marked wrong is a UI property.

### 6. The nudge disappears after one completed lesson.
