mod conflicts;
mod folder_settings;
mod folder_stats;
mod ignored_folders;
mod invites;
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
            None,
        ))
        .setup(|app| {
            let handle = app.handle().clone();
            let state = sidecar::spawn(&handle)?;
            app.manage(state);

            let invite_store = invites::setup(&handle)?;
            app.manage(invite_store);

            let ignored_store = ignored_folders::setup(&handle)?;
            app.manage(ignored_store);

            // Tray-Menü: Öffnen · Bei-Login-starten (Toggle) · ── · Quit
            let open = MenuItem::with_id(app, "open", "Öffnen", true, None::<&str>)?;
            let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
            let autostart_item = CheckMenuItem::with_id(
                app,
                "autostart",
                "Bei Login starten",
                true,
                autostart_enabled,
                None::<&str>,
            )?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &autostart_item, &separator, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "autostart" => {
                        let mgr = app.autolaunch();
                        let enabled = mgr.is_enabled().unwrap_or(false);
                        if enabled {
                            let _ = mgr.disable();
                        } else {
                            let _ = mgr.enable();
                        }
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
            invites::invite_get_issuer_secret,
            invites::invite_consume_once,
            invites::invite_release_consumed,
            invites::invite_purge_expired,
            folder_settings::folder_settings_read,
            folder_settings::folder_settings_write,
            conflicts::conflicts_list,
            conflicts::conflicts_keep_local,
            conflicts::conflicts_take_remote,
            conflicts::conflicts_keep_both,
            ignored_folders::ignored_folders_list,
            ignored_folders::ignored_folders_add,
            ignored_folders::ignored_folders_remove,
            folder_stats::workload_detect,
            folder_stats::folder_estimate_size,
            reveal::reveal_in_file_manager,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                sidecar::cleanup(handle);
            }
        });
}
