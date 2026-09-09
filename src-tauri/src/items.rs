use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::OnceLock};
use url::Url;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ItemDetails {
    pub name: String,
    pub lines: Vec<String>,
}

#[derive(Deserialize)]
struct CatalogEntry {
    #[serde(flatten)]
    details: ItemDetails,
    // A reference mapping, not the Planner's own internal row ID.
    peq_id: u32,
}

struct Catalog {
    entries: Vec<CatalogEntry>,
    names: HashMap<String, Vec<usize>>,
}

/// Normalize EQ/Wiki apostrophes and casing without conflating different names.
fn name_key(name: &str) -> String {
    name.trim().replace(['`', '’'], "'").to_lowercase()
}

impl Catalog {
    fn parse(json: &str) -> Result<Self, String> {
        let entries: Vec<CatalogEntry> = serde_json::from_str(json)
            .map_err(|_| "The bundled item catalog could not be read.")?;
        let mut names = HashMap::<String, Vec<usize>>::new();
        for (index, entry) in entries.iter().enumerate() {
            names
                .entry(name_key(&entry.details.name))
                .or_default()
                .push(index);
        }
        Ok(Self { entries, names })
    }

    /// Require a matching name; reference IDs only narrow otherwise ambiguous variants.
    fn lookup(&self, item_id: u32, name: &str) -> Result<ItemDetails, String> {
        let indices = self.names.get(&name_key(name)).ok_or(
            "This item is not in the offline catalog. You can look it up on the P99 Wiki.",
        )?;
        let id_matches = item_id != 0 && indices.iter().any(|&i| self.entries[i].peq_id == item_id);
        let mut candidates = indices
            .iter()
            .map(|&i| &self.entries[i])
            .filter(|entry| !id_matches || entry.peq_id == item_id);
        let first = candidates
            .next()
            .ok_or("No matching item details were found.")?;
        if candidates.any(|entry| entry.details.lines != first.details.lines) {
            return Err("The offline catalog has conflicting versions of this item. Check the P99 Wiki for details.".into());
        }
        Ok(first.details.clone())
    }
}

/// Load once from the application binary; item requests never open network connections.
pub fn lookup(item_id: u32, name: &str) -> Result<ItemDetails, String> {
    static CATALOG: OnceLock<Result<Catalog, String>> = OnceLock::new();
    CATALOG
        .get_or_init(|| Catalog::parse(include_str!("../data/items.json")))
        .as_ref()
        .map_err(Clone::clone)?
        .lookup(item_id, name)
}

/// Keep the explicit browser action confined to an encoded P99 Wiki article path.
pub fn page_url(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty()
        || name.len() > 256
        || name
            .chars()
            .any(|c| c.is_control() || "#<>[]{}|".contains(c))
    {
        return Err("This item has no usable Wiki title.".into());
    }
    let mut url = Url::parse("https://wiki.project1999.com").map_err(|_| "Invalid Wiki address")?;
    url.path_segments_mut()
        .map_err(|_| "Invalid Wiki address")?
        .push(&name.replace(' ', "_"));
    Ok(url.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reference_ids_never_override_names_and_conflicts_are_not_guessed() {
        let catalog = Catalog::parse(
            r#"[
            {"name":"Example Blade","peq_id":42,"lines":["DMG: 12"]},
            {"name":"Example Blade","peq_id":43,"lines":["DMG: 18"]},
            {"name":"Other Item","peq_id":42,"lines":["AC: 5"]},
            {"name":"Mage's Orb","peq_id":90,"lines":["Mana: 10"]},
            {"name":"Conflicting Item","peq_id":50,"lines":["AC: 1"]},
            {"name":"Conflicting Item","peq_id":50,"lines":["AC: 2"]}
        ]"#,
        )
        .unwrap();
        assert_eq!(
            catalog.lookup(42, "example blade").unwrap().lines,
            ["DMG: 12"]
        );
        assert_eq!(
            catalog.lookup(43, "Example Blade").unwrap().lines,
            ["DMG: 18"]
        );
        assert_eq!(catalog.lookup(43, "Other Item").unwrap().lines, ["AC: 5"]);
        assert_eq!(
            catalog.lookup(0, "  MAGE`S ORB ").unwrap().lines,
            ["Mana: 10"]
        );
        assert!(catalog.lookup(0, "Example Blade").is_err());
        assert!(catalog.lookup(50, "Conflicting Item").is_err());
        assert!(catalog.lookup(42, "Missing item").is_err());
    }

    #[test]
    fn bundled_cards_are_valid_and_read_without_network_or_game_files() {
        let catalog = Catalog::parse(include_str!("../data/items.json")).unwrap();
        assert_eq!(catalog.entries.len(), 12122);
        for entry in &catalog.entries {
            let item = &entry.details;
            assert!(!item.name.is_empty() && item.name.len() <= 256);
            assert!(!item.lines.is_empty() && item.lines.len() <= 64);
            assert!(item.lines.iter().map(String::len).sum::<usize>() <= 8192);
            assert!(item.lines.iter().all(|line| !line.contains(['<', '>'])));
        }
        // Known public item data, not packet captures or account fixtures.
        let sash = lookup(1365, "Flowing Black Silk Sash").unwrap();
        assert!(sash.lines.contains(&"Haste: 21%".into()));
        assert!(sash.lines.contains(&"WT: 0.1".into()));
        assert!(!sash.lines.iter().any(|s| s.contains("NO DROP")));
        assert!(lookup(0, "Fiery Defender")
            .unwrap()
            .lines
            .iter()
            .any(|s| s.contains("NO DROP")));
    }

    #[test]
    fn article_names_cannot_change_the_destination() {
        for name in [
            "../api.php?token=x",
            "https://evil.test/",
            "An Item/Variant",
            "A's & B's",
        ] {
            let url = Url::parse(&page_url(name).unwrap()).unwrap();
            assert_eq!(url.host_str(), Some("wiki.project1999.com"));
            assert_eq!(url.scheme(), "https");
            assert!(url.query().is_none());
        }
        assert!(page_url("bad\nname").is_err());
    }
}
