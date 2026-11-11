mod autostart;
mod conflicts;
mod firstrun;
mod folder_settings;
mod folder_stats;
mod invites;
mod abo;
mod auswahl;
mod marke;
mod papierkorb;
mod datenzentrale;
mod network_hints;
mod reveal;
mod sidecar;

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager,
};
use tauri_plugin_autostart::ManagerExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // single-instance MUSS als erstes Plugin registriert werden — bei
        // Doppel-Start triggert sein Handler ohne dass die anderen Plugins
        // schon laufen (verhindert doppelten Syncthing-Sidecar-Spawn +
        // Lockfile-Konflikt im syncthing-home/).
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // 2. Instanz wurde gestartet — Fenster der existierenden Instanz
            // hochbringen + fokussieren, dann beendet sich die 2. Instanz selbst.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![autostart::MINIMIZED_ARG]),
        ))
        .setup(|app| {
            // Fenster startet unsichtbar (tauri.conf.json: visible=false) und
            // wird hier gezeigt — beim Autostart nur minimiert in der Taskleiste.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                if autostart::launched_minimized() {
                    let _ = window.minimize();
                }
            }
            autostart::migrate_registration(app.handle());

            let handle = app.handle().clone();
            let state = sidecar::spawn(&handle)?;
            app.manage(state);

            let invite_store = invites::setup(&handle)?;
            app.manage(invite_store);

            // Tray-Menü: Öffnen · Bei Anmeldung starten (Toggle) · ── · Beenden
            let open = MenuItem::with_id(app, "open", "Öffnen", true, None::<&str>)?;
            let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
            let autostart_item = CheckMenuItem::with_id(
                app,
                "autostart",
                "Bei Anmeldung starten",
                true,
                autostart_enabled,
                None::<&str>,
            )?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &autostart_item, &separator, &quit])?;
            // Tray-Haken als State halten -> der Settings-Toggle kann ihn über
            // autostart::apply() synchron halten (beide zeigen denselben Zustand).
            app.manage(autostart::AutostartMenu(autostart_item.clone()));

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "autostart" => {
                        // Über apply() umschalten -> hält auch den Tray-Haken
                        // (und den Settings-Toggle beim nächsten Öffnen) korrekt.
                        let enabled = app.autolaunch().is_enabled().unwrap_or(false);
                        let _ = autostart::apply(app, !enabled);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            sidecar::syncthing_endpoint,
            invites::invite_create,
            invites::invite_list,
            invites::invite_find,
            invites::invite_mark_redeemed,
            invites::invite_revoke,
            invites::invite_consume_once,
            invites::invite_release_consumed,
            invites::invite_purge_expired,
            folder_settings::folder_settings_read,
            folder_settings::folder_settings_write,
            conflicts::conflicts_list,
            conflicts::conflicts_keep_local,
            conflicts::conflicts_take_remote,
            conflicts::conflicts_keep_both,
            conflicts::conflicts_resolve_all,
            folder_stats::workload_detect,
            folder_stats::folder_estimate_size,
            reveal::reveal_in_file_manager,
            firstrun::config_ever_seen,
            firstrun::config_mark_seen,
            autostart::autostart_get,
            autostart::autostart_set,
            network_hints::network_hints_write,
            network_hints::network_hints_read_all,
            network_hints::device_note_write,
            network_hints::device_notes_read_all,
            network_hints::intern_folder_path,
            datenzentrale::dz_credentials_parse,
            datenzentrale::dz_credentials_save,
            datenzentrale::dz_credentials_load,
            datenzentrale::dz_credentials_clear,
            datenzentrale::computer_name,
            abo::disk_info,
            abo::path_state,
            abo::create_abo_dir,
            abo::remove_unused_abo_dir,
            abo::status_datei_write,
            auswahl::auswahl_pruefen,
            auswahl::auswahl_entfernen,
            auswahl::inhalt_ordner_pfad,
            auswahl::abo_ordner_leeren,
            auswahl::abo_ordner_vormerken,
            auswahl::muster_treffer,
            marke::marke_stand,
            marke::marke_anlegen,
            papierkorb::papierkorb_ordner,
            papierkorb::in_papierkorb,
            papierkorb::papierkorb_aufraeumen,
            papierkorb::papierkorb_belegung,
            papierkorb::papierkorb_leeren,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                sidecar::cleanup(handle);
            }
        });
}
