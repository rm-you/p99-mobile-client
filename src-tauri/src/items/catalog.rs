use super::{formatting, ItemDetails};
use rusqlite::{params, Connection, MAIN_DB};

const UNAVAILABLE: &str = "The bundled item catalog could not be read.";
const MISSING: &str =
    "This item is not in the offline catalog. You can look it up on the P99 Wiki.";

pub(super) struct Catalog {
    db: Connection,
}

/// Normalize EQ/Wiki apostrophes and casing without conflating different names.
fn name_key(name: &str) -> String {
    name.trim().replace(['`', '’'], "'").to_lowercase()
}

impl Catalog {
    /// Open the original snapshot directly from static bytes; SQLite cannot modify it.
    pub(super) fn bundled() -> Result<Self, String> {
        let mut db = Connection::open_in_memory().map_err(|_| UNAVAILABLE)?;
        db.deserialize_bytes(MAIN_DB, include_bytes!("../../data/p99.sqlite"))
            .map_err(|_| UNAVAILABLE)?;
        Self::from_connection(db).map_err(|_| UNAVAILABLE.into())
    }

    /// Index only names and row keys, leaving every source column and row unchanged.
    fn from_connection(mut db: Connection) -> rusqlite::Result<Self> {
        db.execute_batch(
            "PRAGMA trusted_schema=OFF;
             PRAGMA cache_size=-256;
             PRAGMA temp_store=MEMORY;
             CREATE TEMP TABLE item_names (
                 name TEXT NOT NULL, row_id INTEGER NOT NULL,
                 PRIMARY KEY (name, row_id)
             ) WITHOUT ROWID;
             PRAGMA temp.cache_size=-256;",
        )?;
        let tx = db.transaction()?;
        {
            let mut rows = tx.prepare("SELECT id, name FROM items ORDER BY id")?;
            let mut insert = tx.prepare("INSERT INTO temp.item_names VALUES (?1, ?2)")?;
            let mut rows = rows.query([])?;
            while let Some(row) = rows.next()? {
                let id: i64 = row.get(0)?;
                let name: String = row.get(1)?;
                insert.execute(params![name_key(&name), id])?;
            }
        }
        tx.commit()?;
        db.execute_batch("PRAGMA query_only=ON")?;
        Ok(Self { db })
    }

    /// Match names first; reference IDs narrow variants but never override the name.
    pub(super) fn lookup(&self, item_id: u32, name: &str) -> Result<ItemDetails, String> {
        let mut statement = self
            .db
            .prepare(
                "SELECT i.id, COALESCE(i.peqId, 0) FROM temp.item_names n
             JOIN items i ON i.id=n.row_id WHERE n.name=?1 ORDER BY i.name COLLATE NOCASE, i.id",
            )
            .map_err(|_| UNAVAILABLE)?;
        let candidates = statement
            .query_map([name_key(name)], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|_| UNAVAILABLE)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|_| UNAVAILABLE)?;
        let id_matches = item_id != 0 && candidates.iter().any(|&(_, id)| id == i64::from(item_id));
        let mut statement = self
            .db
            .prepare("SELECT * FROM items WHERE id=?1")
            .map_err(|_| UNAVAILABLE)?;
        let mut result: Option<ItemDetails> = None;
        for (id, peq_id) in candidates {
            if id_matches && peq_id != i64::from(item_id) {
                continue;
            }
            let mut rows = statement.query([id]).map_err(|_| UNAVAILABLE)?;
            let row = rows.next().map_err(|_| UNAVAILABLE)?.ok_or(UNAVAILABLE)?;
            let details = formatting::item_details(row)
                .map_err(|_| "This item has unsupported data. Check the P99 Wiki for details.")?;
            if let Some(first) = &result {
                if first.lines != details.lines {
                    return Err("The offline catalog has conflicting versions of this item. Check the P99 Wiki for details.".into());
                }
            } else {
                result = Some(details);
            }
        }
        result.ok_or_else(|| MISSING.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Catalog {
        let source = Catalog::bundled().unwrap();
        let schema: String = source
            .db
            .query_row(
                "SELECT sql FROM sqlite_master WHERE name='items'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(&schema).unwrap();
        for (name, id, ac) in [
            ("Example Blade", 42, 12),
            ("Example Blade", 43, 18),
            ("Other Item", 43, 5),
            ("Mage's Orb", 90, 10),
            ("Conflicting Item", 50, 1),
            ("Conflicting Item", 50, 2),
        ] {
            db.execute(
                "INSERT INTO items (name,peqId,ac) VALUES (?1,?2,?3)",
                params![name, id, ac],
            )
            .unwrap();
        }
        Catalog::from_connection(db).unwrap()
    }

    #[test]
    fn reference_ids_never_override_names_and_conflicts_are_not_guessed() {
        let catalog = fixture();
        assert!(catalog
            .lookup(42, "example blade")
            .unwrap()
            .lines
            .contains(&"AC: 12".into()));
        assert!(catalog
            .lookup(43, "Example Blade")
            .unwrap()
            .lines
            .contains(&"AC: 18".into()));
        assert!(catalog
            .lookup(43, "Other Item")
            .unwrap()
            .lines
            .contains(&"AC: 5".into()));
        assert!(catalog
            .lookup(0, "  MAGE`S ORB ")
            .unwrap()
            .lines
            .contains(&"AC: 10".into()));
        assert!(catalog.lookup(0, "Example Blade").is_err());
        assert!(catalog.lookup(50, "Conflicting Item").is_err());
        assert!(catalog.lookup(42, "Missing item").is_err());
        assert!(catalog.lookup(42, "' OR 1=1 --").is_err());
    }

    #[test]
    fn bundled_snapshot_is_read_only_and_every_row_formats() {
        let catalog = Catalog::bundled().unwrap();
        assert!(catalog.db.execute("DELETE FROM items", []).is_err());
        assert!(catalog
            .db
            .execute("DELETE FROM temp.item_names", [])
            .is_err());
        let mut statement = catalog
            .db
            .prepare("SELECT * FROM items ORDER BY id")
            .unwrap();
        let mut entries = statement.query([]).unwrap();
        let mut count = 0;
        while let Some(row) = entries.next().unwrap() {
            let details = formatting::item_details(row).unwrap();
            assert!(!details.lines.is_empty());
            count += 1;
        }
        assert_eq!(count, 12122);
        assert!(catalog
            .lookup(1365, "Flowing Black Silk Sash")
            .unwrap()
            .lines
            .contains(&"Haste: 21%".into()));
        assert!(!catalog
            .lookup(1365, "Flowing Black Silk Sash")
            .unwrap()
            .lines
            .iter()
            .any(|s| s.contains("NO DROP")));
        assert!(catalog
            .lookup(0, "Fiery Defender")
            .unwrap()
            .lines
            .iter()
            .any(|s| s.contains("NO DROP")));
        let mut plan=catalog.db.prepare("EXPLAIN QUERY PLAN SELECT i.id FROM temp.item_names n JOIN items i ON i.id=n.row_id WHERE n.name=?1").unwrap();
        let plan = plan
            .query_map(["example"], |row| row.get::<_, String>(3))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert!(plan.iter().all(|step| !step.contains("SCAN")), "{plan:?}");
    }
}
