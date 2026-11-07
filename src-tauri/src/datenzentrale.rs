// Verbindung zur Datenzentrale (Studio-DB, Lesekonto `datenagent_reader`).
//
// Die vier Zeilen aus `datenagent-token-erzeugen.sh` (Repo plate-assistant)
// werden eingefügt, hier geprüft und als EIN Eintrag im Schlüsselbund des
// Systems abgelegt (Windows-Anmeldeinformationen / macOS-Schlüsselbund).
// Nie in einer Datei, nie in einem gesyncten Ordner.
use serde::{Deserialize, Serialize};

const SERVICE: &str = "ch.ca-se.syncomat";
const ACCOUNT: &str = "datenzentrale";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DzCredentials {
    pub url: String,
    pub anon_key: String,
    pub token: String,
    pub rechner: String,
}

/// Genau die vier Zeilen `KEY=VALUE` des Token-Skripts lesen.
fn parse(text: &str) -> Result<DzCredentials, String> {
    let (mut url, mut anon, mut token, mut rechner) = (None, None, None, None);
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
        let Some((k, v)) = line.split_once('=') else {
            return Err(format!("Zeile ohne „=“: {line}"));
        };
        let v = v.trim().to_string();
        match k.trim() {
            "STUDIO_DB_URL" => url = Some(v),
            "STUDIO_DB_ANON_KEY" => anon = Some(v),
            "STUDIO_DB_TOKEN" => token = Some(v),
            "STUDIO_DB_RECHNER" => rechner = Some(v),
            other => return Err(format!("unbekannter Schlüssel: {other}")),
        }
    }
    let url = url.ok_or("STUDIO_DB_URL fehlt")?;
    if !url.starts_with("https://") {
        return Err("STUDIO_DB_URL muss mit https:// beginnen".into());
    }
    let rechner = rechner.ok_or("STUDIO_DB_RECHNER fehlt")?;
    let ok_name = (2..=32).contains(&rechner.len())
        && rechner
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-');
    if !ok_name {
        return Err(format!("ungültiger Rechnername: {rechner}"));
    }
    Ok(DzCredentials {
        url: url.trim_end_matches('/').to_string(),
        anon_key: anon.ok_or("STUDIO_DB_ANON_KEY fehlt")?,
        token: token.ok_or("STUDIO_DB_TOKEN fehlt")?,
        rechner,
    })
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("Schlüsselbund: {e}"))
}

/// Eingefügten Text nur prüfen (für die Vorschau im Dialog), nichts speichern.
#[tauri::command]
pub fn dz_credentials_parse(text: String) -> Result<DzCredentials, String> {
    parse(&text)
}

/// Prüfen und im Schlüsselbund ablegen. Die Prüfung von Ablauf und Rechner
/// macht das Frontend vorher (es zeigt sie an); hier nur das Format.
#[tauri::command]
pub fn dz_credentials_save(text: String) -> Result<DzCredentials, String> {
    let c = parse(&text)?;
    let json = serde_json::to_string(&c).map_err(|e| e.to_string())?;
    entry()?
        .set_password(&json)
        .map_err(|e| format!("Schlüsselbund speichern: {e}"))?;
    Ok(c)
}

#[tauri::command]
pub fn dz_credentials_load() -> Result<Option<DzCredentials>, String> {
    match entry()?.get_password() {
        Ok(json) => serde_json::from_str(&json)
            .map(Some)
            .map_err(|e| format!("Schlüsselbund-Eintrag unlesbar: {e}")),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Schlüsselbund lesen: {e}")),
    }
}

#[tauri::command]
pub fn dz_credentials_clear() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Schlüsselbund löschen: {e}")),
    }
}

/// Name dieses Rechners (Windows: COMPUTERNAME, sonst `hostname`), für die
/// Prüfung, ob das Token zu diesem Rechner gehört.
#[tauri::command]
pub fn computer_name() -> String {
    if let Ok(n) = std::env::var("COMPUTERNAME") {
        return n;
    }
    std::process::Command::new("hostname")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::parse;

    #[test]
    fn parses_four_lines() {
        let c = parse("STUDIO_DB_URL=https://x.ca-se.ch/\nSTUDIO_DB_ANON_KEY=a\nSTUDIO_DB_TOKEN=t\nSTUDIO_DB_RECHNER=i9\n").unwrap();
        assert_eq!(c.url, "https://x.ca-se.ch");
        assert_eq!(c.rechner, "i9");
    }

    #[test]
    fn rejects_bad_input() {
        assert!(parse("STUDIO_DB_URL=http://x\nSTUDIO_DB_ANON_KEY=a\nSTUDIO_DB_TOKEN=t\nSTUDIO_DB_RECHNER=i9").is_err());
        assert!(parse("export STUDIO_DB_URL=https://x").is_err());
        assert!(parse("STUDIO_DB_URL=https://x\nSTUDIO_DB_ANON_KEY=a\nSTUDIO_DB_TOKEN=t\nSTUDIO_DB_RECHNER=I9").is_err());
        assert!(parse("STUDIO_DB_URL=https://x\nSTUDIO_DB_TOKEN=t\nSTUDIO_DB_RECHNER=i9").is_err());
    }
}
