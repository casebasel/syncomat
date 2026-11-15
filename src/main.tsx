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
