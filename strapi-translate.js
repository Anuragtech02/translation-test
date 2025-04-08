// strapi-translate.js (Corrected - Fully DB Integrated)

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const dotenv = require("dotenv");
const db = require("./db"); // Require DB module
const statusManager = require("./statusManager"); // Require Status Manager module
const { TranslationService } = require("./trans_pipeline");

dotenv.config();

// --- Configuration ---
const SOURCE_URL =
  process.env.SOURCE_URL || "https://web-server-india.univdatos.com";
const SOURCE_TOKEN = process.env.SOURCE_TOKEN;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const OUTPUT_DIR = process.env.OUTPUT_DIR || "/app/translations"; // Use absolute path
const SOURCE_LOCALE = process.env.SOURCE_LOCALE || "en";
const MAX_REPORTS = parseInt(process.env.MAX_REPORTS || "50", 10);
const MAX_CONCURRENT_TRANSLATIONS = parseInt(
  process.env.MAX_CONCURRENT_TRANSLATIONS || "3",
  10,
);
const TARGET_LANGS = process.env.TARGET_LANGS
  ? process.env.TARGET_LANGS.split(",").map((l) => l.trim())
  : [
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

const CACHE_DIR = process.env.CACHE_DIR || "/app/translation-cache"; // Use absolute path
const CACHE_FILE_PATH = path.join(CACHE_DIR, "translationCache.json");

// --- REMOVED UploadStatusTracker ---

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

// --- Cache Logic --- (Keep your existing functions)
function loadCache() {
  console.log(`Loading cache from ${CACHE_FILE_PATH}...`);
  try {
    if (fs.existsSync(CACHE_FILE_PATH)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE_PATH, "utf8"));
    }
  } catch (e) {
    console.error("Error loading cache:", e);
  }
  console.log("Cache file not found or error loading. Starting empty.");
  return {};
}

function saveCache(cacheData) {
  console.log(`\nAttempting to save cache to ${CACHE_FILE_PATH}...`);
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(cacheData, null, 2));
    console.log(
      `Cache saved successfully (${Object.keys(cacheData).length} languages).`,
    );
  } catch (e) {
    console.error(`Error saving cache to ${CACHE_FILE_PATH}:`, e);
  }
}

// --- Strapi API Client ---
const sourceApi = axios.create({
  baseURL: SOURCE_URL,
  headers: {
    Authorization: `Bearer ${SOURCE_TOKEN}`,
    "Content-Type": "application/json",
  },
  timeout: 60000, // Add a reasonable timeout (e.g., 60 seconds)
});

// --- Helper Functions ---

async function fetchReportSlugs(limit = 50) {
  try {
    console.log(`Fetching up to ${limit} report slugs from Strapi...`);
    const response = await sourceApi.get(`/api/reports`, {
      params: {
        "pagination[limit]": limit,
        locale: SOURCE_LOCALE,
        fields: ["slug"], // Only fetch slug
        sort: ["publishedAt:desc"], // Or however you want to prioritize
      },
    });

    if (!response.data?.data || !Array.isArray(response.data.data)) {
      throw new Error("Invalid response format from Strapi API");
    }

    const reports = response.data.data;
    const slugsAndIds = reports
      .map((report) => ({
        slug: report.attributes.slug,
        id: report.id,
      }))
      .filter((item) => item.slug && item.id); // Ensure both slug and id exist

    console.log(`Successfully fetched ${slugsAndIds.length} report slugs/IDs`);
    return slugsAndIds;
  } catch (error) {
    console.error(`Error fetching report slugs: ${error.message}`);
    if (error.response) {
      console.error("Strapi Error Status:", error.response.status);
      console.error(
        "Strapi Error Response:",
        JSON.stringify(error.response.data, null, 2),
      );
    }
    throw error; // Re-throw to be caught by main
  }
}

const buildPopulateQuery = (fields) => {
  if (!fields || fields.length === 0) return "";
  return fields.map((field, i) => `populate[${i}]=${field}`).join("&");
};

async function fetchContent(slug, contentType) {
  const populateFields = [
    /* ... your list of fields ... */ "industry.name",
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
    "seo", // Ensure SEO itself is populated
  ];
  const populateQuery = buildPopulateQuery(populateFields);
  const filterQuery = `?filters[slug][$eq]=${slug}&locale=${SOURCE_LOCALE}`;
  const url = `/api/${contentType}${filterQuery}${populateQuery ? "&" + populateQuery : ""}`;

  console.log(`Fetching ${contentType} content for slug: ${slug} from ${url}`);
  try {
    const response = await sourceApi.get(url);
    if (!response.data?.data?.length || !response.data.data[0].id) {
      throw new Error(
        `No valid content found (or missing ID) for slug: ${slug}`,
      );
    }
    console.log(
      `Successfully fetched content for ${slug} (ID: ${response.data.data[0].id})`,
    );
    return response.data.data[0]; // Return the full item data { id, attributes, meta }
  } catch (error) {
    console.error(
      `Error fetching ${contentType} content for ${slug}: ${error.message}`,
    );
    if (error.response) {
      console.error("Strapi Fetch Error Status:", error.response.status);
      console.error(
        "Strapi Fetch Error Response:",
        JSON.stringify(error.response.data, null, 2),
      );
    }
    throw error; // Re-throw to be caught by processItem
  }
}

function saveToFile(
  translatedAttributes,
  targetLocale,
  originalItemId,
  originalSlug,
  contentType,
) {
  const outputDir = path.join(OUTPUT_DIR, contentType, originalSlug);
  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  } catch (mkdirError) {
    console.error(`Error creating directory ${outputDir}:`, mkdirError);
    throw mkdirError; // Propagate error
  }

  const filename = `${originalSlug}_${targetLocale}.json`;
  const filePath = path.join(outputDir, filename);
  const dataToSave = {
    originalItemId: originalItemId,
    originalSlug: originalSlug,
    contentType: contentType,
    targetLocale: targetLocale,
    translatedAttributes: translatedAttributes,
  };

  try {
    fs.writeFileSync(filePath, JSON.stringify(dataToSave, null, 2));
    return filePath; // Return the full path
  } catch (error) {
    console.error(`Error saving file ${filePath}:`, error);
    throw error; // Propagate error
  }
}

/**
 * Processes a single translation job based on DB status.
 * Fetches original content, translates, saves file, and updates DB status.
 * (This is the DB-Integrated version)
 *
 * @param {object} job - Job object from DB { slug, contentType, language, source_item_id }
 * @param {object} globalCache - The global translation memory cache object.
 */
async function processItem(job, globalCache) {
  const { slug, contentType, language, source_item_id } = job;
  const logPrefix = ` -> [${slug} -> ${language}]`;
  const timerLabel = `Job ${slug}/${language}`; // Timer specific to this job

  console.time(timerLabel);
  // Add logging to check received values
  console.log(
    `${logPrefix} Starting translation job. Received: slug=${slug}, contentType=${contentType}, language=${language}, source_id=${source_item_id}.`,
  );

  let originalContent = null; // To store fetched content

  try {
    // --- Step 1: Mark Job as 'translating' in DB ---
    console.log(
      `${logPrefix} Attempting to mark as translating. ContentType: ${contentType}`,
    ); // Log contentType
    const markedTranslating = await statusManager.updateJobStatus(
      slug,
      contentType,
      language,
      "translating",
    );
    if (!markedTranslating) {
      console.warn(
        `${logPrefix} Failed to mark job as 'translating'. Job might not exist or DB issue. Skipping.`,
      );
      console.timeEnd(timerLabel); // End timer here on early exit
      return; // Stop processing this job
    }

    // --- Step 2: Fetch Original Content ---
    console.log(`${logPrefix} Fetching original content...`);
    // Fetch error is caught and re-thrown inside fetchContent, will be handled by main catch block
    originalContent = await fetchContent(slug, contentType);

    // Validate fetched content and ID *after* fetchContent succeeds
    if (!originalContent || !originalContent.id) {
      throw new Error(`Could not fetch valid original content or ID.`);
    }
    if (originalContent.id !== source_item_id) {
      console.warn(
        `${logPrefix} Source ID mismatch. Job expected ${source_item_id}, fetched ${originalContent.id}. Using fetched ID ${originalContent.id} for translation context.`,
      );
    }

    // --- Step 3: Translate Content ---
    console.log(`${logPrefix} Translating content...`);
    globalCache[language] = globalCache[language] || {};
    const translator = new TranslationService(
      GOOGLE_API_KEY,
      language,
      globalCache[language],
    );
    const translationResult = await translator.translateContent(
      originalContent,
      language,
    );
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
      source_item_id,
      slug,
      contentType,
    );
    console.log(
      `${logPrefix} ✓ Saved translation JSON to ${path.basename(savedFilePath)}`,
    );

    // Calculate relative path for storage in DB
    const relativeSavedPath = path
      .relative(OUTPUT_DIR, savedFilePath)
      .replace(/\\/g, "/");

    // --- Step 5: Mark Job as 'pending_upload' in DB ---
    console.log(
      `${logPrefix} Updating job status to 'pending_upload'. ContentType: ${contentType}`,
    ); // Log contentType
    await statusManager.updateJobStatus(
      slug,
      contentType,
      language,
      "pending_upload",
      { translationFilePath: relativeSavedPath, error: null },
    );

    console.log(`${logPrefix} ✓ Job finished successfully.`);
  } catch (error) {
    console.error(`${logPrefix} ❌ FAILED translation job: ${error.message}`);
    console.error(error.stack);

    // Mark Job as 'failed_translation' in DB
    try {
      // Ensure contentType is defined before calling update
      const finalContentType = contentType || "reports"; // Fallback if undefined somehow
      console.log(
        `${logPrefix} Attempting to mark as failed_translation. ContentType: ${finalContentType}`,
      ); // Log contentType
      await statusManager.updateJobStatus(
        slug,
        finalContentType,
        language,
        "failed_translation",
        { error: error.message },
      );
      console.log(`${logPrefix} Job status updated to 'failed_translation'.`);
    } catch (updateError) {
      console.error(
        `${logPrefix} ‼️ CRITICAL: Failed to update job status to failed_translation after error: ${updateError.message}`,
      );
    }
  } finally {
    console.timeEnd(timerLabel);
  }
}

// ========================================================================
// ===                 MAIN FUNCTION (DB Integrated)                    ===
// ========================================================================
async function main() {
  try {
    await db.initializeDatabase();
  } catch (dbInitError) {
    console.error(
      "CRITICAL: Failed to initialize database. Exiting.",
      dbInitError,
    );
    process.exit(1);
  }

  const globalTranslationCache = loadCache();
  let isSaving = false;
  const shutdownHandler = () => {
    /* ... */
  }; // Keep existing handler
  process.on("SIGINT", shutdownHandler);
  process.on("SIGTERM", shutdownHandler);

  const mainTimerLabel = "Total Translation Script Run Time"; // Renamed label slightly
  console.time(mainTimerLabel);
  console.log(
    `Starting translation process run... Concurrency: ${MAX_CONCURRENT_TRANSLATIONS}, Max Source Reports: ${MAX_REPORTS}`,
  );
  console.log(`Target languages: ${TARGET_LANGS.join(", ")}`);

  try {
    const contentType = "reports";
    const reportSlugsAndIds = await fetchReportSlugs(MAX_REPORTS);

    if (!reportSlugsAndIds || reportSlugsAndIds.length === 0) {
      console.log("No source report slugs found to process this run.");
      console.timeEnd(mainTimerLabel);
      if (!isSaving) saveCache(globalTranslationCache);
      return;
    }
    console.log(
      `Fetched ${reportSlugsAndIds.length} source reports from Strapi.`,
    );

    await statusManager.initializeJobs(
      reportSlugsAndIds,
      TARGET_LANGS,
      contentType,
    );

    const pendingJobs = await statusManager.getPendingTranslationJobs(
      MAX_REPORTS * TARGET_LANGS.length,
    );

    // --- ADD IMMEDIATE LOGGING HERE ---
    console.log(
      `[Main Fetch Result] Fetched ${pendingJobs.length} pending jobs. Logging first few:`,
    );
    for (let i = 0; i < Math.min(pendingJobs.length, 5); i++) {
      // Log first 5 or fewer
      console.log(
        `[Main Fetch Result] Job ${i}:`,
        JSON.stringify(pendingJobs[i]),
      );
      // Explicitly check contentType right here
      if (pendingJobs[i]) {
        console.log(
          `[Main Fetch Result] Job ${i} - contentType value: ${pendingJobs[i].content_type}, type: ${typeof pendingJobs[i].content_type}`,
        );
      } else {
        console.log(
          `[Main Fetch Result] Job ${i} - Job object itself is undefined/null.`,
        );
      }
    }
    // --- END IMMEDIATE LOGGING ---

    if (pendingJobs.length === 0) {
      console.log(
        "No jobs require translation ('pending_translation' or 'failed_translation') at this time.",
      );
      console.timeEnd(mainTimerLabel);
      if (!isSaving) saveCache(globalTranslationCache);
      return;
    }

    console.log(
      `\n--- Found ${pendingJobs.length} translation jobs to process. Starting concurrent processing... ---`,
    );

    let jobsProcessedSuccessfully = 0;
    let jobsFailedCritically = 0;
    const results = [];
    let running = 0;
    let jobIndex = 0;

    await new Promise((resolve) => {
      function runNextTranslationJob() {
        if (jobIndex >= pendingJobs.length) {
          if (running === 0) resolve();
          return;
        }
        while (
          running < MAX_CONCURRENT_TRANSLATIONS &&
          jobIndex < pendingJobs.length
        ) {
          running++;
          const currentJob = pendingJobs[jobIndex++];

          console.log(
            `[DEBUG Job Check ${jobIndex}] Raw Job Data:`,
            JSON.stringify(currentJob),
          ); // Keep this

          if (currentJob) {
            // --- ADDED KEY LOGGING ---
            console.log(
              `[DEBUG Job Check ${jobIndex}] Object Keys:`,
              Object.keys(currentJob),
            );
            // --- ADDED EXPLICIT ACCESS LOG ---
            let contentTypeValue = currentJob.content_type; // Access using standard property name
            console.log(
              `[DEBUG Job Check ${jobIndex}] Explicit Access content_type: Value='${contentTypeValue}', Type=${typeof contentTypeValue}`,
            );
            // ---

            // Original detailed checks
            console.log(
              `[DEBUG Job Check ${jobIndex}] Slug Check: Value='${currentJob.slug}', Type=${typeof currentJob.slug}, Falsy=${!currentJob.slug}`,
            );
            // Use the explicitly accessed variable for the check log
            console.log(
              `[DEBUG Job Check ${jobIndex}] ContentType Check: Value='${contentTypeValue}', Type=${typeof contentTypeValue}, Falsy=${!contentTypeValue}`,
            );
            console.log(
              `[DEBUG Job Check ${jobIndex}] Language Check: Value='${currentJob.language}', Type=${typeof currentJob.language}, Falsy=${!currentJob.language}`,
            );
            console.log(
              `[DEBUG Job Check ${jobIndex}] SourceID Check: Value='${currentJob.source_item_id}', Type=${typeof currentJob.source_item_id}, Falsy=${!currentJob.source_item_id}`,
            );

            // --- Modify the IF condition to use the explicitly accessed value ---
            if (
              !currentJob ||
              !currentJob.slug ||
              !contentTypeValue ||
              !currentJob.language ||
              !currentJob.source_item_id
            ) {
              console.error(
                `[Main] Invalid job data encountered at index ${jobIndex - 1}. Skipping. Condition Failed. Explicit ContentType Value: ${contentTypeValue}`,
              ); // Log the value again
              running--;
              jobsFailedCritically++;
              runNextTranslationJob(); // Try next immediately
              continue; // Skip to next iteration of while loop
            }
            // --- End modification to IF condition ---
          } else {
            console.log(`[DEBUG Job Check ${jobIndex}] !currentJob is TRUE`);
            // Also fail if currentJob is null/undefined
            console.error(
              `[Main] Invalid job data encountered at index ${jobIndex - 1}. Skipping. currentJob is null/undefined.`,
            );
            running--;
            jobsFailedCritically++;
            runNextTranslationJob();
            continue;
          }

          const jobLogPrefix = `[Job ${jobIndex}/${pendingJobs.length}: ${currentJob.slug} -> ${currentJob.language}]`;
          console.log(`${jobLogPrefix} Starting...`);

          processItem(currentJob, globalTranslationCache)
            .then(() => {
              results.push({ job: currentJob, status: "fulfilled" });
              jobsProcessedSuccessfully++;
            })
            .catch((itemError) => {
              console.error(
                `${jobLogPrefix} CRITICAL error during processItem call: ${itemError.message}`,
              );
              results.push({
                job: currentJob,
                status: "rejected",
                reason: itemError,
              });
              jobsFailedCritically++;
            })
            .finally(() => {
              running--;
              console.log(
                `${jobLogPrefix} Finished. Running tasks: ${running}.`,
              );
              if (jobIndex >= pendingJobs.length && running === 0) resolve();
              else runNextTranslationJob();
            });
        }
      }
      runNextTranslationJob();
    });

    console.log(`\n--- Concurrent translation processing finished ---`);
    console.log(`Total Pending Jobs Attempted This Run: ${pendingJobs.length}`);
    console.log(
      `Jobs Completed Run (processItem resolved): ${jobsProcessedSuccessfully}`,
    );
    console.log(
      `Jobs Failed Run (processItem rejected/invalid): ${jobsFailedCritically}`,
    );
  } catch (error) {
    console.error(`❌ Error in main translation process: ${error.message}`);
    console.error(error.stack);
  }

  console.log("\nTranslation and JSON saving process completed for this run.");
  console.timeEnd(mainTimerLabel);
  if (!isSaving) saveCache(globalTranslationCache);
}

// --- Script Execution ---
if (require.main === module) {
  main()
    .then(() => console.log("\nTranslation script run finished successfully."))
    .catch((err) => {
      console.error("\n--- TRANSLATION SCRIPT FAILED ---");
      console.error(err);
      process.exit(1);
    });
}

// --- Exports ---
module.exports = {
  main,
  processItem,
  fetchContent,
  saveToFile,
  fetchReportSlugs,
};
