import { invoke } from "@tauri-apps/api/core";
import type { Endpoint } from "./syncthing";

export type RemoteNode = {
  id: string;
  name: string;
  url: string;
  api_key: string;
};

export const remotesList = () => invoke<RemoteNode[]>("remotes_list");

export const remotesAdd = (name: string, url: string, apiKey: string) =>
  invoke<RemoteNode>("remotes_add", { name, url, apiKey });

export const remotesRemove = (id: string) =>
  invoke<void>("remotes_remove", { id });

/** RemoteNode → Endpoint, damit die endpoint-parametrisierten Syncthing-Funktionen
 * (getStatus, getPendingFolders, putFolder, setFolderIgnores …) direkt gegen den
 * NAS laufen. */
export const toEndpoint = (n: RemoteNode): Endpoint => ({
  url: n.url,
  api_key: n.api_key,
});

/** Unreal-Ignore-Set fürs NAS-Backup (Cache/Build = nicht sichern). Spiegelt
 * Syncomats Preset (src/lib/unreal.ts) in kompakter Form. */
export const NAS_UNREAL_IGNORES = [
  "DerivedDataCache",
  "Intermediate",
  "Build",
  "Binaries",
  "**/Saved/Cooked",
  "**/Saved/Logs",
  "**/Saved/Autosaves",
  "**/Plugins/*/Intermediate",
  "**/Plugins/*/Binaries",
  "**/Plugins/*/DerivedDataCache",
  "*.pdb",
  "*.obj",
];
