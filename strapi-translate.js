/**
 * Strapi Content Translation Script (Auto-fetch Reports)
 *
 * This script:
 * 1. Fetches report slugs directly from Strapi (first 50)
 * 2. Translates content to target languages using aggressive batching
 * 3. Saves translations along with metadata to JSON files
 * 4. Logs the total time taken to process each item (all languages)
 */

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const dotenv = require("dotenv");
// Make sure TranslationService correctly uses the optimized TranslationPipeline
const { TranslationService } = require("./trans_pipeline"); // Assumes trans_pipeline requires the optimized translationPipeline.js
const UploadStatusTracker = require("./uploadStatusTracker");

const db = require("./db");
const statusManager = require("./statusManager");

// Load environment variables (from .env file preferably)
dotenv.config();

// Configuration
const SOURCE_URL =
  process.env.SOURCE_URL || "https://web-server-india.univdatos.com"; // Your default or actual URL
const SOURCE_TOKEN = process.env.SOURCE_TOKEN; // Required: API token for source Strapi
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY; // Required: Your Google API Key
const OUTPUT_DIR = process.env.OUTPUT_DIR || "./translations"; // Output directory for JSON files
const SOURCE_LOCALE = process.env.SOURCE_LOCALE || "en"; // Define the source locale
const MAX_REPORTS = parseInt(process.env.MAX_REPORTS || "50");
const MAX_CONCURRENT_TRANSLATIONS = parseInt(
  process.env.MAX_CONCURRENT_TRANSLATIONS || "3",
  10,
);

const statusTracker = new UploadStatusTracker("/app/upload-status.json");
// Define the target languages (if not provided in env, use these defaults)
const DEFAULT_TARGET_LANGS = [
  "es",
  "fr",
  "de",
  "zh-CN",
  "zh-TW",
  "ja",
  "ru",
  "ar",
  "pl",
  "it",
  "vi",
  "ko",
];
const TARGET_LANGS = process.env.TARGET_LANGS
  ? process.env?.TARGET_LANGS?.split(",")
  : DEFAULT_TARGET_LANGS;

const CACHE_DIR = process.env.CACHE_DIR || "./translation-cache"; // Directory for cache file
const CACHE_FILENAME = "translationCache.json";
const CACHE_FILE_PATH = path.join(CACHE_DIR, CACHE_FILENAME);

// Validate required environment variables
if (!SOURCE_URL || !SOURCE_TOKEN || !GOOGLE_API_KEY) {
  console.error(
    "Error: Missing required environment variables (SOURCE_URL, SOURCE_TOKEN, GOOGLE_API_KEY)",
  );
  process.exit(1);
}

// Create output and cache directories if they don't exist
for (const dir of [OUTPUT_DIR, CACHE_DIR]) {
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    } catch (error) {
      console.error(`Error creating directory ${dir}:`, error);
      process.exit(1);
    }
  }
}

function loadCache() {
  if (fs.existsSync(CACHE_FILE_PATH)) {
    console.log(`Loading cache from ${CACHE_FILE_PATH}...`);
    try {
      const cacheData = fs.readFileSync(CACHE_FILE_PATH, "utf8");
      const parsedCache = JSON.parse(cacheData);
      console.log(
        `Cache loaded successfully. Found languages: ${Object.keys(parsedCache).join(", ")}`,
      );
      return parsedCache;
    } catch (error) {
      console.error(
        `Error reading or parsing cache file ${CACHE_FILE_PATH}:`,
        error,
      );
      console.warn("Starting with an empty cache.");
      return {}; // Return empty cache on error
    }
  } else {
    console.log("Cache file not found. Starting with an empty cache.");
    return {}; // Return empty cache if file doesn't exist
  }
}

function saveCache(cacheData) {
  console.log(`\nAttempting to save cache to ${CACHE_FILE_PATH}...`);
  try {
    // Ensure cache directory exists one last time
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(cacheData, null, 2)); // Pretty print
    console.log(
      `Cache saved successfully (${Object.keys(cacheData).length} languages).`,
    );
  } catch (error) {
    console.error(`Error saving cache to ${CACHE_FILE_PATH}:`, error);
  }
}

// Create HTTP client for source Strapi
const sourceApi = axios.create({
  baseURL: SOURCE_URL, // Use the base URL without /api here
  headers: {
    Authorization: `Bearer ${SOURCE_TOKEN}`,
    "Content-Type": "application/json",
  },
});

/**
 * Fetch report slugs from Strapi
 * @param {number} limit - Maximum number of reports to fetch
 * @returns {Promise<Array>} Array of report slugs
 */
async function fetchReportSlugs(limit = 50) {
  try {
    console.log(`Fetching up to ${limit} report slugs from Strapi...`);

    // Query to get only published reports with slug and id fields
    const response = await sourceApi.get(
      `/api/reports?pagination[limit]=${limit}&locale=${SOURCE_LOCALE}&fields[0]=slug`,
    );

    if (!response.data?.data || !Array.isArray(response.data.data)) {
      throw new Error("Invalid response format from Strapi API");
    }

    const reports = response.data.data;
    const slugs = reports
      .map((report) => ({
        slug: report.attributes.slug,
        id: report.id,
      }))
      .filter((item) => item.slug); // Filter out items with no slug
    //
    // const slugs = [{ slug: "aircraft-seat-upholstery-market", id: 8 }];

    console.log(`Successfully fetched ${slugs.length} report slugs`);
    return slugs;
  } catch (error) {
    console.error(`Error fetching report slugs: ${error.message}`);
    if (error.response) {
      console.error("Strapi Error Status:", error.response.status);
      console.error("Strapi Error Response:", error.response.data);
    }
    throw error;
  }
}

// Helper to build Strapi populate query
const buildPopulateQuery = (fields) => {
  if (!fields || fields.length === 0) {
    return "";
  }
  // Convert the array into a string format that Strapi expects for populate
  const populateString = fields
    .map((field, i) => `populate[${i}]=${field}`)
    .join("&");
  // Return with leading '&' if populateString is not empty
  return populateString ? `&${populateString}` : "";
};

/**
 * Fetch content from source Strapi by slug for a specific content type.
 * @param {string} slug Content slug
 * @param {string} contentType The plural API ID (e.g., 'reports', 'news-articles')
 * @returns {Promise<Object>} Full Strapi API response object for the item.
 */
async function fetchContent(slug, contentType) {
  // Define the fields to populate based on your provided list
  const populateFields = [
    "industry.name",
    "geography.name",
    "heroSectionPrimaryCTA.link",
    "heroSectionSecondaryCTA.link",
    "tableOfContent.title",
    "faqList.title",
    "ctaBanner.ctaButton.link",
    "leftSectionPrimaryCTAButton",
    "leftSectionSecondaryCTAButton",
    "highlightImage.url",
    "tableOfContent",
    "faqList",
    "variants.price.amount",
    "seo.metaSocial.image",
  ];
  const populateQuery = buildPopulateQuery(populateFields);

  try {
    console.log(
      `Fetching ${contentType} content for slug: ${slug} (locale: ${SOURCE_LOCALE})`,
    );
    // Filter by slug and ensure we get the source locale version
    const filterQuery = `?filters[slug][$eq]=${slug}&locale=${SOURCE_LOCALE}`;
    // Construct URL relative to baseURL, including /api prefix
    const url = `/api/${contentType}${filterQuery}${populateQuery}`;

    const response = await sourceApi.get(url);

    if (!response.data?.data?.length) {
      throw new Error(
        `No content found for slug: ${slug}, locale: ${SOURCE_LOCALE} in ${contentType}`,
      );
    }

    console.log(`Successfully fetched content for ${slug}`);
    return response.data.data[0]; // Return the full item data { id, attributes, meta }
  } catch (error) {
    console.error(
      `Error fetching ${contentType} content for ${slug}: ${error.message}`,
    );
    if (error.response) {
      console.error("Strapi Error Status:", error.response.status);
      console.error(
        "Strapi Error Response:",
        JSON.stringify(error.response.data, null, 2),
      );
    } else {
      console.error("Error details:", error);
    }
    throw error; // Re-throw to be caught by processItem
  }
}

/**
 * Save translated data to a JSON file.
 * Includes metadata needed for the later upload step.
 * @param {Object} translatedAttributes The translated attributes object.
 * @param {string} targetLocale The language code this was translated to.
 * @param {number} originalItemId The ID of the source item in Strapi.
 * @param {string} originalSlug The slug of the source item.
 * @param {string} contentType The plural API ID of the content type.
 * @returns {string} Path to the saved file.
 */
function saveToFile(
  translatedAttributes,
  targetLocale,
  originalItemId,
  originalSlug,
  contentType,
) {
  // Organize files by content type, then original slug, then language
  const outputDir = path.join(OUTPUT_DIR, contentType, originalSlug);

  // Create directory if it doesn't exist
  // Add error handling for directory creation
  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  } catch (mkdirError) {
    console.error(`Error creating directory ${outputDir}:`, mkdirError);
    // Decide how to handle this - maybe throw to stop?
    throw mkdirError;
  }

  const filename = `${originalSlug}_${targetLocale}.json`;
  const filePath = path.join(outputDir, filename);

  // Structure the JSON data for the upload script's convenience
  const dataToSave = {
    originalItemId: originalItemId,
    originalSlug: originalSlug,
    contentType: contentType,
    targetLocale: targetLocale,
    translatedAttributes: translatedAttributes, // Contains only the translated fields
  };

  try {
    fs.writeFileSync(filePath, JSON.stringify(dataToSave, null, 2)); // Pretty print JSON
    // console.log(`✓ Saved translation to: ${filePath}`); // Reduce log noise slightly
    return filePath;
  } catch (error) {
    console.error(`Error saving file ${filePath}:`, error);
    throw error; // Propagate error
  }
}

/**
 * Processes a single translation job based on DB status.
 * Fetches original content, translates, saves file, and updates DB status.
 *
 * @param {object} job - Job object from DB { slug, contentType, language, source_item_id }
 * @param {object} globalCache - The global translation memory cache object.
 */
async function processItem(job, globalCache) {
  const { slug, contentType, language, source_item_id } = job;
  const logPrefix = ` -> [${slug} -> ${language}]`;
  const timerLabel = `Job ${slug}/${language}`; // Timer specific to this job

  console.time(timerLabel);
  console.log(
    `${logPrefix} Starting translation job for Source ID: ${source_item_id}.`,
  );

  let originalContent = null; // To store fetched content

  try {
    // --- Step 1: Mark Job as 'translating' in DB ---
    // This prevents other workers/runs picking it up simultaneously.
    const markedTranslating = await statusManager.updateJobStatus(
      slug,
      contentType,
      language,
      "translating",
    );
    if (!markedTranslating) {
      // This could happen if the job was deleted or another race condition.
      console.warn(
        `${logPrefix} Failed to mark job as 'translating'. Skipping.`,
      );
      console.timeEnd(timerLabel);
      return; // Stop processing this job
    }

    // --- Step 2: Fetch Original Content ---
    console.log(`${logPrefix} Fetching original content...`);
    try {
      originalContent = await fetchContent(slug, contentType); // Assuming fetchContent uses slug primarily
      // Validate fetched content and ID
      if (!originalContent || !originalContent.id) {
        throw new Error(`Could not fetch valid original content or ID.`);
      }
      if (originalContent.id !== source_item_id) {
        // Log mismatch but proceed with the fetched ID as the definitive source for translation context
        console.warn(
          `${logPrefix} Source ID mismatch. Job expected ${source_item_id}, fetched ${originalContent.id}. Using fetched ID ${originalContent.id} for translation context.`,
        );
        // It's crucial that saveToFile and other logic uses the *correct* original ID for Strapi linking later
        // Let's stick to source_item_id from the job for consistency downstream
      }
    } catch (fetchError) {
      // If fetching fails, mark job as failed_translation and stop
      throw new Error(
        `Failed to fetch original content: ${fetchError.message}`,
      ); // Throw to main catch block
    }

    // --- Step 3: Translate Content ---
    console.log(`${logPrefix} Translating content...`);
    globalCache[language] = globalCache[language] || {}; // Ensure language cache exists
    const translator = new TranslationService(
      GOOGLE_API_KEY,
      language,
      globalCache[language],
    );

    const translationResult = await translator.translateContent(
      originalContent, // Pass the fetched content object { id, attributes }
      language,
    );

    // Validate the result
    const translatedAttributes =
      translationResult.attributes || translationResult;
    if (
      !translatedAttributes ||
      typeof translatedAttributes !== "object" ||
      Object.keys(translatedAttributes).length === 0
    ) {
      throw new Error("Translation result was empty or invalid.");
    }

    // --- Step 4: Save Translation to File ---
    console.log(`${logPrefix} Saving translation to file...`);
    const savedFilePath = saveToFile(
      translatedAttributes,
      language,
      source_item_id, // IMPORTANT: Use the source_item_id from the job for correct linking info
      slug,
      contentType,
    );
    console.log(
      `${logPrefix} ✓ Saved translation JSON to ${path.basename(savedFilePath)}`,
    );

    // Calculate relative path for storage in DB (relative to the defined OUTPUT_DIR)
    const relativeSavedPath = path
      .relative(OUTPUT_DIR, savedFilePath)
      .replace(/\\/g, "/"); // Normalize slashes

    // --- Step 5: Mark Job as 'pending_upload' in DB ---
    console.log(`${logPrefix} Updating job status to 'pending_upload'.`);
    await statusManager.updateJobStatus(
      slug,
      contentType,
      language,
      "pending_upload",
      {
        translationFilePath: relativeSavedPath, // Store the relative path
        error: null, // Clear any previous error
      },
    );

    console.log(`${logPrefix} ✓ Job finished successfully.`);
  } catch (error) {
    // Catch any error from Steps 2-4
    console.error(`${logPrefix} ❌ FAILED translation job: ${error.message}`);
    console.error(error.stack); // Log stack for debugging

    // Mark Job as 'failed_translation' in DB
    try {
      await statusManager.updateJobStatus(
        slug,
        contentType,
        language,
        "failed_translation",
        { error: error.message }, // Store the error message
      );
      console.log(`${logPrefix} Job status updated to 'failed_translation'.`);
    } catch (updateError) {
      console.error(
        `${logPrefix} ‼️ CRITICAL: Failed to update job status to failed_translation after error: ${updateError.message}`,
      );
    }
    // Do not re-throw here if the main concurrency loop catches rejections separately
    // throw error; // Re-throw if the calling concurrency loop needs to know about the failure explicitly
  } finally {
    console.timeEnd(timerLabel); // Ensure timer always ends
  }
}

/**
 * Main function to fetch report slugs, initialize DB jobs,
 * and translate pending jobs concurrently.
 */
async function main() {
  // --- Initialize DB Connection/Table ---
  // This ensures the table exists before we try to use it. Safe to call multiple times.
  try {
    await db.initializeDatabase();
  } catch (dbInitError) {
    console.error(
      "CRITICAL: Failed to initialize database. Exiting.",
      dbInitError,
    );
    process.exit(1); // Exit if DB is not available/setup
  }

  const globalTranslationCache = loadCache();
  let isSaving = false; // Flag for shutdown handler

  // Setup graceful shutdown for cache saving
  const shutdownHandler = () => {
    if (!isSaving) {
      isSaving = true;
      console.log("\nShutdown signal received.");
      saveCache(globalTranslationCache);
      // NOTE: We don't close the DB pool here, as this main function
      // might be called periodically by fetch-translate.js. Let the pool manage connections.
      // If this were a single-run script, you might add db.pool.end() here.
      process.exit(0); // Exit cleanly
    }
  };
  process.on("SIGINT", shutdownHandler); // Catch Ctrl+C
  process.on("SIGTERM", shutdownHandler); // Catch kill command

  const mainTimerLabel = "Total Translation Script Execution Time";
  console.time(mainTimerLabel);
  console.log(
    `Starting translation process... Concurrency: ${MAX_CONCURRENT_TRANSLATIONS}, Max Source Reports: ${MAX_REPORTS}`,
  );
  console.log(`Target languages: ${TARGET_LANGS.join(", ")}`);

  try {
    // --- Step 1: Fetch Source Slugs/IDs ---
    const contentType = "reports"; // Define content type
    const reportSlugsAndIds = await fetchReportSlugs(MAX_REPORTS);

    if (!reportSlugsAndIds || reportSlugsAndIds.length === 0) {
      console.log("No source report slugs found to process.");
      console.timeEnd(mainTimerLabel);
      if (!isSaving) saveCache(globalTranslationCache); // Save cache even if no reports found
      return; // Nothing to do
    }
    console.log(
      `Fetched ${reportSlugsAndIds.length} source reports from Strapi.`,
    );

    // --- Step 2: Initialize/Verify DB Job Entries ---
    // Ensures a DB row exists for every report/language combination fetched.
    // Doesn't overwrite existing statuses.
    await statusManager.initializeJobs(
      reportSlugsAndIds,
      TARGET_LANGS,
      contentType,
    );

    // --- Step 3: Fetch Pending Translation Jobs ---
    // Get jobs that are actually ready for translation (pending or failed previously)
    // Limit fetch slightly arbitarily - adjust if needed based on typical pending counts
    const pendingJobs = await statusManager.getPendingTranslationJobs(
      MAX_REPORTS * TARGET_LANGS.length,
    );

    if (pendingJobs.length === 0) {
      console.log(
        "No jobs currently require translation (status 'pending_translation' or 'failed_translation').",
      );
      console.timeEnd(mainTimerLabel);
      if (!isSaving) saveCache(globalTranslationCache);
      return; // Nothing to process right now
    }

    console.log(
      `\n--- Found ${pendingJobs.length} translation jobs to process. Starting concurrent processing... ---`,
    );

    // --- Step 4: Process Pending Jobs Concurrently ---
    let jobsProcessedSuccessfully = 0; // Count jobs where processItem resolves without throwing
    let jobsFailedCritically = 0; // Count jobs where processItem rejects or fails fundamentally
    const results = []; // Store outcomes if needed
    let running = 0;
    let jobIndex = 0;

    await new Promise((resolve) => {
      function runNextTranslationJob() {
        // Base case: All jobs have been started
        if (jobIndex >= pendingJobs.length) {
          // If no jobs are currently running, we're done.
          if (running === 0) {
            console.log("[Main] All pending jobs processed or started.");
            resolve();
          } else {
            // console.log(`[Main] Waiting for ${running} running jobs to finish...`);
          }
          return; // Exit function if all started or resolved
        }

        // Launch next job(s) if concurrency limit allows
        while (
          running < MAX_CONCURRENT_TRANSLATIONS &&
          jobIndex < pendingJobs.length
        ) {
          running++;
          const currentJob = pendingJobs[jobIndex++];
          const jobLogPrefix = `[Job ${jobIndex}/${pendingJobs.length}: ${currentJob.slug} -> ${currentJob.language}]`;

          console.log(`${jobLogPrefix} Starting...`);

          // Execute processItem for the current job
          processItem(currentJob, globalTranslationCache)
            .then(() => {
              // processItem handles its own internal success/failure logging and status updates
              results.push({ job: currentJob, status: "fulfilled" });
              jobsProcessedSuccessfully++; // Increment if processItem completes
            })
            .catch((itemError) => {
              // This catch block is for unexpected errors thrown BY processItem itself
              // (processItem should ideally handle internal errors and update status)
              console.error(
                `${jobLogPrefix} CRITICAL error during processItem: ${itemError.message}`,
              );
              results.push({
                job: currentJob,
                status: "rejected",
                reason: itemError,
              });
              jobsFailedCritically++; // Increment critical failure count
            })
            .finally(() => {
              running--;
              console.log(
                `${jobLogPrefix} Finished. Running tasks: ${running}.`,
              );
              // Check if we need to resolve the main promise or run the next job
              if (jobIndex >= pendingJobs.length && running === 0) {
                resolve();
              } else {
                // Try to launch the next job immediately
                runNextTranslationJob();
              }
            });
        } // End while loop
      } // End runNextTranslationJob function

      // Start the initial batch of jobs
      runNextTranslationJob();
    }); // End Promise for concurrency limiter
    // --- End Concurrency Limiter ---

    console.log(`\n--- Concurrent translation processing finished ---`);
    console.log(`Total Pending Jobs Attempted: ${pendingJobs.length}`);
    console.log(
      `Jobs Completed (processItem resolved): ${jobsProcessedSuccessfully}`,
    );
    console.log(`Jobs Failed (processItem rejected): ${jobsFailedCritically}`);
  } catch (error) {
    console.error(`❌ Error in main translation process: ${error.message}`);
    console.error(error.stack);
  }

  console.log("\nTranslation and JSON saving process completed for this run.");
  console.timeEnd(mainTimerLabel);

  // Save cache at the end of the run
  if (!isSaving) {
    saveCache(globalTranslationCache);
  }
}

// Run script if directly invoked
if (require.main === module) {
  main()
    .then(() => console.log("\nTranslation script run finished successfully."))
    .catch((err) => {
      console.error("\n--- TRANSLATION SCRIPT FAILED ---");
      console.error(err);
      process.exit(1); // Exit with error code
    });
}

module.exports = {
  processItem,
  fetchContent,
  saveToFile,
  fetchReportSlugs,
  main,
};
