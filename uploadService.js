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
const statusManager = require("./statusManager"); // Require Status Manager module
const originalUploader = require("./uploadTranslations"); // Import the original upload logic module
const db = require("./db");

// --- Configuration ---
const TRANSLATIONS_DIR = process.env.OUTPUT_DIR || "/app/translations"; // Use absolute path inside container
const UPLOAD_DELAY_MS = parseInt(process.env.UPLOAD_DELAY_MS || "500", 10);
// Add a new environment variable for how often to check for files
const UPLOAD_CHECK_INTERVAL_MS = parseInt(
  process.env.UPLOAD_CHECK_INTERVAL_MS || "60000",
  10,
); // Default: check every 60 seconds
const MAX_CONCURRENT_UPLOADS = parseInt(
  process.env.MAX_CONCURRENT_UPLOADS || "5",
  10,
); // Concurrency limit

const JSON_STATUS_FILE_PATH = "/app/upload-status.json"; // Define path for migration

const statusTracker = new UploadStatusTracker("/app/upload-status.json");

/**
 * Processes a single upload job fetched from the database.
 * Reads the corresponding file, attempts upload, and updates DB status.
 *
 * @param {object} job - Job object from DB { slug, contentType, language, source_item_id, translation_file_path }
 * @returns {Promise<object>} Promise resolving to { status: 'fulfilled'|'rejected', value?: any, reason?: Error, job: object }
 */
async function processSingleUploadJob(job) {
  const { slug, language, source_item_id, translation_file_path } = job;
  const contentType = job.content_type;
  const logPrefix = ` --> [Upload Job: ${slug} -> ${language}]`;
  console.log(`${logPrefix} Starting processing.`);

  // Validate essential job data
  if (!translation_file_path) {
    const errorMsg =
      "Internal Error: translation_file_path missing in job data.";
    console.error(`${logPrefix} ✗ Skipping: ${errorMsg}`);
    // Update status to failed permanently if path is missing
    await statusManager.updateJobStatus(
      slug,
      contentType,
      language,
      "failed_upload",
      { error: errorMsg },
    );
    return { status: "rejected", reason: new Error(errorMsg), job };
  }

  // Construct the absolute path to the translation file WITHIN THIS CONTAINER
  // Assumes translation_file_path was stored relative to OUTPUT_DIR by the translation service
  const absoluteFilePath = path.resolve(
    TRANSLATIONS_DIR,
    translation_file_path,
  );
  console.log(`${logPrefix} File path resolved to: ${absoluteFilePath}`);

  try {
    // --- Step 1: Mark as 'uploading' in DB ---
    await statusManager.updateJobStatus(
      slug,
      contentType,
      language,
      "uploading",
    );

    // --- Step 2: Read Translation File ---
    console.log(`${logPrefix} Reading file content...`);
    const fileContent = await fs.readFile(absoluteFilePath, "utf8");
    const translationData = JSON.parse(fileContent);
    console.log(`${logPrefix} File content read and parsed.`);

    // --- Step 3: Basic Validation of File Content ---
    if (
      !translationData.contentType ||
      !translationData.targetLocale ||
      !translationData.originalItemId ||
      !translationData.translatedAttributes ||
      translationData.originalItemId !== source_item_id || // Sanity check ID
      translationData.contentType !== contentType ||
      translationData.targetLocale !== language
    ) {
      throw new Error("Invalid or inconsistent data structure in JSON file.");
    }

    // --- Step 4: Attempt Upload via Original Uploader ---
    console.log(`${logPrefix} Calling pushSingleTranslation...`);
    // pushSingleTranslation uses the data object read from the file
    const result =
      await originalUploader.pushSingleTranslation(translationData);
    console.log(
      `${logPrefix} pushSingleTranslation finished. Success: ${result.success}`,
    );

    // --- Step 5: Update Final Status in DB ---
    if (result.success) {
      console.log(
        `${logPrefix} ✓ Upload SUCCEEDED. Target Strapi ID: ${result.id}`,
      );
      await statusManager.updateJobStatus(
        slug,
        contentType,
        language,
        "completed",
        { targetItemId: result.id, error: null }, // Store target ID, clear error
      );
      return { status: "fulfilled", value: result, job };
    } else {
      // Upload attempt failed (e.g., validation error, timeout after retries)
      console.error(
        `${logPrefix} ✗ Upload FAILED via pushSingleTranslation. Message: ${result.message || "(No message)"}`,
      );
      await statusManager.updateJobStatus(
        slug,
        contentType,
        language,
        "failed_upload",
        { error: result.message || "Upload failed via pushSingleTranslation" },
      );
      return {
        status: "rejected",
        reason: new Error(
          result.message || "Upload failed via pushSingleTranslation",
        ),
        job,
      };
    }
  } catch (error) {
    // Catch critical errors (file reading, JSON parsing, unexpected errors in pushSingleTranslation)
    console.error(
      `${logPrefix} ✗ Critical error processing upload job: ${error.message}`,
    );
    console.error(error.stack); // Log stack trace for debugging

    // Ensure status is marked as failed in DB
    try {
      await statusManager.updateJobStatus(
        slug,
        contentType,
        language,
        "failed_upload",
        { error: `Critical error: ${error.message}` },
      );
    } catch (updateError) {
      console.error(
        `${logPrefix} ‼️ CRITICAL: Failed to update job status to failed_upload after critical error: ${updateError.message}`,
      );
    }
    return { status: "rejected", reason: error, job };
  }
}

/**
 * Reads the old JSON status file and migrates its data to the DB.
 * Runs only once, tracked via the pipeline_migrations table.
 */
async function runOneTimeJsonMigration() {
  console.log("[Migration] Checking if JSON status migration is needed...");
  try {
    const isMigrationDone = await db.checkMigrationStatus(
      db.MIGRATION_NAME_JSON_STATUS,
    );
    if (isMigrationDone) {
      console.log(
        "[Migration] JSON status migration already completed. Skipping.",
      );
      return;
    }
  } catch (err) {
    console.error(
      "[Migration] Failed to check migration status from DB. Aborting migration.",
      err,
    );
    // Depending on severity, you might want to prevent the service from starting fully
    throw new Error("Database error prevented migration check."); // Throw to stop startup
  }

  console.log(
    `[Migration] Starting one-time migration from ${JSON_STATUS_FILE_PATH}...`,
  );

  let jsonData;
  try {
    console.log(`[Migration] Reading JSON file: ${JSON_STATUS_FILE_PATH}`);
    const fileContent = await fs.readFile(JSON_STATUS_FILE_PATH, "utf8");
    jsonData = JSON.parse(fileContent);
    if (!jsonData || !jsonData.files || typeof jsonData.files !== "object") {
      throw new Error("Invalid JSON structure: 'files' object not found.");
    }
    console.log(
      `[Migration] Found ${Object.keys(jsonData.files).length} entries in JSON file.`,
    );
  } catch (err) {
    if (err.code === "ENOENT") {
      console.warn(
        `[Migration] JSON status file not found at ${JSON_STATUS_FILE_PATH}. Assuming no migration needed or file was removed.`,
      );
      // Mark as done even if file not found, to prevent retries on subsequent starts
      try {
        await db.markMigrationComplete(db.MIGRATION_NAME_JSON_STATUS);
      } catch (e) {
        /* ignore */
      }
      return; // Exit migration
    } else {
      console.error(
        `[Migration] Error reading or parsing ${JSON_STATUS_FILE_PATH}: ${err.message}. Aborting migration.`,
      );
      return; // Exit migration, don't mark as complete
    }
  }

  const migrationEntries = Object.entries(jsonData.files);
  let migratedCount = 0;
  let errorCount = 0;

  // Process in batches for potentially large JSON files
  const batchSize = 100;
  for (let i = 0; i < migrationEntries.length; i += batchSize) {
    const batch = migrationEntries.slice(i, i + batchSize);
    console.log(
      `[Migration] Processing batch ${Math.floor(i / batchSize) + 1}...`,
    );

    const values = [];
    const placeholders = [];
    let valueCounter = 1; // Start counter for placeholders ($1, $2, ...)

    for (const [relativePath, fileInfo] of batch) {
      // --- Parse relative path ---
      // Expects: translations/<contentType>/<slug>/<slug>_<language>.json
      const parts = relativePath.split(/[\\\/]/); // Split by slash or backslash
      if (parts.length < 4 || !parts[0].startsWith("translations")) {
        console.warn(
          `[Migration] Skipping invalid path format: ${relativePath}`,
        );
        errorCount++;
        continue;
      }
      const contentType = parts[1];
      const slug = parts[2];
      const filename = parts[parts.length - 1]; // Last part is filename
      const langMatch = filename.match(
        /_([a-zA-Z]{2}(?:-[a-zA-Z0-9-]+)?)\.json$/,
      ); // Match language code at the end
      if (!langMatch || !langMatch[1]) {
        console.warn(
          `[Migration] Skipping path with unparsable language: ${relativePath}`,
        );
        errorCount++;
        continue;
      }
      const language = langMatch[1];

      // --- Map JSON status to DB status ---
      let dbStatus = "pending_upload"; // Default if file exists but has no/unknown status
      switch (fileInfo.status) {
        case "pending":
          dbStatus = "pending_upload";
          break;
        case "uploading":
          dbStatus = "uploading";
          break; // Keep as uploading, let normal cycle handle it
        case "completed":
          dbStatus = "completed";
          break;
        case "failed":
          dbStatus = "failed_upload";
          break;
      }

      // --- Prepare values for insert/update ---
      // We don't know source_item_id or target_item_id from JSON status file
      const lastError = fileInfo.error ? String(fileInfo.error) : null;
      const filePathRelative = relativePath.startsWith("translations/")
        ? relativePath.substring("translations/".length)
        : relativePath; // Store relative to OUTPUT_DIR
      const updatedAt =
        fileInfo.completedAt || fileInfo.startedAt || new Date().toISOString(); // Use timestamp if available

      placeholders.push(
        `($${valueCounter++}, $${valueCounter++}, $${valueCounter++}, $${valueCounter++}, $${valueCounter++}, $${valueCounter++})`,
      );
      values.push(
        slug,
        contentType,
        language,
        dbStatus,
        lastError,
        filePathRelative,
      );
      // Note: We deliberately DO NOT include source/target item IDs here
      // Note: We will use ON CONFLICT to UPDATE, prioritizing JSON state
    } // End loop through batch entries

    if (placeholders.length === 0) {
      console.log("[Migration] No valid entries in this batch to migrate.");
      continue; // Skip to next batch if no valid entries
    }

    // --- Construct and Execute Batch Query ---
    const insertQuery = `
            INSERT INTO translation_jobs (slug, content_type, language, status, last_error, translation_file_path)
            VALUES ${placeholders.join(", ")}
            ON CONFLICT (slug, content_type, language) DO UPDATE SET
                status = EXCLUDED.status,
                last_error = EXCLUDED.last_error,
                translation_file_path = EXCLUDED.translation_file_path,
                -- Only update updated_at if the status is different? Or just always set it? Let's always set it on conflict update.
                updated_at = NOW()
            -- We could add a WHERE clause to be more selective on updates, e.g.:
            -- WHERE translation_jobs.status != 'completed' -- Don't overwrite completed jobs from JSON? Or DO overwrite?
            -- For simplicity, let's overwrite based on JSON during this one-time migration.
            ;
        `;

    try {
      const result = await db.query(insertQuery, values);
      migratedCount += result.rowCount || batch.length; // Estimate count based on batch size or rowCount if available
      console.log(
        `[Migration] Batch processed. Migrated/Updated approx ${batch.length} entries.`,
      );
    } catch (dbError) {
      console.error(
        `[Migration] Database error processing batch: ${dbError.message}. Skipping batch.`,
      );
      console.error(dbError.stack);
      errorCount += batch.length; // Mark whole batch as errored for summary
    }
  } // End loop through batches

  console.log(
    `[Migration] Finished processing JSON file. Migrated/Updated Entries: ~${migratedCount}, Skipped/Errored Entries: ${errorCount}.`,
  );

  // --- Mark migration as complete in DB ---
  // Only mark complete if there weren't significant errors preventing processing?
  // Let's mark complete regardless, to avoid re-running on minor errors. Re-running might cause issues.
  try {
    await db.markMigrationComplete(db.MIGRATION_NAME_JSON_STATUS);
    console.log(
      "[Migration] Successfully marked JSON status migration as complete in database.",
    );
  } catch (markError) {
    console.error(
      "[Migration] CRITICAL: Failed to mark migration as complete in DB!",
      markError,
    );
    // The service might attempt migration again on next start if this fails.
  }
}

/**
 * Periodically fetches pending upload jobs from the DB and processes them concurrently.
 */
async function processPendingUploads() {
  // Fetch jobs needing upload ('pending_upload' or 'failed_upload')
  // Fetch a bit more than the concurrency limit to keep the pipeline full
  const jobsToFetch = MAX_CONCURRENT_UPLOADS * 2;
  const pendingJobs = await statusManager.getPendingUploadJobs(jobsToFetch);

  if (pendingJobs.length === 0) {
    console.log(
      `${new Date().toISOString()} - No pending upload jobs found in database.`,
    );
    return;
  }

  console.log(
    `${new Date().toISOString()} - Found ${pendingJobs.length} pending upload job(s). Starting concurrent processing (limit: ${MAX_CONCURRENT_UPLOADS})...`,
  );

  // --- Concurrency Limiter Logic ---
  let successCount = 0;
  let failureCount = 0;
  const results = []; // Store results from processSingleUploadJob
  let running = 0; // Count of currently active uploads
  let jobIndex = 0; // Index into the pendingJobs array

  await new Promise((resolve) => {
    function runNextUploadJob() {
      // Base case: All fetched jobs have been initiated
      if (jobIndex >= pendingJobs.length) {
        // If no uploads are currently running, resolve the main promise
        if (running === 0) {
          console.log(
            "[UploadMain] All fetched pending jobs processed or started.",
          );
          resolve();
        }
        // else: Still waiting for running jobs to finish
        return; // Exit function, wait for finally() to trigger next check
      }

      // Launch new jobs if below concurrency limit
      while (
        running < MAX_CONCURRENT_UPLOADS &&
        jobIndex < pendingJobs.length
      ) {
        running++;
        const currentJob = pendingJobs[jobIndex++];
        const jobLogPrefix = `[Upload Job ${jobIndex}/${pendingJobs.length}: ${currentJob.slug} -> ${currentJob.language}]`;

        console.log(`${jobLogPrefix} Starting...`);

        processSingleUploadJob(currentJob)
          .then((result) => results.push(result)) // Store the outcome
          .catch((err) => {
            // Catch unexpected errors *from* processSingleUploadJob promise itself
            console.error(
              `${jobLogPrefix} Unexpected error in processSingleUploadJob promise: ${err.message}`,
            );
            results.push({ status: "rejected", reason: err, job: currentJob });
          })
          .finally(() => {
            running--;
            console.log(`${jobLogPrefix} Finished. Running tasks: ${running}.`);
            // Check if we should resolve or run the next job
            if (jobIndex >= pendingJobs.length && running === 0) {
              resolve();
            } else {
              // Immediately try to run the next job if concurrency allows
              runNextUploadJob();
            }
          });
      } // End while loop
    } // End runNextUploadJob function

    // Start the initial batch of jobs
    runNextUploadJob();
  }); // End Promise for concurrency limiter
  // --- End Concurrency Limiter ---

  // --- Process overall results for logging ---
  results.forEach((result) => {
    // Check if the operation succeeded based on the structure returned by processSingleUploadJob
    if (result.status === "fulfilled" && result.value?.success) {
      successCount++;
    } else {
      failureCount++;
      // Optionally log detailed failure reasons again here if desired
      // console.error(`   Summary Failure [${result.job?.slug}/${result.job?.language}]: ${result.reason?.message}`);
    }
  });

  console.log(
    `${new Date().toISOString()} - Finished processing upload batch. Attempted: ${pendingJobs.length}, Success: ${successCount}, Failed: ${failureCount}`,
  );
}

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

// // --- Main Execution Logic ---
// console.log("Upload service starting...");
// console.log(
//   `Checking for pending files every ${UPLOAD_CHECK_INTERVAL_MS / 1000} seconds.`,
// );
// console.log(`Using translations directory: ${TRANSLATIONS_DIR}`);

// // Run the check immediately on startup
// console.log("Performing initial check for pending files...");
// processPendingFiles().catch((err) => {
//   console.error("Error during initial file processing:", err);
// });

// // Schedule periodic checks
// const intervalId = setInterval(() => {
//   console.log(`\n${new Date().toISOString()} - Periodic check triggered...`);
//   processPendingFiles().catch((err) => {
//     // Catch errors from the async function so setInterval doesn't stop
//     console.error(
//       `${new Date().toISOString()} - Error during periodic file processing:`,
//       err,
//     );
//   });
// }, UPLOAD_CHECK_INTERVAL_MS);

// // Optional: Graceful shutdown handling
// process.on("SIGTERM", () => {
//   console.log("SIGTERM signal received: stopping periodic checks.");
//   clearInterval(intervalId);
//   // Add any other cleanup here if needed
//   process.exit(0);
// });

// process.on("SIGINT", () => {
//   console.log("SIGINT signal received: stopping periodic checks.");
//   clearInterval(intervalId);
//   process.exit(0);
// });

// console.log("Upload service is now running periodically.");
// Node.js will stay alive because of setInterval

// --- Main Service Execution Logic ---
async function startService() {
  console.log("Upload service starting...");
  // Ensure database table is ready (safe to call multiple times)
  try {
    await db.initializeDatabase();
  } catch (dbInitError) {
    console.error(
      "CRITICAL: Failed to initialize database for upload service. Exiting.",
      dbInitError,
    );
    process.exit(1);
  }

  try {
    await runOneTimeJsonMigration(); // Attempt migration before starting loop
  } catch (migrationError) {
    console.error(
      "CRITICAL: Migration process failed critically. Exiting.",
      migrationError,
    );
    process.exit(1); // Stop service if migration fails catastrophically
  }

  // --- Step 3: Start Periodic Processing ---
  console.log(`Using translations base directory: ${TRANSLATIONS_DIR}`);
  console.log(
    `Checking for pending upload jobs every ${UPLOAD_CHECK_INTERVAL_MS / 1000} seconds.`,
  );
  console.log(`Max concurrent uploads: ${MAX_CONCURRENT_UPLOADS}`);

  // Perform an initial check immediately on startup
  console.log("Performing initial check for pending upload jobs...");
  processPendingUploads().catch((err) => {
    console.error("Error during initial upload processing:", err);
  });

  // Schedule periodic checks
  const intervalId = setInterval(() => {
    console.log(
      `\n${new Date().toISOString()} - Periodic upload check triggered...`,
    );
    processPendingUploads().catch((err) => {
      // Catch errors from the async function so setInterval doesn't stop
      console.error(
        `${new Date().toISOString()} - Error during periodic upload processing:`,
        err,
      );
    });
  }, UPLOAD_CHECK_INTERVAL_MS);

  // --- Graceful Shutdown ---
  const shutdown = () => {
    console.log("Shutdown signal received: stopping periodic checks...");
    clearInterval(intervalId);
    // Close database connections
    db.pool.end(() => {
      console.log("Database pool closed.");
      process.exit(0); // Exit after pool is closed
    });
    // Set a timeout to force exit if the pool takes too long
    setTimeout(() => {
      console.warn(
        "Database pool did not close gracefully within 5 seconds. Forcing exit.",
      );
      process.exit(1);
    }, 5000);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  // --- End Graceful Shutdown ---

  console.log(
    "Upload service is now running periodically using database status.",
  );
}

// Start the service
startService().catch((err) => {
  console.error("Failed to start upload service:", err);
  process.exit(1);
});
