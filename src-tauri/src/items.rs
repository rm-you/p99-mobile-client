mod catalog;
mod formatting;

use catalog::Catalog;
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use url::Url;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ItemDetails {
    pub name: String,
    pub lines: Vec<String>,
}

/// Query the bundled database lazily, retaining only SQLite's cache and name index.
pub fn lookup(item_id: u32, name: &str) -> Result<ItemDetails, String> {
    static CATALOG: OnceLock<Result<Mutex<Catalog>, String>> = OnceLock::new();
    CATALOG
        .get_or_init(|| Catalog::bundled().map(Mutex::new))
        .as_ref()
        .map_err(Clone::clone)?
        .lock()
        .map_err(|_| "The item catalog is unavailable.")?
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
