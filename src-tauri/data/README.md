# Offline item cards

`items.json` contains factual item names, stats, and PEQ ID mappings extracted
from [P99 Gear Planner](https://p99planner.com/)'s public browser database.
Thanks to Wermhat and the Project 1999 Wiki contributors for compiling this data.
The source URL, checksum, dates, and entry count are recorded in `source.json`.
No Planner or Pulse application code, artwork, or Wiki article prose is bundled.

The [Planner's source notes](https://p99planner.com/about) describe Wiki-derived
data with some fields backfilled from legacy EQEmu/PEQ. Its metadata identifies
a March 21, 2023 Wiki snapshot, updated by the Planner through September 7, 2026.
These are community reference stats, not a verified export of P99's server DB.
The snapshot can have gaps, including effect activation levels, cast times,
charges, and conflicting variants. The optional Wiki button opens a browser
for further information; item lookup itself never accesses the network.

The import retains `peqId` as `peq_id`, never the Planner's internal row `id`.
Lookup first matches the normalized name, uses the PEQ ID to narrow variants
when possible, and refuses conflicting candidates instead of choosing the first
row. A unique name can still resolve when the server's ID differs. Missing or
ambiguous items show an unavailable state with the optional Wiki link.

The importer formats classic-era fields only. Weight is in tenths; `nodrop` and
`norent` are inverse flags. Mask/type meanings follow EQEmu's
[item definitions](https://github.com/EQEmu/EQEmu/blob/master/common/item_data.h)
and [deity constants](https://github.com/EQEmu/EQEmu/blob/master/common/deity.h).
Unknown bitmasks and unexpected markup fail the import rather than disappearing.
Known Beastlord and Vah Shir bits in PEQ-enriched spell scrolls are excluded from
the P99 class/race lists.

To reproduce, download the URL from `source.json` to a temporary directory, then:

```sh
python3 scripts/import_items.py /path/to/p99.sqlite --check
```

Omit `--check` to regenerate. To update the snapshot, review its provenance,
update `source.json`, regenerate, and run Rust tests. Normal builds use the
committed cards and do not download data. Generated cards stay one per line so
item changes are reviewable.
