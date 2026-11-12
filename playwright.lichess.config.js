import {defineConfig} from '@playwright/test';
import base from './playwright.config.js';
export default defineConfig({
  ...base, testIgnore:[], testMatch:['**/lichess-import.spec.js'],
  webServer:[base.webServer, {
    command:'postman simulation run postman/simulations/lichess.sim.yaml --port 4930 --no-history --output ndjson',
    url:'http://127.0.0.1:4930/lichess/health', reuseExistingServer:false, stdout:'pipe'
  }]
});
