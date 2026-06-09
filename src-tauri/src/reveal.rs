// Öffnet einen Pfad im nativen Dateimanager (Finder / Explorer / xdg-open).
//
// Eigener Command statt tauri-plugin-opener.open_path: dessen Scope erwies sich
// als unzuverlässig — der „Ordner öffnen"-Button tat auf allen Plattformen
// nichts (Promise wurde still abgelehnt). Ein roher Prozess-Spawn ist hier
// robuster und ohne Plugin-Scope-Gefummel.

#[tauri::command]
pub fn reveal_in_file_manager(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let program = "xdg-open";

    std::process::Command::new(program)
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
