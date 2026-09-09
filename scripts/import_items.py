#!/usr/bin/env python3
"""Build offline item cards from a locally downloaded P99 Planner snapshot."""

import argparse
import hashlib
import json
from pathlib import Path
import sqlite3

DATA = Path(__file__).resolve().parents[1] / "src-tauri/data"
SIZES = ("TINY", "SMALL", "MEDIUM", "LARGE", "GIANT")
CLASSES = "WAR CLR PAL RNG SHD DRU MNK BRD ROG SHM NEC WIZ MAG ENC".split()
RACES = "HUM BAR ERU ELF HIE DEF HEF DWF TRL OGR HFL GNM IKS".split()
SLOTS = "CHARM EAR HEAD FACE EAR NECK SHOULDERS ARMS BACK WRIST WRIST RANGE HANDS PRIMARY SECONDARY FINGER FINGER CHEST LEGS FEET WAIST AMMO".split()
DEITIES = (
    "Agnostic", "Bertoxxulous", "Brell Serilis", "Cazic-Thule", "Erollisi Marr",
    "Bristlebane", "Innoruuk", "Karana", "Mithaniel Marr", "Prexus", "Quellious",
    "Rallos Zek", "Rodcet Nife", "Solusek Ro", "The Tribunal", "Tunare", "Veeshan",
)
SKILLS = {0: "1H Slashing", 1: "2H Slashing", 2: "Piercing", 3: "1H Blunt",
          4: "2H Blunt", 5: "Archery", 7: "Throwing", 19: "Throwing",
          35: "2H Piercing", 45: "Hand to Hand"}
STATS = {
    "ac": "AC", "damage": "DMG", "delay": "Delay", "range": "Range",
    "astr": "STR", "adex": "DEX", "asta": "STA", "acha": "CHA",
    "awis": "WIS", "aint": "INT", "aagi": "AGI", "hp": "HP", "mana": "Mana",
    "fr": "SV FIRE", "dr": "SV DISEASE", "cr": "SV COLD", "mr": "SV MAGIC",
    "pr": "SV POISON", "regen": "HP Regen", "manaregen": "Mana Regen",
    "attack": "Attack", "damageshield": "Damage Shield",
}


def mask_names(mask, names, all_label=False, later_bits=0):
    """Expand only recognized classic-era bits, without duplicating paired slots."""
    if mask < 0 or (mask & ~later_bits) >> len(names):
        raise ValueError("Unknown item bitmask")
    mask &= ~later_bits
    if all_label and mask == (1 << len(names)) - 1:
        return "ALL"
    return " ".join(dict.fromkeys(n for i, n in enumerate(names) if mask & (1 << i)))


def item_card(row):
    """Format factual stats; source IDs and client-only expansion fields stay out."""
    flags = []
    if row["magic"]:
        flags.append("MAGIC ITEM")
    if row["loreGroup"]:
        flags.append("LORE ITEM")
    # These source fields follow EQEmu's inverse convention: zero sets the flag.
    if row["nodrop"] == 0:
        flags.append("NO DROP")
    if row["norent"] == 0:
        flags.append("NO RENT")
    lines = [" · ".join(flags)] if flags else []
    if row["slots"]:
        lines.append("Slot: " + mask_names(row["slots"], SLOTS))
    if row["damage"] and row["itemType"] in SKILLS:
        lines.append("Skill: " + SKILLS[row["itemType"]])
    for column, label in STATS.items():
        if row[column]:
            lines.append(f"{label}: {row[column]}")
    if row["haste"]:
        lines.append(f"Haste: {row['haste']}%")
    for column, label in (("clickName", "Click effect"), ("procName", "Combat effect"),
                          ("wornName", "Worn effect"), ("bardName", "Bard effect")):
        if row[column]:
            lines.append(f"{label}: {row[column]}")
    lines.extend((f"WT: {row['weight'] / 10:g}", f"Size: {SIZES[row['size']]}"))
    for column, label, names, later in (("classes", "Class", CLASSES, 1 << 14),
                                      ("races", "Race", RACES, 1 << 13)):
        if row[column]:
            lines.append(f"{label}: {mask_names(row[column], names, all_label=True, later_bits=later)}")
    if row["deity"]:
        lines.append("Deity: " + mask_names(row["deity"], DEITIES))
    if row["bagSlots"]:
        lines.extend((f"Capacity: {row['bagSlots']}", f"Container size: {SIZES[row['bagSize']]}",
                      f"Weight reduction: {row['bagWr']}%"))
    name = row["name"].strip()
    assert name and len(name.encode()) <= 256
    assert 0 < len(lines) <= 64 and sum(len(s.encode()) for s in lines) <= 8192
    assert all(not any(ord(c) < 32 for c in s) for s in [name, *lines])
    assert all("<" not in s and ">" not in s for s in [name, *lines])
    return {"name": name, "peq_id": max(0, row["peqId"] or 0), "lines": lines}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path, help="Downloaded public p99.sqlite snapshot")
    parser.add_argument("--check", action="store_true", help="Compare output without writing")
    args = parser.parse_args()
    source = json.loads((DATA / "source.json").read_text())
    digest = hashlib.sha256(args.database.read_bytes()).hexdigest()
    if digest != source["sha256"]:
        raise SystemExit("Snapshot differs from data/source.json; review the source before importing.")
    with sqlite3.connect(args.database.resolve().as_uri() + "?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA trusted_schema=OFF")
        rows = db.execute("SELECT * FROM items ORDER BY name COLLATE NOCASE, id")
        cards = [item_card(row) for row in rows]
    assert len(cards) == source["item_count"]
    output = "[\n" + ",\n".join(json.dumps(card, ensure_ascii=False, separators=(",", ":")) for card in cards) + "\n]\n"
    target = DATA / "items.json"
    if args.check:
        if target.read_text() != output:
            raise SystemExit("Bundled catalog differs from generated output.")
    else:
        target.write_text(output)
    print(f"Verified {len(cards):,} item cards ({len(output.encode()):,} bytes).")


if __name__ == "__main__":
    main()
