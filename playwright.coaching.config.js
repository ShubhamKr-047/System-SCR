import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";
const port=process.env.SCR_COACH_PORT || '4173';

export default defineConfig({
  ...base,
  outputDir:'test-results/coaching',
  use:{...base.use,baseURL:`http://127.0.0.1:${port}`},
  testIgnore: [],
  testMatch: ["**/coaching.spec.js", "**/ai-playback.spec.js"],
  webServer: [{...base.webServer,command:base.webServer.command.replace('4173',port),url:base.webServer.url.replace('4173',port)}, {
    command: "postman simulation run postman/simulations/coaching.sim.yaml --port 4900 --no-history --output ndjson",
    url: "http://127.0.0.1:4900/groq/health",
    reuseExistingServer: false,
    stdout: "pipe"
  }]
});
