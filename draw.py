"""The weekly disagreement log's sample: exactly 20 listings, drawn by a rule anyone can run again (frozen Day 263, 2026-10-20,
before any draw, after clearreason_assistant asked on Moltbook for n and the algorithm to be fixed). The rules: disagreements/RULES.md.

The population is every listing in the published directory.json, both lists (`places` and `not_answering`), named by `slug`.
The seed is the date of the Sunday the weekly look belongs to, written YYYY-MM-DD. Each slug is ranked by the SHA-256 of the UTF-8
text "<date>|<slug>", in lowercase hex, smallest first, and the draw is the first 20 (every listing, if there are fewer). There is no
random library in it, so any language with SHA-256 draws the same 20. Each digest printed is computed again by `shasum -a 256`,
which shares no code with Python's hashlib, and a disagreement stops the draw.

Usage: python3 -B draw.py DATE [DIRECTORY_JSON]   (default: site/directory.json; DATE must be a Sunday, and not after today,
                                                   so the sample cannot be seen before the day of the look)
       python3 -B draw.py --selftest              (made-up listings only; it never draws from the real file)
Exit:  0 drawn, or the selftest passed · 1 the selftest failed · 2 refused (the date, the listings, or shasum disagreeing)"""
import datetime, hashlib, json, subprocess, sys, tempfile
from pathlib import Path

N = 20
HERE = Path(__file__).resolve().parent

def digest(date, slug):
    return hashlib.sha256(f"{date}|{slug}".encode("utf-8")).hexdigest()

def population(data):
    slugs = [e.get("slug") for e in (data.get("places") or []) + (data.get("not_answering") or [])]
    if any(not s for s in slugs): raise ValueError("a listing has no slug")
    if len(set(slugs)) != len(slugs): raise ValueError("a slug appears twice")
    return slugs

def draw(date, slugs):
    return sorted(slugs, key=lambda s: (digest(date, s), s))[:N]

def shasum(text):
    out = subprocess.run(["/usr/bin/shasum", "-a", "256"], input=text.encode("utf-8"), capture_output=True, check=True).stdout
    return out.split()[0].decode()

def check_date(text, today):
    """None if TEXT may seed a real draw today, else the reason it may not."""
    try:
        d = datetime.date.fromisoformat(text)
    except ValueError:
        return f"{text!r} is not a date"
    if d.isoformat() != text: return f"{text!r} is not written YYYY-MM-DD"
    if d.weekday() != 6: return f"{text} is a {d:%A}; the seed is the Sunday the weekly look belongs to"
    if d > today: return f"{text} is after today; the draw is made on the day of the look, never before"
    return None

def run(argv, today, out=print):
    if len(argv) not in (1, 2):
        out(__doc__); return 2
    date = argv[0]
    why = check_date(date, today)
    if why:
        out(f"REFUSED: {why}"); return 2
    src = Path(argv[1]) if len(argv) == 2 else HERE / "site" / "directory.json"
    raw = src.read_bytes()
    data = json.loads(raw)
    try:
        slugs = population(data)
    except ValueError as e:
        out(f"REFUSED: {e}"); return 2
    picked = draw(date, slugs)
    for s in picked:
        if shasum(f"{date}|{s}") != digest(date, s):
            out(f"REFUSED: shasum and hashlib disagree on {s}"); return 2
    for s in picked: out(f"{digest(date, s)}  {s}")
    out(f"drew {len(picked)} of {len(slugs)} listings ({len(data.get('places') or [])} listed, "
        f"{len(data.get('not_answering') or [])} not answering) for {date}; {src} sha256 {hashlib.sha256(raw).hexdigest()}")
    return 0

# ---- selftest: made-up listings, each case independent of the code it checks where it can be ----

FIXTURE = {"places": [{"slug": f"place-{i:02d}"} for i in range(24)], "not_answering": [{"slug": f"gone-{i}"} for i in range(7)]}
SUNDAY = "2026-01-25"

def by_shasum(date, slugs, n):
    """The rule done again with the outside tool and the number written here, not the module's digest, draw or N."""
    return [s for _, s in sorted((shasum(f"{date}|{s}"), s) for s in slugs)][:n]

def case_matches_shasum():
    return draw(SUNDAY, population(FIXTURE)) == by_shasum(SUNDAY, [e["slug"] for e in FIXTURE["places"] + FIXTURE["not_answering"]], 20)

def case_fewer_than_n_takes_all():
    small = {"places": [{"slug": f"p{i}"} for i in range(5)], "not_answering": [{"slug": "q0"}, {"slug": "q1"}]}
    got = draw(SUNDAY, population(small))
    return got == by_shasum(SUNDAY, ["p0", "p1", "p2", "p3", "p4", "q0", "q1"], 7)

def case_both_lists_drawn():
    # all seven not-answering listings are in the population, so a draw of every listing must hold them
    return set(population(FIXTURE)) == {e["slug"] for e in FIXTURE["places"] + FIXTURE["not_answering"]}

def case_date_changes_the_draw():
    return draw(SUNDAY, population(FIXTURE)) != draw("2026-02-01", population(FIXTURE))

def case_refuses_duplicates():
    try:
        population({"places": [{"slug": "a"}, {"slug": "a"}], "not_answering": []})
    except ValueError:
        return True
    return False

def case_cli_refuses_early_and_odd_dates():
    today = datetime.date(2026, 1, 27)               # a Tuesday
    with tempfile.TemporaryDirectory() as tmp:
        f = Path(tmp) / "directory.json"; f.write_text(json.dumps(FIXTURE))
        lines = []
        codes = [run([d, str(f)], today, lines.append) for d in ("2026-02-01", "2026-01-27", "2026-1-25", "20260125", "2026-01-25")]
    drawn = [l for l in lines if len(l.split()) == 2 and len(l.split()[0]) == 64]
    return codes == [2, 2, 2, 2, 0] and len(drawn) == 20

CASES = {f.__name__[5:]: f for f in (case_matches_shasum, case_fewer_than_n_takes_all, case_both_lists_drawn,
                                      case_date_changes_the_draw, case_refuses_duplicates, case_cli_refuses_early_and_odd_dates)}

# One-line changes to the rule, each with the cases it must break, written before any run. The last is wrong on purpose:
# with seven listings, n = 19 still takes all seven, so that case cannot fail, and the harness must refuse the claim.
def _no_separator(date, slug): return hashlib.sha256(f"{date}{slug}".encode("utf-8")).hexdigest()
def _largest_first(date, slugs): return sorted(slugs, key=lambda s: (digest(date, s), s), reverse=True)[:N]
def _places_only(data):
    slugs = [e.get("slug") for e in data.get("places") or []]
    if len(set(slugs)) != len(slugs): raise ValueError("a slug appears twice")
    return slugs
def _duplicates_allowed(data): return [e.get("slug") for e in (data.get("places") or []) + (data.get("not_answering") or [])]
def _no_future_check(text, today):
    try:
        d = datetime.date.fromisoformat(text)
    except ValueError:
        return "refused"
    return None if d.isoformat() == text and d.weekday() == 6 else "refused"

SABOTAGES = [
    ("no separator in the hashed text", {"digest": _no_separator}, {"matches_shasum", "fewer_than_n_takes_all", "cli_refuses_early_and_odd_dates"}),
    ("largest digest first", {"draw": _largest_first}, {"matches_shasum", "fewer_than_n_takes_all"}),
    ("n = 19", {"N": 19}, {"matches_shasum", "cli_refuses_early_and_odd_dates"}),
    ("not-answering listings left out", {"population": _places_only}, {"matches_shasum", "fewer_than_n_takes_all", "both_lists_drawn"}),
    ("a repeated slug let through", {"population": _duplicates_allowed}, {"refuses_duplicates"}),
    ("a future Sunday allowed", {"check_date": _no_future_check}, {"cli_refuses_early_and_odd_dates"}),
]
WRONG_ON_PURPOSE = ("n = 19, claimed to break the small case", {"N": 19}, {"fewer_than_n_takes_all"})

def failing():
    out = set()
    for name, f in CASES.items():
        try:
            ok = f()
        except Exception:
            ok = False
        if not ok: out.add(name)
    return out

def under(patch):
    g = globals(); saved = {k: g[k] for k in patch}
    g.update(patch)
    try:
        return failing()
    finally:
        g.update(saved)

def selftest():
    bad = 0
    clean = failing()
    print(f"{'ok  ' if not clean else 'FAIL'} the rule as written: {len(CASES) - len(clean)} of {len(CASES)} cases pass" + (f" (failing: {sorted(clean)})" if clean else ""))
    bad += bool(clean)
    for name, patch, expected in SABOTAGES:
        got = under(patch)
        ok = got == expected
        print(f"{'ok  ' if ok else 'FAIL'} sabotage '{name}': breaks {sorted(got)}" + ("" if ok else f", expected {sorted(expected)}"))
        bad += not ok
    name, patch, claimed = WRONG_ON_PURPOSE
    got = under(patch)
    refused = bool(got) and got != claimed          # Day 263: a patch that broke nothing refuses nothing
    print(f"{'ok  ' if refused else 'FAIL'} wrong on purpose '{name}': {'refused' if refused else 'BROKE NOTHING' if not got else 'ACCEPTED'} (it breaks {sorted(got)})")
    bad += not refused
    print("selftest:", "PASS" if not bad else f"FAIL ({bad})")
    return 0 if not bad else 1

if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]: sys.exit(selftest())
    sys.exit(run(sys.argv[1:], datetime.date.today()))
