/**
 * Upload Service - Periodic Runner
 *
 * This script periodically checks the translations directory for JSON files
 * that haven't been successfully uploaded yet (status 'pending' or missing)
 * and attempts to upload them using the logic from uploadTranslations.js.
 */

const fs = require("fs").promises; // Use promises for async file operations
const path = require("path");
const { glob } = require("glob"); // Use glob v10+ directly
const UploadStatusTracker = require("./uploadStatusTracker");
const originalUploader = require("./uploadTranslations"); // Import the original module

// --- Configuration ---
const TRANSLATIONS_DIR = process.env.OUTPUT_DIR || "/app/translations"; // Use absolute path inside container
const UPLOAD_DELAY_MS = parseInt(process.env.UPLOAD_DELAY_MS || "500", 10);
// Add a new environment variable for how often to check for files
const UPLOAD_CHECK_INTERVAL_MS = parseInt(
  process.env.UPLOAD_CHECK_INTERVAL_MS || "60000",
  10,
); // Default: check every 60 seconds

const statusTracker = new UploadStatusTracker();

/**
 * Finds translation files that are pending upload.
 * @returns {Promise<string[]>} Array of absolute file paths for pending files.
 */
async function findPendingFiles() {
  // Pattern to find all relevant JSON files
  const pattern = path
    .join(TRANSLATIONS_DIR, "**", "*_*.json")
    .replace(/\\/g, "/");
  try {
    // Get absolute paths for easier handling
    const allFiles = await glob(pattern, { nodir: true, absolute: true });
    const uploadStatus = statusTracker.getStatus(); // Load current status

    const pendingFiles = allFiles.filter((filePath) => {
      // Convert absolute path to relative for status checking
      const relativePath = statusTracker.getRelativePath(filePath);
      const fileInfo = uploadStatus.files[relativePath];

      // Consider a file pending if:
      // 1. It has no status entry yet.
      // 2. Its status is explicitly 'pending'.
      // 3. Its status is 'failed' (to allow for retries on next run).
      return (
        !fileInfo ||
        fileInfo.status === "pending" ||
        fileInfo.status === "failed"
      );
    });

    // Update status for any newly discovered files
    let statusChanged = false;
    allFiles.forEach((filePath) => {
      const relativePath = statusTracker.getRelativePath(filePath);
      if (!uploadStatus.files[relativePath]) {
        statusTracker.uploadStatus.files[relativePath] = {
          status: "pending",
          startedAt: null,
          completedAt: null,
          error: null,
        };
        statusChanged = true;
      }
    });
    if (statusChanged) {
      statusTracker.saveStatus();
    }

    return pendingFiles;
  } catch (error) {
    console.error(
      `${new Date().toISOString()} - Error finding translation files:`,
      error,
    );
    return [];
  }
}

/**
 * Reads, validates, and uploads pending translation files sequentially.
 */
async function processPendingFiles() {
  const pendingFiles = await findPendingFiles();

  if (pendingFiles.length === 0) {
    console.log(
      `${new Date().toISOString()} - No pending translation files found to upload.`,
    );
    return;
  }

  console.log(
    `${new Date().toISOString()} - Found ${pendingFiles.length} pending file(s). Starting upload process...`,
  );

  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < pendingFiles.length; i++) {
    const filePath = pendingFiles[i];
    // Use relative path for logging and status updates
    const relativePath = statusTracker.getRelativePath(filePath);
    console.log(
      ` --> Processing file ${i + 1}/${pendingFiles.length}: ${relativePath}`,
    );

    try {
      const fileContent = await fs.readFile(filePath, "utf8");
      const translationData = JSON.parse(fileContent);

      // Basic validation (copied check from uploadTranslations.js)
      if (
        !translationData.contentType ||
        !translationData.targetLocale ||
        !translationData.originalItemId ||
        !translationData.translatedAttributes
      ) {
        console.error(
          `    - Skipping ${relativePath}: Invalid or missing required fields in JSON.`,
        );
        // Mark as failed in status tracker so it's not picked up again unless logic changes
        statusTracker.completeUpload(
          relativePath,
          false,
          "Invalid data structure in JSON file.",
        );
        failureCount++;
        continue; // Skip this file
      }

      // --- Perform Upload ---
      // Mark as started *before* calling the upload logic
      statusTracker.startUpload(relativePath);

      // Call the original function from uploadTranslations.js
      const result =
        await originalUploader.pushSingleTranslation(translationData);

      // Mark as completed/failed based on the result
      statusTracker.completeUpload(
        relativePath,
        result.success,
        result.success ? null : result.message,
      );

      if (result.success) {
        console.log(
          `    ✓ Successfully uploaded ${relativePath}. Message: ${result.message || "(No message)"}`,
        );
        successCount++;
      } else {
        console.error(
          `    ✗ FAILED upload for ${relativePath}. Message: ${result.message || "(No message)"}`,
        );
        failureCount++;
      }
    } catch (error) {
      // Catch critical errors during file reading, parsing, or the upload call itself
      console.error(
        `    ✗ Critical error processing file ${relativePath}: ${error.message}`,
      );
      console.error(error.stack); // Log stack trace for debugging
      // Ensure status is marked as failed
      statusTracker.completeUpload(
        relativePath,
        false,
        `Critical error: ${error.message}`,
      );
      failureCount++;
    }

    // Optional: Delay between uploads within a batch
    if (i < pendingFiles.length - 1) {
      await new Promise((r) => setTimeout(r, UPLOAD_DELAY_MS));
    }
  } // End for loop

  console.log(
    `${new Date().toISOString()} - Finished processing batch. Success: ${successCount}, Failed: ${failureCount}`,
  );
}

// --- Main Execution Logic ---
console.log("Upload service starting...");
console.log(
  `Checking for pending files every ${UPLOAD_CHECK_INTERVAL_MS / 1000} seconds.`,
);
console.log(`Using translations directory: ${TRANSLATIONS_DIR}`);

// Run the check immediately on startup
console.log("Performing initial check for pending files...");
processPendingFiles().catch((err) => {
  console.error("Error during initial file processing:", err);
});

// Schedule periodic checks
const intervalId = setInterval(() => {
  console.log(`\n${new Date().toISOString()} - Periodic check triggered...`);
  processPendingFiles().catch((err) => {
    // Catch errors from the async function so setInterval doesn't stop
    console.error(
      `${new Date().toISOString()} - Error during periodic file processing:`,
      err,
    );
  });
}, UPLOAD_CHECK_INTERVAL_MS);

// Optional: Graceful shutdown handling
process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: stopping periodic checks.");
  clearInterval(intervalId);
  // Add any other cleanup here if needed
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT signal received: stopping periodic checks.");
  clearInterval(intervalId);
  process.exit(0);
});

console.log("Upload service is now running periodically.");
// Node.js will stay alive because of setInterval
