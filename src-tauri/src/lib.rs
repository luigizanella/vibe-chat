use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::{PermissionKind, PermissionResponse},
    AppHandle, Manager, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;

/// Se verdadeiro, fechar a janela apenas a esconde na bandeja (configurável no app).
struct CloseToTray(AtomicBool);

/// Segundos desde a última entrada do usuário (mouse/teclado) em QUALQUER programa.
#[tauri::command]
fn idle_seconds() -> Result<u64, String> {
    #[cfg(any(windows, target_os = "macos"))]
    {
        user_idle::UserIdle::get_time()
            .map(|t| t.as_seconds())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Err("sem suporte neste sistema".into())
    }
}

#[tauri::command]
fn set_close_to_tray(state: tauri::State<CloseToTray>, enabled: bool) {
    state.0.store(enabled, Ordering::Relaxed);
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Uma única instância: abrir de novo apenas traz a janela existente para a frente.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .manage(CloseToTray(AtomicBool::new(true)))
        .invoke_handler(tauri::generate_handler![set_close_to_tray, idle_seconds])
        .setup(|app| {
            // A janela é criada aqui (e não pelo tauri.conf.json) para registrar o tratador de permissões
            // do WebView2. Sem ele, o Windows/WebView2 pode negar câmera/microfone/tela sem mostrar
            // pergunta nenhuma. O app só carrega o próprio conteúdo (CSP restritiva, sem frames
            // externos), então liberar estas capacidades aqui equivale a "o app pode pedir ao
            // usuário": o sistema operacional continua exigindo a permissão de privacidade do Windows
            // e o seletor de tela continua sendo escolhido pelo usuário.
            let cfg = app
                .config()
                .app
                .windows
                .first()
                .cloned()
                .expect("janela principal ausente em tauri.conf.json");
            WebviewWindowBuilder::from_config(app.handle(), &cfg)?
                .on_permission_request(|_webview, kind| match kind {
                    PermissionKind::Microphone
                    | PermissionKind::Camera
                    | PermissionKind::DisplayCapture
                    | PermissionKind::Notifications => PermissionResponse::Allow,
                    _ => PermissionResponse::Default,
                })
                .build()?;

            let open = MenuItem::with_id(app, "open", "Abrir Vibe Chat", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;

            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().expect("ícone padrão ausente").clone())
                .tooltip("Vibe Chat")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            // Iniciado pelo "Iniciar com o Windows": começa escondido na bandeja.
            if std::env::args().any(|a| a == "--minimized") {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let to_tray = window
                    .app_handle()
                    .state::<CloseToTray>()
                    .0
                    .load(Ordering::Relaxed);
                if to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("erro ao executar o aplicativo Tauri");
}
