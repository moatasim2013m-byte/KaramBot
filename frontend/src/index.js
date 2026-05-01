import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";
import * as serviceWorkerRegistration from "@/serviceWorkerRegistration";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// When the service worker activates a new version it immediately calls
// skipWaiting() + clientsClaim() (see service-worker.js). Once the browser
// hands control to the new SW the 'controllerchange' event fires and we reload
// so staff always run the latest build after a deployment.
let swRefreshing = false;
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!swRefreshing) {
      swRefreshing = true;
      window.location.reload();
    }
  });
}

serviceWorkerRegistration.register();
