/**
 * Main script to fetch and translate Strapi content
 * This is the entry point for the translation service container
 */

const { main } = require("./strapi-translate");
const fs = require("fs");
const path = require("path");

// Create log directory if it doesn't exist
const LOG_DIR = process.env.LOG_DIR || "./logs";
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Set up logging to file
const logFile = path.join(
  LOG_DIR,
  `translation-${new Date().toISOString().replace(/:/g, "-")}.log`,
);
const logStream = fs.createWriteStream(logFile, { flags: "a" });

// Redirect console output to both stdout and the log file
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

console.log = function () {
  const args = Array.from(arguments);
  originalConsoleLog.apply(console, args);
  logStream.write(args.join(" ") + "\n");
};

console.error = function () {
  const args = Array.from(arguments);
  originalConsoleError.apply(console, args);
  logStream.write("[ERROR] " + args.join(" ") + "\n");
};

console.warn = function () {
  const args = Array.from(arguments);
  originalConsoleWarn.apply(console, args);
  logStream.write("[WARN] " + args.join(" ") + "\n");
};

// Run the main function periodically
const RUN_INTERVAL_MS = process.env.RUN_INTERVAL_MS || 3600000; // Default: 1 hour

async function runWithSchedule() {
  try {
    console.log(`Starting translation process at ${new Date().toISOString()}`);
    await main();
    console.log(`Completed translation process at ${new Date().toISOString()}`);
  } catch (error) {
    console.error(`Error in translation process: ${error.message}`);
    console.error(error.stack);
  }

  console.log(`Scheduling next run in ${RUN_INTERVAL_MS / 1000 / 60} minutes`);
  setTimeout(runWithSchedule, RUN_INTERVAL_MS);
}

// Start the process
console.log(`Translation service starting at ${new Date().toISOString()}`);
console.log(`Logs will be written to ${logFile}`);
runWithSchedule();
