import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: "**/coaching.spec.js",
  webServer: [base.webServer, {
    command: "postman simulation run postman/simulations/coaching.sim.yaml --port 4900 --no-history --output ndjson",
    url: "http://127.0.0.1:4900/gemini/health",
    reuseExistingServer: false,
    stdout: "pipe"
  }]
});
