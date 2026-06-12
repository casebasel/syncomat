import { invoke } from "@tauri-apps/api/core";

/** Workload-Detection für CreateFolderModal — Rust-side WalkDir bis max_depth=4 */
export type WorkloadDetection = {
  kind: "unreal" | "unity" | "node" | "godot" | "generic";
  has_uproject: boolean;
  has_unity_project: boolean;
  has_package_json: boolean;
  has_godot_project: boolean;
  has_derived_data_cache: boolean;
  has_intermediate: boolean;
  has_node_modules: boolean;
  /** Wieviele Unreal-Projekte gefunden — relevant für Multi-Projekt-Workspaces.
   * Bei 1: einzelnes Projekt im Root. Bei N>1: Workspace mit N Subprojekten. */
  uproject_count: number;
};

export type FolderEstimate = {
  bytes: number;
  files: number;
  dirs: number;
  sampled: boolean;
  elapsed_ms: number;
  workload: WorkloadDetection;
};

export const workloadDetect = (path: string) =>
  invoke<WorkloadDetection>("workload_detect", { path });

export const folderEstimateSize = (path: string) =>
  invoke<FolderEstimate>("folder_estimate_size", { path });

// Unreal Engine 5 .stignore-Preset — basiert auf Epic's offiziellem .gitignore.
//
// WICHTIG (Syncthing-Syntax, anders als gitignore!):
// - Pattern OHNE slash (z.B. `DerivedDataCache`) matchet in JEDER Tiefe.
// - Pattern MIT slash (z.B. `Saved/Cooked`) matchet NUR an Folder-Root.
//   → daher Doppelstern-Prefix für rekursives Matching.
//
// Diese Patterns sind speziell für Multi-Projekt-Workspaces gebaut:
//   /UE-Projects/         <- Folder-Root
//   ├── ProjectA/Saved/Cooked/   <- wird vom Doppelstern-Prefix gematcht
//   └── ProjectB/Saved/Cooked/   <- wird vom Doppelstern-Prefix gematcht
//
// Wichtigste Patterns: DerivedDataCache + Intermediate + Saved + Binaries
// sind zusammen typisch 30-70% des UE-Projekt-Volumens und vollständig
// regenerierbar. Syncen dieser Folders ist katastrophal:
//   - DDC: 10-50 GB binary cache pro Maschine, wird bei jedem Asset-Build neu erzeugt
//   - Intermediate/: 100k+ build-Files die churnen → Sync-Loop
//   - Binaries/: kompilierte DLLs/EXEs → besser pro Maschine bauen
//   - Saved/Cooked: build-Output, 10s GB
export const UNREAL_STIGNORE: string[] = [
  "// Unreal Engine 5 — Syncomat-Default-Preset",
  "// Multi-Projekt-tauglich: '**/' prefix = rekursiv durch alle Sub-Folders.",
  "// '!' = negieren, '(?i)' = case-insensitive, '//' = Kommentar",
  "",
  "// === Engine-/Editor-Caches (regenerierbar, riesig) ===",
  "// Bare patterns matchen in jeder Tiefe — fangen also auch ProjectA/DerivedDataCache",
  "DerivedDataCache",
  "Intermediate",
  "Build",
  "// Pfad-haltige patterns brauchen '**/' damit sie nicht nur am Root matchen",
  "**/Saved/Autosaves",
  "**/Saved/Backup",
  "**/Saved/Crashes",
  "**/Saved/Cooked",
  "**/Saved/HardwareSurvey",
  "**/Saved/Logs",
  "**/Saved/SourceControl",
  "**/Saved/StagedBuilds",
  "**/Saved/Screenshots",
  "**/Saved/CrashReportClient",
  "// Plugin-Caches in Unterordnern",
  "**/Plugins/*/Intermediate",
  "**/Plugins/*/Binaries",
  "**/Plugins/*/Saved",
  "**/Plugins/*/DerivedDataCache",
  "",
  "// === Build-Output / kompilierte Binaries (regenerierbar) ===",
  "Binaries",
  "*.pdb",
  "*.obj",
  "*.lib",
  "*.exp",
  "*.exe",
  "*.app",
  "*.dylib",
  "*.so",
  "",
  "// === IDE / Tool-Metadaten ===",
  ".vs",
  ".vscode",
  ".idea",
  "*.sln",
  "*.suo",
  "*.sdf",
  "*.VC.db",
  "*.VC.opendb",
  "*.xcodeproj",
  "*.xcworkspace",
  "*.generated.h",
  "*.generated.cpp",
  "",
  "// === OS-Muell ===",
  "(?i).DS_Store",
  "(?i)Thumbs.db",
  "(?i)desktop.ini",
  "(?i)ehthumbs.db",
  ".Spotlight-V100",
  ".Trashes",
  ".fseventsd",
  ".AppleDouble",
  "._*",
  "",
  "// === Temp-/Lock-Files ===",
  "*.tmp",
  "*.temp",
  "*.swp",
  "*.bak",
  "*.orig",
  "*~",
  "*.uasset.lock",
  "*.umap.lock",
  "",
  "// === Syncthing-/Syncomat-intern ===",
  ".stversions",
  ".stfolder",
  ".stignore",
  "",
  "// === Bewusst NICHT ignoriert (Negation gegen Saved-Wildcard) ===",
  "// Saved/Config = Team-Editor-Einstellungen, auch in Subfolders behalten",
  "!**/Saved/Config",
];

/** Generic .stignore — nur OS-Mull + dotfiles. Default für non-Unreal Folders. */
export const GENERIC_STIGNORE: string[] = [
  "(?i).DS_Store",
  "(?i)Thumbs.db",
  "(?i)desktop.ini",
  "(?i)ehthumbs.db",
  ".Spotlight-V100",
  ".Trashes",
  ".fseventsd",
  "._*",
  "*.tmp",
  "*.swp",
  "*~",
];

/** Node.js / Web-Dev .stignore */
export const NODE_STIGNORE: string[] = [
  ...GENERIC_STIGNORE,
  "node_modules",
  ".next",
  ".nuxt",
  "dist",
  "build",
  "coverage",
  ".cache",
  ".parcel-cache",
];

// Syncthing-interne Marker bleiben unangetastet — sie liegen im Folder-Root und
// blockieren eh keine Subfolder-Löschung; (?d) drauf wäre nur unnötiges Risiko.
const NEVER_DELETABLE = new Set([".stfolder", ".stignore", ".stversions"]);

/**
 * Prefix `(?d)` auf ein Ignore-Pattern: erlaubt Syncthing, die ignorierte
 * Datei/Ordner zu löschen WENN sie das Einzige ist, das ein Ordner-Löschen
 * blockiert. Ohne das bleibt z.B. ein unsichtbares `.DS_Store` hängen und wirft
 * "delete dir: directory has been deleted on a remote device but contains
 * ignored files". Kommentare, Leerzeilen, Negationen (`!`) und Syncthing-Marker
 * bleiben unverändert.
 */
export function deletableIgnore(pattern: string): string {
  const t = pattern.trimStart();
  if (
    t === "" ||
    t.startsWith("//") ||
    t.startsWith("!") ||
    t.startsWith("(?d)") ||
    NEVER_DELETABLE.has(t)
  ) {
    return pattern;
  }
  return "(?d)" + pattern;
}

export function pickStignoreForWorkload(kind: WorkloadDetection["kind"]): string[] {
  const preset =
    kind === "unreal" ? UNREAL_STIGNORE : kind === "node" ? NODE_STIGNORE : GENERIC_STIGNORE;
  // (?d)-Prefix auf jedes echte Pattern -> OS-Müll & regenerierbare Caches
  // blockieren keine Remote-Löschungen mehr (sonst "contains ignored files").
  return preset.map(deletableIgnore);
}

/** UI-Label für Workload-Kind. uprojectCount erweitert für Multi-Projekt-Workspaces. */
export function workloadLabel(
  kind: WorkloadDetection["kind"],
  uprojectCount = 1,
): string {
  if (kind === "unreal" && uprojectCount > 1) {
    return `Unreal-Workspace (${uprojectCount} Projekte)`;
  }
  return {
    unreal: "Unreal-Projekt",
    unity: "Unity-Projekt",
    node: "Node.js / Web",
    godot: "Godot-Projekt",
    generic: "Allgemeiner Ordner",
  }[kind];
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Schätzung für Syncthing-Index-RAM. ~1KB pro File + 32B pro 128KB-Block. */
export function estimateIndexRamMB(files: number, bytes: number): number {
  const fileMeta = files * 1024;
  const blockHashes = (bytes / (128 * 1024)) * 32;
  return Math.round((fileMeta + blockHashes) / (1024 * 1024));
}
