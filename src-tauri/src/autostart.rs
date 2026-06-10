// Autostart („Bei Anmeldung starten") — die OS-Registrierung ist die Wahrheit,
// NICHT ein localStorage-Flag. macOS legt einen LaunchAgent an, Windows einen
// Registry-Run-Eintrag (via tauri-plugin-autostart). Settings-Toggle UND
// Tray-Haken „Bei Login starten" laufen über denselben Pfad, damit beide immer
// denselben Zustand zeigen.
use tauri::menu::CheckMenuItem;
use tauri::{Manager, Wry};
use tauri_plugin_autostart::ManagerExt;

/// Hält den Tray-Haken als managed State, damit `apply()` ihn synchron halten
/// kann. Konkreter Runtime `Wry` (gleicher Runtime wie der Rest der App), weil
/// `CheckMenuItem` keinen Default-Generic hat.
pub struct AutostartMenu(pub CheckMenuItem<Wry>);

/// Autostart setzen, Tray-Haken nachziehen und den danach tatsächlich
/// geltenden Zustand zurückgeben (OS bleibt Quelle der Wahrheit).
pub fn apply(app: &tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    let mgr = app.autolaunch();
    if enabled { mgr.enable() } else { mgr.disable() }.map_err(|e| e.to_string())?;
    let now = mgr.is_enabled().unwrap_or(enabled);
    if let Some(menu) = app.try_state::<AutostartMenu>() {
        let _ = menu.0.set_checked(now);
    }
    Ok(now)
}

/// Aktueller Autostart-Zustand (vom Betriebssystem gelesen).
#[tauri::command]
pub fn autostart_get(app: tauri::AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// Autostart ein-/ausschalten. Gibt den real geltenden Zustand zurück, damit
/// das Frontend bei einem Fehlschlag den Toggle korrigieren kann.
#[tauri::command]
pub fn autostart_set(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    apply(&app, enabled)
}
