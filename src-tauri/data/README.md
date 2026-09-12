# Offline item database

`p99.sqlite` is a byte-for-byte copy of
[P99 Gear Planner](https://p99planner.com/)'s public browser database, containing
factual item names, stats, and PEQ ID mappings. Its original schema and all item
columns are preserved.
Thanks to Wermhat and the Project 1999 Wiki contributors for compiling this data.
The source URL, checksum, dates, and entry count are recorded in `source.json`.
No Planner application code, artwork, or Wiki article prose is bundled.

The application MIT license does not apply to this snapshot. The publisher's
[About/legal notes](https://p99planner.com/about/) describe the project as free and
open source and retain game-content ownership, but do not specify a database
redistribution license. That permission/terms check remains part of the first
broad release review; this provenance record does not assert a license grant.

The [Planner's source notes](https://p99planner.com/about) describe Wiki-derived
data with some fields backfilled from legacy EQEmu/PEQ. Its metadata identifies
a March 21, 2023 Wiki snapshot, updated by the Planner through September 7, 2026.
These are community reference stats, not a verified export of P99's server DB.
The snapshot can have gaps, including effect activation levels, cast times,
charges, and conflicting variants. The optional Wiki button opens a browser
for further information; item lookup itself never accesses the network.

Lookup uses the original `peqId` reference mapping, never the Planner's internal
row `id` as a game item ID.
Lookup first matches the normalized name, uses the PEQ ID to narrow variants
when possible, and refuses conflicting candidates instead of choosing the first
row. A unique name can still resolve when the server's ID differs. Missing or
ambiguous items show an unavailable state with the optional Wiki link.

The Rust formatter displays classic-era fields only. Weight is in tenths; `nodrop` and
`norent` are inverse flags. Mask/type meanings follow EQEmu's
[item definitions](https://github.com/EQEmu/EQEmu/blob/master/common/item_data.h)
and [deity constants](https://github.com/EQEmu/EQEmu/blob/master/common/deity.h).
Unknown bitmasks and unexpected markup make the item unavailable and fail the
full-catalog Rust test.
Known Beastlord and Vah Shir bits in PEQ-enriched spell scrolls are excluded from
the P99 class/race lists.

The app embeds the 1.39 MiB snapshot and opens its static bytes read-only without
copying them into a separate buffer. The first lookup builds a temporary SQLite
index of normalized names and source row keys. Later lookups query that index and
format only matching rows. SQLite page-cache targets are 256 KiB each for the main
and temporary databases; these are soft cache limits, not a total memory cap.
Lookup runs on a blocking worker, away from the UI thread. The source database
is never modified or copied to writable app storage.

To verify the committed snapshot's checksum, integrity, tables, and row count:

```sh
python3 scripts/import_items.py --check
```

To compare against upstream, download the URL from `source.json` to a temporary
directory, then:

```sh
python3 scripts/import_items.py /path/to/p99.sqlite --check
```

Omit `--check` to copy the verified snapshot unchanged. To update it, review its
provenance, update `source.json`, import it, and run Rust tests. Compare the old
and new `items` tables with SQLite when reviewing item changes; the committed
file is binary. CI verifies the snapshot and formats every row in Rust. Normal
builds use the committed database and do not download data.
