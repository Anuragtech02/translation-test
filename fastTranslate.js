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
 * Process a single content item: fetch, translate (using cache), save JSONs.
 * Accepts the global cache object.
 */
async function processItem(item, contentType, targetLangs, globalCache) {
  let originalContent = null;
  const { slug } = item;
  const timerLabel = `Processing ${contentType} '${slug}'`;
  console.time(timerLabel);
  try {
    console.log(`\n=== Processing ${contentType}: ${slug} ===`);
    originalContent = await fetchContent(slug, contentType);
    const originalItemId = originalContent.id;
    const translationPromises = targetLangs.map(async (lang) => {
      // 'lang' is the targetLocale
      try {
        console.log(` -> Translating ${slug} to ${lang}...`);
        globalCache[lang] = globalCache[lang] || {};
        const translator = new TranslationService(
          GOOGLE_API_KEY,
          lang,
          globalCache[lang],
        );

        const translationResult = await translator.translateContent(
          originalContent,
          lang,
        );

        const translatedAttributes =
          translationResult.attributes || translationResult;
        const savedFilePath = saveToFile(
          translatedAttributes,
          lang,
          originalItemId,
          slug,
          contentType,
        );
        console.log(
          ` ✓ Saved: ${slug} (${lang}) to ${path.basename(savedFilePath)}`,
        );
        return { lang, status: "success" };
      } catch (langError) {
        console.error(
          ` ❌ FAILED translation/saving for ${slug} to ${lang}: ${langError.message}`,
        );
        return { lang, status: "error", error: langError.message };
      }
    });
    const results = await Promise.all(translationPromises);
    const errors = results.filter((r) => r.status === "error");
    console.timeEnd(timerLabel);
    console.log(
      `--- Finished processing languages for ${slug}. Success: ${results.length - errors.length}, Failed: ${errors.length} ---`,
    );
    if (errors.length > 0) {
      console.warn(
        `   Failed languages for ${slug}: ${errors.map((e) => e.lang).join(", ")}`,
      );
    }
  } catch (error) {
    console.timeEnd(timerLabel);
    const itemId = originalContent ? originalContent.id : "UNKNOWN";
    console.error(
      `❌ FAILED processing item ${contentType} / ${slug} (ID: ${itemId}): ${error.message}`,
    );
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
