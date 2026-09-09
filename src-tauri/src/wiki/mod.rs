mod tls;

use dom_query::Document;
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex;

const ORIGIN: &str = "https://wiki.project1999.com";
const TTL: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_ITEMS: usize = 128;
const MAX_PAGE_BYTES: usize = 512 * 1024;

#[derive(Clone, Debug, Serialize)]
pub struct ItemDetails {
    pub name: String,
    pub source_url: String,
    pub lines: Vec<String>,
    pub fetched_at: u64,
}

/// A small shared cache; the gate also coalesces simultaneous identical lookups.
#[derive(Default)]
pub struct WikiClient {
    cache: Mutex<HashMap<String, (Instant, ItemDetails)>>,
}

/// Treat names as article titles, never arbitrary URLs or query parameters.
fn title(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty()
        || name.len() > 256
        || name
            .chars()
            .any(|c| c.is_control() || "#<>[]{}|".contains(c))
    {
        return Err("This item has no usable Wiki title.".into());
    }
    Ok(name.replace('_', " "))
}

pub fn page_url(name: &str) -> Result<String, String> {
    let name = title(name)?.replace(' ', "_");
    let mut url = Url::parse(ORIGIN).map_err(|_| "Invalid Wiki address")?;
    url.path_segments_mut()
        .map_err(|_| "Invalid Wiki address")?
        .push(&name);
    Ok(url.into())
}

#[derive(Deserialize)]
struct ParseResponse {
    parse: Option<ParsedPage>,
    error: Option<ApiError>,
}
#[derive(Deserialize)]
struct ApiError {
    code: String,
}
#[derive(Deserialize)]
struct ParsedPage {
    title: String,
    text: HtmlText,
}
#[derive(Deserialize)]
struct HtmlText {
    #[serde(rename = "*")]
    html: String,
}

/// Extract only the item card. Wiki HTML, scripts, ads, and auctions never enter the UI.
fn parse_item(bytes: &[u8]) -> Result<ItemDetails, String> {
    let response: ParseResponse =
        serde_json::from_slice(bytes).map_err(|_| "The Wiki returned an unreadable response.")?;
    if let Some(error) = response.error {
        return Err(if error.code == "missingtitle" {
            "No Wiki page was found for this item."
        } else {
            "The Wiki could not look up this item."
        }
        .into());
    }
    let page = response.parse.ok_or("The Wiki returned no item page.")?;
    let document = Document::fragment(page.text.html);
    let name = document
        .select_single(".itemtitle")
        .text()
        .trim()
        .to_owned();
    if name.is_empty() || !name.eq_ignore_ascii_case(&page.title.replace('_', " ")) {
        return Err("No matching item card was found on this Wiki page.".into());
    }
    let card = document.select_single(".itemdata");
    card.select("script, style, .itemicon, [hidden], .mw-editsection")
        .remove();
    let lines: Vec<String> = card
        .formatted_text()
        .lines()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect();
    if lines.is_empty() || lines.len() > 64 || lines.iter().map(String::len).sum::<usize>() > 8192 {
        return Err("The Wiki item card could not be read.".into());
    }
    Ok(ItemDetails {
        source_url: page_url(&page.title)?,
        name,
        lines,
        fetched_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    })
}

impl WikiClient {
    /// Fetch a public item card on demand; never send account or chat context.
    pub async fn lookup(&self, name: &str) -> Result<ItemDetails, String> {
        let name = title(name)?;
        let mut cache = self.cache.lock().await;
        if let Some((saved, item)) = cache.get(&name) {
            if saved.elapsed() < TTL {
                return Ok(item.clone());
            }
        }
        let client = Client::builder()
            .tls_backend_preconfigured(tls::configuration()?)
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(12))
            .user_agent("P99Mobile/0.1 (https://github.com/rm-you/p99-mobile-client)")
            .build()
            .map_err(|_| "Could not initialize the Wiki connection.")?;
        let mut url =
            Url::parse(&format!("{ORIGIN}/api.php")).map_err(|_| "Invalid Wiki address")?;
        url.query_pairs_mut().extend_pairs([
            ("action", "parse"),
            ("page", &name),
            ("prop", "text"),
            ("format", "json"),
            ("redirects", "1"),
        ]);
        let mut response = client
            .get(url)
            .send()
            .await
            .map_err(|_| "Could not reach the Wiki securely. Check your connection and try again.")?
            .error_for_status()
            .map_err(|_| "The Wiki is unavailable. Please try again later.")?;
        if response
            .content_length()
            .is_some_and(|n| n > MAX_PAGE_BYTES as u64)
        {
            return Err("The Wiki response was too large.".into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "The Wiki connection was interrupted.")?
        {
            if bytes.len() + chunk.len() > MAX_PAGE_BYTES {
                return Err("The Wiki response was too large.".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        let item = parse_item(&bytes)?;
        cache.retain(|_, (saved, _)| saved.elapsed() < TTL);
        if cache.len() >= MAX_ITEMS {
            if let Some(oldest) = cache
                .iter()
                .min_by_key(|(_, (saved, _))| *saved)
                .map(|(key, _)| key.clone())
            {
                cache.remove(&oldest);
            }
        }
        cache.insert(name, (Instant::now(), item.clone()));
        Ok(item)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extracts_text_only_and_ignores_unrelated_page_content() {
        let response = serde_json::json!({"parse":{"title":"Example Blade", "text":{"*":r#"
            <div class="auctrackerbox">An unrelated auction</div>
            <div class="itemtitle">Example Blade</div>
            <div class="itemdata"><div class="itemicon">icon</div><p>MAGIC ITEM<br>Slot: PRIMARY<br>DMG: 12 &amp; more<br><a href="javascript:bad()">Effect: Example</a></p><script>bad()</script></div>"#}}});
        let item = parse_item(&serde_json::to_vec(&response).unwrap()).unwrap();
        assert_eq!(
            item.lines,
            [
                "MAGIC ITEM",
                "Slot: PRIMARY",
                "DMG: 12 & more",
                "Effect: Example"
            ]
        );
        assert_eq!(
            item.source_url,
            "https://wiki.project1999.com/Example_Blade"
        );
    }
    #[test]
    fn rejects_missing_or_mismatched_item_cards() {
        assert!(parse_item(br#"{"error":{"code":"missingtitle"}}"#)
            .unwrap_err()
            .contains("No Wiki page"));
        let response = serde_json::json!({"parse":{"title":"Example Blade", "text":{"*":"<div class=itemtitle>Other item</div><div class=itemdata>DMG: 12</div>"}}});
        assert!(parse_item(&serde_json::to_vec(&response).unwrap()).is_err());
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
