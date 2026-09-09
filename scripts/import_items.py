#!/usr/bin/env python3
"""Verify or copy an original P99 Planner SQLite snapshot without transforming it."""

import argparse
import hashlib
import json
from pathlib import Path
import sqlite3

DATA = Path(__file__).resolve().parents[1] / "src-tauri/data"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path, nargs="?", default=DATA / "p99.sqlite",
                        help="Downloaded public snapshot (defaults to the bundled database)")
    parser.add_argument("--check", action="store_true", help="Verify without writing")
    args = parser.parse_args()
    source = json.loads((DATA / "source.json").read_text())
    snapshot = args.database.read_bytes()
    if hashlib.sha256(snapshot).hexdigest() != source["sha256"]:
        raise SystemExit("Snapshot differs from data/source.json; review the source before importing.")
    with sqlite3.connect(args.database.resolve().as_uri() + "?mode=ro", uri=True) as db:
        db.execute("PRAGMA trusted_schema=OFF")
        if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise SystemExit("Snapshot failed SQLite integrity checks.")
        tables = db.execute("SELECT name FROM sqlite_schema WHERE type='table'").fetchall()
        if tables != [("items",)]:
            raise SystemExit("Snapshot contains unexpected tables; review before importing.")
        count = db.execute("SELECT COUNT(*) FROM items").fetchone()[0]
        if count != source["item_count"]:
            raise SystemExit("Snapshot item count differs from data/source.json.")
    target = DATA / "p99.sqlite"
    if args.check:
        if target.read_bytes() != snapshot:
            raise SystemExit("Bundled database differs from the original snapshot.")
    elif args.database.resolve() != target.resolve():
        target.write_bytes(snapshot)
    print(f"Verified original SQLite snapshot: {count:,} items, {len(snapshot):,} bytes.")


if __name__ == "__main__":
    main()
