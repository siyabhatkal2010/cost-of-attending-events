#!/usr/bin/env python3
"""
Cut the BTS Consumer Airfare Report down to just what the site needs.

    python3 scripts/build_airfares.py Consumer_Airfare_Report.csv
    python3 scripts/build_airfares.py Consumer_Airfare_Report.csv --top 50

What it does
  1. Reads the list of cities on the service from data/synthetic_25_metro_city_costs.csv
     (columns: metro,state; first row = rank 1). --top N keeps only the first N rows.
  2. Matches each city to its BTS market automatically ("Dallas" -> "Dallas/Fort Worth, TX",
     "New York" -> "New York City, NY (Metropolitan Area)"). Anything it can't match is
     reported by name so you can add an alias (see ALIASES below).
  3. Keeps only the most recent N quarters in the file (default 4) and only pairs where BOTH
     ends are one of your cities.
  4. Cleans the data: "$238.05 " -> 238.05, "18,659" -> 18659, "32,467" -> 32467,
     BTS city names -> your city names. Drops the Geocoded_* columns.

Outputs (in data/ by default)
  airfares_clean.csv          one row per city pair per quarter (cleaned, 4 quarters)
  airfares_by_city_pair.csv   one row per city pair: passenger-weighted average fare.
                              This is the file the website loads.

The source doesn't say whether fares are one-way or round-trip; the site treats them as
round-trip averages.
"""
import argparse, csv, difflib, itertools, os, re, sys
from collections import defaultdict

# Cities BTS doesn't list under their own name. key = your city name,
# value = the exact BTS market name (copy it from the CSV's city1/city2 columns).
# BTS counts BWI inside the Washington market, so Baltimore shares Washington's fares.
ALIASES = {
    "Baltimore": "Washington, DC (Metropolitan Area)",
}

# Paths are resolved from the project folder (the parent of scripts/), not from wherever you
# happen to run the command, so it works from any directory.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def project_path(p): return p if os.path.isabs(p) else os.path.join(ROOT, p)

def money(s):  return float(re.sub(r"[^0-9.\-]", "", s))            # "$1,238.05 " -> 1238.05
def whole(s):  return int(float(re.sub(r"[^0-9.\-]", "", s)))       # "18,659" -> 18659
def mid(s):    return re.sub(r"[^0-9]", "", s)                      # "32,467" -> "32467"
def norm(s):   return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()

def bts_parts(name):
    """'Dallas/Fort Worth, TX' -> (['dallas','fort worth'], 'TX'); drops '(Metropolitan Area)'."""
    base = re.sub(r"\(.*?\)", "", name).strip()
    city, _, state = base.rpartition(",")
    return [norm(p) for p in city.split("/")], state.strip().upper()

def match_market(city, state, markets):
    """Return the BTS market name for one of our cities, or None."""
    if city in ALIASES:
        return ALIASES[city] if ALIASES[city] in markets else None
    c = norm(city)
    hits = []
    for name in markets:
        parts, st = bts_parts(name)
        if state and st != state.upper():
            continue
        # exact city, one half of "A/B", or "<city> city" (New York City)
        if c in parts or any(p == c + " city" for p in parts):
            hits.append(name)
    return hits[0] if len(hits) == 1 else None

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", help="Consumer_Airfare_Report CSV from BTS")
    ap.add_argument("--cities", default="data/synthetic_25_metro_city_costs.csv",
                    help="CSV of cities on the service, with 'metro' and 'state' columns")
    ap.add_argument("--top", type=int, help="only use the first N cities in that file")
    ap.add_argument("--quarters", type=int, default=4, help="how many recent quarters to keep (default 4)")
    ap.add_argument("--out-dir", default="data")
    a = ap.parse_args()

    cities_path = project_path(a.cities)
    if not os.path.exists(cities_path):
        sys.exit(f"Can't find the cities file: {cities_path}\n"
                 "Copy data/synthetic_25_metro_city_costs.csv from your project into that folder, "
                 "or pass its location with --cities.")
    # Look for the report as typed (relative to where you ran the command), then relative to
    # the project folder, then inside data/. So "CAR.csv" works if the file is in data/.
    candidates = [a.source, project_path(a.source), os.path.join(ROOT, "data", a.source)]
    source = next((c for c in candidates if os.path.isfile(c)), None)
    if source is None:
        sys.exit("Can't find the airfare report. Looked in:\n  " + "\n  ".join(os.path.abspath(c) for c in candidates))
    out_dir = project_path(a.out_dir)
    os.makedirs(out_dir, exist_ok=True)

    with open(cities_path, newline="", encoding="utf-8-sig") as f:
        cities = [(r["metro"].strip(), r.get("state", "").strip()) for r in csv.DictReader(f) if r.get("metro")]
    if a.top: cities = cities[:a.top]

    with open(source, newline="", encoding="utf-8-sig") as f:
        rows = [r for r in csv.DictReader(f) if r.get("fare", "").strip()]

    # Every market name in the file, then match each of our cities to one
    markets = {r["city1"] for r in rows} | {r["city2"] for r in rows}
    market_to_cities, unmatched = defaultdict(list), []
    for city, state in cities:
        m = match_market(city, state, markets)
        if m: market_to_cities[m].append(city)
        else: unmatched.append((city, state))

    if unmatched:
        print(f"WARNING: no BTS market found for {len(unmatched)} of {len(cities)} cities:")
        for city, state in unmatched:
            close = difflib.get_close_matches(f"{city}, {state}", markets, n=3, cutoff=0.5)
            print(f"  - {city}, {state}   closest BTS names: {close or 'none'}")
        print("  Add each one to ALIASES in this script (or fix the spelling in the cities file).\n")

    # Most recent quarters only
    periods = sorted({(int(r["Year"]), int(r["quarter"])) for r in rows})[-a.quarters:]
    keep = set(periods)
    label = f"{periods[0][0]}Q{periods[0][1]}-{periods[-1][0]}Q{periods[-1][1]}"

    clean, agg = [], defaultdict(lambda: {"fare_x_pax": 0.0, "pax": 0, "miles": 0, "quarters": 0})
    for r in rows:
        if (int(r["Year"]), int(r["quarter"])) not in keep: continue
        m1, m2 = r["city1"], r["city2"]
        if m1 not in market_to_cities or m2 not in market_to_cities or m1 == m2: continue
        pax, fare = whole(r["passengers"]), money(r["fare"])
        for c1, c2 in itertools.product(market_to_cities[m1], market_to_cities[m2]):
            x, y = sorted((c1, c2))                    # one orientation per pair: A < B
            clean.append({
                "year": int(r["Year"]), "quarter": int(r["quarter"]),
                "city_a": x, "city_b": y,
                "citymarketid_a": mid(r["citymarketid_1"] if c1 == x else r["citymarketid_2"]),
                "citymarketid_b": mid(r["citymarketid_2"] if c1 == x else r["citymarketid_1"]),
                "nsmiles": whole(r["nsmiles"]), "passengers": pax, "fare": fare,
                "carrier_lg": r["carrier_lg"], "fare_lg": money(r["fare_lg"]) if r["fare_lg"].strip() else "",
                "carrier_low": r["carrier_low"], "fare_low": money(r["fare_low"]) if r["fare_low"].strip() else "",
            })
            g = agg[(x, y)]
            g["fare_x_pax"] += fare * pax; g["pax"] += pax; g["miles"] = whole(r["nsmiles"]); g["quarters"] += 1

    clean.sort(key=lambda r: (r["city_a"], r["city_b"], r["year"], r["quarter"]))
    averaged = [{"city_a": x, "city_b": y, "avg_fare": round(g["fare_x_pax"] / g["pax"], 2),
                 "passengers": g["pax"], "nsmiles": g["miles"], "quarters": g["quarters"], "period": label}
                for (x, y), g in sorted(agg.items())]

    def write(name, data):
        path = os.path.join(out_dir, name)
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(data[0])); w.writeheader(); w.writerows(data)
        return path
    if not clean: sys.exit("No matching city pairs found; nothing written.")
    p1, p2 = write("airfares_clean.csv", clean), write("airfares_by_city_pair.csv", averaged)

    matched = sum(len(v) for v in market_to_cities.values())
    possible = matched * (matched - 1) // 2
    print(f"Quarters kept: {label}")
    print(f"Cities matched: {matched} of {len(cities)}")
    print(f"Wrote {p1} ({len(clean)} rows)")
    print(f"Wrote {p2} ({len(averaged)} pairs of {possible} possible)")
    have = set(agg)
    names = sorted(c for v in market_to_cities.values() for c in v)
    missing = [p for p in itertools.combinations(names, 2) if p not in have]
    if missing:
        print(f"{len(missing)} pairs have no fare (the site hides those events in Flight mode):")
        print("  " + "; ".join(f"{x}-{y}" for x, y in missing))

main()