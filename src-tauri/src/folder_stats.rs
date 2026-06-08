use serde::Serialize;
use std::path::Path;
use std::time::{Duration, Instant};
use walkdir::WalkDir;

#[derive(Serialize, Clone, Debug)]
pub struct WorkloadDetection {
    pub kind: String, // "unreal" | "unity" | "node" | "godot" | "generic"
    pub has_uproject: bool,
    pub has_unity_project: bool,
    pub has_package_json: bool,
    pub has_godot_project: bool,
    pub has_derived_data_cache: bool,
    pub has_intermediate: bool,
    pub has_node_modules: bool,
    /// Anzahl gefundener *.uproject Files. Relevant für Multi-Projekt-Workspaces
    /// (z.B. Marlon's Setup mit 10 UE-Projekten unter einem Sync-Folder).
    pub uproject_count: u32,
}

#[derive(Serialize, Clone, Debug)]
pub struct FolderEstimate {
    pub bytes: u64,
    pub files: u64,
    pub dirs: u64,
    pub sampled: bool,
    pub elapsed_ms: u64,
    pub workload: WorkloadDetection,
}

/// Detektiert in einem Folder den Workload-Typ via Marker-Files in den
/// obersten 2-3 Ebenen. Cheap — max 5s, max ein paar tausend dir-reads.
#[tauri::command]
pub async fn workload_detect(path: String) -> Result<WorkloadDetection, String> {
    tauri::async_runtime::spawn_blocking(move || workload_detect_blocking(&path))
        .await
        .map_err(|e| format!("join: {e}"))?
}

fn workload_detect_blocking(path: &str) -> Result<WorkloadDetection, String> {
    let root = Path::new(path);
    if !root.exists() || !root.is_dir() {
        return Err(format!("folder does not exist: {path}"));
    }
    let mut det = WorkloadDetection {
        kind: "generic".into(),
        has_uproject: false,
        has_unity_project: false,
        has_package_json: false,
        has_godot_project: false,
        has_derived_data_cache: false,
        has_intermediate: false,
        has_node_modules: false,
        uproject_count: 0,
    };

    // max_depth=4 deckt:
    //   root/Project.uproject (depth 1)                       <- direkter Unreal-Folder
    //   root/Sub/Project.uproject (depth 2)                   <- Multi-Projekt Workspace (Marlon)
    //   root/Sub/Group/Project.uproject (depth 3)             <- Quartals-/Themen-Gruppierung
    //   root/Sub/Group/Year/Project.uproject (depth 4)        <- noch eine Ebene Buffer
    // Pruning der bekannten Cache-Dirs erspart uns trotzdem Millionen Files
    // (Intermediate/ allein hat 100k+ Files pro Projekt).
    let walker = WalkDir::new(root)
        .max_depth(4)
        .follow_links(false)
        .same_file_system(true)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            match e.file_name().to_str() {
                Some(n) => !matches!(
                    n,
                    "DerivedDataCache"
                        | "Intermediate"
                        | "Saved"
                        | "Binaries"
                        | "node_modules"
                        | ".git"
                        | "target"
                        | ".stversions"
                        | ".stfolder"
                ),
                None => true,
            }
        })
        .filter_map(|e| e.ok());

    for entry in walker {
        let name = match entry.file_name().to_str() {
            Some(n) => n,
            None => continue,
        };
        if entry.file_type().is_file() {
            if name.ends_with(".uproject") {
                det.has_uproject = true;
                det.uproject_count = det.uproject_count.saturating_add(1);
            } else if name == "package.json" {
                det.has_package_json = true;
            } else if name == "project.godot" {
                det.has_godot_project = true;
            }
        } else if entry.file_type().is_dir() {
            match name {
                "DerivedDataCache" => det.has_derived_data_cache = true,
                "Intermediate" => det.has_intermediate = true,
                "node_modules" => det.has_node_modules = true,
                "ProjectSettings" => {
                    // Unity hat charakteristisch Assets/ + ProjectSettings/
                    det.has_unity_project = true;
                }
                _ => {}
            }
        }
    }

    det.kind = if det.has_uproject {
        "unreal".into()
    } else if det.has_unity_project {
        "unity".into()
    } else if det.has_godot_project {
        "godot".into()
    } else if det.has_package_json && det.has_node_modules {
        "node".into()
    } else {
        "generic".into()
    };

    Ok(det)
}

/// Schnelle Größen-Schätzung eines Folders. Vollständig wenn Folder klein,
/// sample-based + early-exit bei großen Folders. Brauchen wir für die
/// Banner-Warnung "Ordner ist 50GB — sicher dass alles synct werden soll?"
/// und die adaptive Syncthing-Folder-Config-Tuning.
#[tauri::command]
pub async fn folder_estimate_size(path: String) -> Result<FolderEstimate, String> {
    tauri::async_runtime::spawn_blocking(move || folder_estimate_size_blocking(&path))
        .await
        .map_err(|e| format!("join: {e}"))?
}

fn folder_estimate_size_blocking(path: &str) -> Result<FolderEstimate, String> {
    let root = Path::new(path);
    if !root.exists() || !root.is_dir() {
        return Err(format!("folder does not exist: {path}"));
    }
    let start = Instant::now();
    let workload = workload_detect_blocking(path)?;

    let max_duration = Duration::from_secs(5);
    let mut bytes: u64 = 0;
    let mut files: u64 = 0;
    let mut dirs: u64 = 0;
    let mut sampled = false;

    let walker = WalkDir::new(root)
        .follow_links(false)
        .same_file_system(true)
        .into_iter()
        .filter_entry(|e| {
            // Prune dev-artifact dirs SO dass der estimate die User-relevant content widerspiegelt,
            // nicht den Build-Cache-Bloat.
            if e.depth() == 0 {
                return true;
            }
            match e.file_name().to_str() {
                Some(n) => !matches!(
                    n,
                    "DerivedDataCache"
                        | "Intermediate"
                        | "Saved"
                        | "Binaries"
                        | "node_modules"
                        | ".git"
                        | "target"
                        | ".stversions"
                        | ".stfolder"
                        | "__pycache__"
                        | ".next"
                ),
                None => true,
            }
        });

    for entry in walker.filter_map(|e| e.ok()) {
        if entry.file_type().is_dir() {
            dirs += 1;
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            bytes += meta.len();
            files += 1;
        }
        // Early-exit damit Modal nicht 30s blockt
        if files % 1000 == 0 && start.elapsed() > max_duration {
            sampled = true;
            break;
        }
    }

    Ok(FolderEstimate {
        bytes,
        files,
        dirs,
        sampled,
        elapsed_ms: start.elapsed().as_millis() as u64,
        workload,
    })
}
