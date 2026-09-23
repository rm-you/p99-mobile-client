use crate::history::{ChatStore, HistoryOwner, HistoryProfile};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_session_service::SessionService;

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    Text,
    Jsonl,
}
#[derive(Serialize)]
pub struct Document {
    pub text: String,
    pub format: &'static str,
}
/// SQLite work uses a blocking worker so large exports never block native UI dispatch.
async fn with_store<T: Send + 'static>(
    app: tauri::AppHandle,
    work: impl FnOnce(&ChatStore) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || work(&app.state::<ChatStore>()))
        .await
        .map_err(|_| "Chat history is unavailable.".to_string())?
}
#[tauri::command]
pub async fn history_profiles(app: tauri::AppHandle) -> Result<Vec<HistoryProfile>, String> {
    with_store(app, ChatStore::profiles).await
}
#[tauri::command]
pub async fn load_history(
    owner: HistoryOwner,
    app: tauri::AppHandle,
) -> Result<Vec<Value>, String> {
    with_store(app, move |store| store.load(&owner, 1500)).await
}
#[tauri::command]
pub async fn clear_history(app: tauri::AppHandle) -> Result<(), String> {
    with_store(app, ChatStore::clear).await
}
/// Export full structured records or a readable transcript; no credentials enter this path.
#[tauri::command]
pub async fn export_history(
    owner: HistoryOwner,
    format: ExportFormat,
    app: tauri::AppHandle,
) -> Result<Document, String> {
    with_store(app, move |store| {
        export_records(store.load(&owner, 10000)?, format)
    })
    .await
}
fn export_records(records: Vec<Value>, format: ExportFormat) -> Result<Document, String> {
    let (text, extension) = match format {
        ExportFormat::Jsonl => (
            records.iter().map(|v| v.to_string() + "\n").collect(),
            "jsonl",
        ),
        ExportFormat::Text => (
            records
                .iter()
                .map(|v| {
                    format!(
                        "[{}] {} {}{}: {}\n",
                        v["timestamp"].as_str().unwrap_or_default(),
                        v["channel_name"].as_str().unwrap_or("system"),
                        v["sender"].as_str().unwrap_or("Norrath"),
                        v["target"]
                            .as_str()
                            .map(|s| format!(" → {s}"))
                            .unwrap_or_default(),
                        crate::history::record_text(v)
                    )
                })
                .collect(),
            "txt",
        ),
    };
    Ok(Document {
        text,
        format: extension,
    })
}
#[tauri::command]
pub async fn share_document(
    text: String,
    format: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if text.len() > 20_000_000 || !["txt", "jsonl", "json"].contains(&format.as_str()) {
        return Err("Export is too large or has an unsupported format.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<SessionService<tauri::Wry>>()
            .document(false, &text, &format)
    })
    .await
    .map_err(|_| "Could not share export.".to_string())?
}
#[tauri::command]
pub async fn copy_message(text: String, app: tauri::AppHandle) -> Result<(), String> {
    if text.len() > 100_000 {
        return Err("Message is too large to copy.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<SessionService<tauri::Wry>>()
            .document(true, &text, "txt")
    })
    .await
    .map_err(|_| "Could not copy message.".to_string())?
}
#[tauri::command]
pub fn app_info() -> Value {
    json!({"version":env!("CARGO_PKG_VERSION"),"build_id":env!("P99_BUILD_ID"),"network_revision":env!("P99_NETWORK_REVISION"),"platform":std::env::consts::OS,"notifications_supported":cfg!(mobile)})
}

/// Request alert permission only in response to an explicit preference change.
#[tauri::command]
pub async fn request_notification_permission(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<SessionService<tauri::Wry>>()
            .request_alert_permission()
    })
    .await
    .map_err(|_| "Could not request notification permission.".to_string())?
}
#[tauri::command]
pub async fn export_diagnostics(app: tauri::AppHandle) -> Result<Document, String> {
    with_store(app, |store| {
        Ok(Document {
            text: json!({"app":app_info(),"chat":store.diagnostics()}).to_string(),
            format: "json",
        })
    })
    .await
}
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InfoLink {
    Source,
    Issues,
    Credits,
    Licenses,
    Privacy,
}
#[tauri::command]
pub fn open_info_link(link: InfoLink, app: tauri::AppHandle) -> Result<(), String> {
    let url = match link {
        InfoLink::Source => "https://github.com/rm-you/p99-mobile-client",
        InfoLink::Issues => "https://github.com/rm-you/p99-mobile-client/issues",
        InfoLink::Credits => {
            "https://github.com/rm-you/p99-mobile-client/blob/main/src-tauri/data/README.md"
        }
        InfoLink::Licenses => {
            "https://github.com/rm-you/p99-mobile-client/blob/main/DEPENDENCIES.md"
        }
        InfoLink::Privacy => "https://github.com/rm-you/p99-mobile-client/blob/main/PRIVACY.md",
    };
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "Could not open your browser.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exports_preserve_full_link_data_and_formatted_text() {
        let record = json!({"type":"chat","timestamp":"synthetic-time","sender":"ExampleFriend","arguments":[{"text":"Synthetic item","item_links":[{"body":"synthetic-link","item_id":42}]}]});
        let text = export_records(vec![record.clone()], ExportFormat::Text).unwrap();
        assert!(text.text.contains("Synthetic item"));
        let jsonl = export_records(vec![record.clone()], ExportFormat::Jsonl).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(jsonl.text.trim()).unwrap(),
            record
        );
    }
    #[test]
    fn diagnostic_allowlist_contains_no_profile_or_message_data() {
        let dir = tempfile::tempdir().unwrap();
        let store = ChatStore::new(
            dir.path().join("PrivateExamplePath"),
            crate::experience::Experience {
                notify_keywords: vec!["PrivateExampleKeyword".into()],
                muted_authors: vec!["PrivateExampleAuthor".into()],
                ..Default::default()
            },
        );
        let serialized = store.diagnostics().to_string();
        assert!(!serialized.contains("PrivateExample"));
        assert_eq!(store.diagnostics()["keyword_alert_count"], 1);
    }
}

/// Test native alerts without creating a connection, service, or wake lock.
#[tauri::command]
pub async fn test_notification(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<SessionService<tauri::Wry>>().test_alert()
    })
    .await
    .map_err(|_| "Could not test notifications.".to_string())?
}
