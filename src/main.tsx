// Schrift: IBM Plex Sans/Mono, mitgeliefert (DESIGN-GEMEINSAM 26.11.2026,
// Design System „Filmstudio Stage“ v16) — gleich auf Mac und Windows, offline.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { themaStarten } from "./lib/thema";

themaStarten();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
