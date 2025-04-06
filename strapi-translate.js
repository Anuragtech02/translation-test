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

// Load environment variables (from .env file preferably)
dotenv.config();

// Configuration
const SOURCE_URL =
  process.env.SOURCE_URL || "https://web-server-india.univdatos.com"; // Your default or actual URL
const SOURCE_TOKEN = process.env.SOURCE_TOKEN; // Required: API token for source Strapi
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY; // Required: Your Google API Key
const OUTPUT_DIR = process.env.OUTPUT_DIR || "./translations"; // Output directory for JSON files
const SOURCE_LOCALE = process.env.SOURCE_LOCALE || "en"; // Define the source locale
const MAX_REPORTS = process.env.MAX_REPORTS || 50; // Maximum number of reports to fetch and translate

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
 * Processes a single content item: fetches, checks status, translates if needed, saves JSON.
 * Designed for resumeability by checking upload status.
 *
 * @param {object} item - Object containing { slug: string, id: number } of the source item.
 * @param {string} contentType - The plural API ID (e.g., 'reports').
 * @param {string[]} targetLangs - Array of target language codes.
 * @param {object} globalCache - The global translation cache object.
 */
async function processItem(item, contentType, targetLangs, globalCache) {
  let originalContent = null;
  const { slug, id: sourceItemId } = item; // Destructure source ID from item
  const timerLabel = `Processing ${contentType} '${slug}' (Source ID: ${sourceItemId})`;
  console.time(timerLabel);

  try {
    console.log(`\n=== ${timerLabel} ===`);

    // --- Step 1: Fetch Original Content ---
    // Crucial to proceed, fail fast if the source doesn't exist.
    try {
      originalContent = await fetchContent(slug, contentType);
      if (!originalContent || !originalContent.id) {
        // Fetch might return empty array, or item might lack an ID
        console.warn(
          `   Skipping: Could not fetch valid original content or ID for slug ${slug}.`,
        );
        console.timeEnd(timerLabel);
        return; // Stop processing this item
      }
      // Optional: Verify fetched ID matches input sourceItemId if needed
      if (originalContent.id !== sourceItemId) {
        console.warn(
          `   Source ID mismatch for slug ${slug}. Input: ${sourceItemId}, Fetched: ${originalContent.id}. Proceeding with fetched ID.`,
        );
      }
    } catch (fetchError) {
      console.error(
        ` ❌ FAILED to fetch original content for ${slug}. Skipping item. Error: ${fetchError.message}`,
      );
      console.timeEnd(timerLabel);
      return; // Stop processing this item if fetch fails
    }

    const originalItemId = originalContent.id; // Use the definitive ID from the fetched content

    // --- Step 2: Process Each Target Language ---
    const languageProcessingPromises = targetLangs.map(async (lang) => {
      const logPrefix = ` -> [${slug} -> ${lang}]`;

      // --- Determine Expected Output Path & Status Key ---
      const expectedOutputFileDir = path.join(OUTPUT_DIR, contentType, slug);
      const expectedOutputFilename = `${slug}_${lang}.json`;
      const expectedOutputFilePath = path.join(
        expectedOutputFileDir,
        expectedOutputFilename,
      );
      const relativePathForStatus = statusTracker.getRelativePath(
        expectedOutputFilePath,
      );

      // --- Resumeability Check: Upload Status ---
      try {
        const fileStatus = statusTracker.getFileStatus(relativePathForStatus);

        if (fileStatus.status === "completed") {
          console.log(
            `${logPrefix} Skipping: Upload previously marked as 'completed'.`,
          );
          return { lang, status: "skipped_completed" };
        } else if (fileStatus.status === "uploading") {
          // Avoid translating if an upload might be in progress (though unlikely if service restarts)
          console.log(
            `${logPrefix} Skipping: Upload potentially in progress (status: 'uploading'). Will retry later.`,
          );
          return { lang, status: "skipped_uploading" };
        }
        // If status is 'pending' or 'failed', or file is untracked, we proceed.
      } catch (statusError) {
        console.warn(
          `${logPrefix} Error checking upload status for ${relativePathForStatus}: ${statusError.message}. Proceeding with translation.`,
        );
      }

      // --- Proceed with Translation and Saving ---
      try {
        console.log(`${logPrefix} Translating...`);
        globalCache[lang] = globalCache[lang] || {}; // Ensure language cache exists
        const translator = new TranslationService(
          GOOGLE_API_KEY,
          lang,
          globalCache[lang], // Pass language-specific cache
        );

        // Translate using the fetched original content
        const translationResult = await translator.translateContent(
          originalContent, // Pass { id, attributes } object
          lang,
        );

        // Validate the result before saving
        const translatedAttributes =
          translationResult.attributes || translationResult;
        if (
          !translatedAttributes ||
          typeof translatedAttributes !== "object" ||
          Object.keys(translatedAttributes).length === 0
        ) {
          throw new Error("Translation result was empty or invalid.");
        }

        // Save the validated translated attributes
        const savedFilePath = saveToFile(
          translatedAttributes,
          lang,
          originalItemId, // Use fetched original ID
          slug,
          contentType,
        );
        console.log(
          `${logPrefix} ✓ Saved translation JSON to ${path.basename(savedFilePath)}`,
        );

        // --- Update Upload Status to Pending ---
        // Ensures the upload service knows this file is ready.
        try {
          const relativeSavedPath =
            statusTracker.getRelativePath(savedFilePath); // Should be same as relativePathForStatus
          const currentStatusInfo =
            statusTracker.getFileStatus(relativeSavedPath);
          // Update to 'pending' unless it's already definitively 'failed' or 'completed' (edge case)
          if (
            currentStatusInfo.status !== "failed" &&
            currentStatusInfo.status !== "completed"
          ) {
            statusTracker.uploadStatus.files[relativeSavedPath] = {
              ...currentStatusInfo, // Keep existing timestamps if relevant
              status: "pending",
              error: null, // Clear previous error if any
            };
            statusTracker.saveStatus();
            console.log(`${logPrefix} Updated upload status to 'pending'.`);
          } else {
            console.log(
              `${logPrefix} Keeping existing status '${currentStatusInfo.status}'.`,
            );
          }
        } catch (statusUpdateError) {
          console.warn(
            `${logPrefix} Failed to update status to pending after saving: ${statusUpdateError.message}`,
          );
        }

        return { lang, status: "success_translated" };
      } catch (langError) {
        // Catch errors specifically from translation or saving for this language
        console.error(
          `${logPrefix} ❌ FAILED translation or saving: ${langError.message}`,
        );
        console.error(langError.stack); // Log stack trace for better debugging
        // Return error status for Promise.allSettled
        return { lang, status: "error", error: langError.message };
      }
    }); // End targetLangs.map

    // --- Step 3: Wait for all languages and Summarize ---
    const results = await Promise.allSettled(languageProcessingPromises);

    console.timeEnd(timerLabel); // End timer after all promises settle

    // Log summary for the item
    let skippedCompletedCount = 0;
    let skippedUploadingCount = 0;
    let successCount = 0;
    let errorCount = 0;

    results.forEach((result) => {
      if (result.status === "fulfilled") {
        switch (result.value.status) {
          case "skipped_completed":
            skippedCompletedCount++;
            break;
          case "skipped_uploading":
            skippedUploadingCount++;
            break;
          case "success_translated":
            successCount++;
            break;
          case "error":
            errorCount++;
            break; // Error handled within the map's catch
        }
      } else {
        // Should ideally not happen if errors are caught inside the map
        console.error(
          `   -> Unexpected Promise rejection for a language of ${slug}: ${result.reason}`,
        );
        errorCount++;
      }
    });

    console.log(
      `--- Summary for ${slug}: Translated: ${successCount}, Skipped (Completed): ${skippedCompletedCount}, Skipped (Uploading): ${skippedUploadingCount}, Failed: ${errorCount} ---`,
    );
  } catch (error) {
    // Catch errors from initial setup/fetch before the language loop
    console.timeEnd(timerLabel); // Ensure timer ends even on outer error
    const itemIdForLog = originalContent ? originalContent.id : sourceItemId; // Use sourceItemId if fetch failed
    console.error(
      `❌ Top-level FAILED processing item ${contentType} / ${slug} (Source ID: ${itemIdForLog}): ${error.message}`,
    );
    console.error(error.stack);
  }
}

/**
 * Main function to fetch report slugs and translate them.
 */
async function main() {
  const globalTranslationCache = loadCache();

  let isSaving = false; // Flag to prevent double saving on exit
  const shutdownHandler = () => {
    if (!isSaving) {
      isSaving = true;
      console.log("\nShutdown signal received.");
      saveCache(globalTranslationCache); // Attempt to save cache
      process.exit(0); // Exit cleanly
    }
  };
  process.on("SIGINT", shutdownHandler); // Catch Ctrl+C
  process.on("SIGTERM", shutdownHandler); // Catch kill command

  const mainTimerLabel = "Total Script Execution Time";
  console.time(mainTimerLabel);
  console.log(`Starting translation process with auto-fetched reports...`);

  // Fetch report slugs automatically
  try {
    // Define the content type we're working with
    const contentType = "reports";

    // Fetch the slugs from Strapi
    const reportSlugs = await fetchReportSlugs(MAX_REPORTS);
    console.log(
      `\n--- Auto-fetched ${reportSlugs.length} reports from Strapi ---`,
    );
    console.log(`Target languages: ${TARGET_LANGS.join(", ")}`);

    // Process each report sequentially
    for (const reportData of reportSlugs) {
      await processItem(
        reportData, // Contains slug and id
        contentType, // "reports"
        TARGET_LANGS, // Languages to translate to
        globalTranslationCache, // Cache object
      );
    }

    console.log(`\nCompleted processing ${reportSlugs.length} reports`);
  } catch (error) {
    console.error(`Error in main process: ${error.message}`);
  }

  console.log("\nTranslation and JSON saving process completed.");
  console.timeEnd(mainTimerLabel);

  // Save cache at the end of a successful run
  if (!isSaving) {
    saveCache(globalTranslationCache);
  }
}

// Run script if directly invoked
if (require.main === module) {
  main()
    .then(() => console.log("\nScript finished successfully."))
    .catch((err) => {
      console.error("\n--- SCRIPT FAILED ---");
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
