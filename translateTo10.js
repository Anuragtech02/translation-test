/**
 * Strapi Content Translation Script
 *
 * This script:
 * 1. Fetches content from production Strapi
 * 2. Translates content to target languages
 * 3. Saves translations to JSON files
 */

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const dotenv = require("dotenv");
const { TranslationService } = require("./trans_pipeline");

// Load environment variables
dotenv.config();

// Configuration
const SOURCE_URL =
  process.env.SOURCE_URL || "https://web-server-india.univdatos.com/api";
const SOURCE_TOKEN = process.env.SOURCE_TOKEN;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const OUTPUT_DIR = process.env.OUTPUT_DIR || "./translations";

// Create output directory if it doesn't exist
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Create HTTP client for source Strapi
const sourceApi = axios.create({
  baseURL: SOURCE_URL,
  headers: {
    Authorization: `Bearer ${SOURCE_TOKEN}`,
    "Content-Type": "application/json",
  },
});

const buildPopulateQuery = (fields) => {
  if (!fields || fields.length === 0) {
    return "";
  }

  // Convert the array into a string format that Strapi expects for populate
  const populateString = fields
    .map((field, i) => `populate[${i}]=${field}`)
    .join("&");

  return populateString;
};

/**
 * Fetch content from source Strapi by slug with full population
 * @param {string} slug Content slug
 * @returns {Promise<Object>} Content data
 */
async function fetchContent(slug) {
  const populateQuery = buildPopulateQuery([
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
    "variants.price.amount",
  ]);
  try {
    console.log(`Fetching content for: ${slug}`);
    // Use populate=deep to get all related content
    //       const filterQuery = `?filters[slug][$eq]=${slug}`;

    const filterQuery = `?filters[slug][$eq]=${slug}`;
    const response = await sourceApi.get(
      "/reports" + filterQuery + "&" + populateQuery,
    );

    if (!response.data?.data?.length) {
      throw new Error(`No content found for slug: ${slug}`);
    }

    console.log(`Successfully fetched content for ${slug}`);
    return response.data.data[0];
  } catch (error) {
    console.error(`Error fetching content: ${error.message}`);
    throw error;
  }
}

/**
 * Save translated content to JSON file
 * @param {Object} data Translated content
 * @param {string} slug Content slug
 * @param {string} lang Target language
 * @returns {string} Path to saved file
 */
function saveToFile(data, slug, lang) {
  const outputDir = path.join(OUTPUT_DIR, slug);

  // Create directory for this report if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const filename = `${slug}_${lang}.json`;
  const filePath = path.join(outputDir, filename);

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`✓ Saved to: ${filePath}`);

  return filePath;
}

/**
 * Process a single content item
 * @param {Object} item Item with slug and targetLangs
 */
async function processItem(item) {
  try {
    const { slug, targetLangs } = item;
    console.log(`\n=== Processing: ${slug} ===`);

    // Fetch original content
    const content = await fetchContent(slug);

    // Process each target language
    for (const lang of targetLangs) {
      try {
        console.log(`\nTranslating to ${lang}...`);

        // Initialize translation service for this language
        const translator = new TranslationService(GOOGLE_API_KEY, lang);

        // Translate content
        console.log(`Starting translation process for ${slug} to ${lang}`);
        const translated = await translator.translateContent(content);
        console.log(`Translation completed for ${slug} to ${lang}`);

        // Save to file
        saveToFile(translated, slug, lang);

        console.log(`✓ Completed: ${slug} (${lang})`);
      } catch (langError) {
        console.error(`Failed translation to ${lang}: ${langError.message}`);
      }
    }
  } catch (error) {
    console.error(`Failed to process ${item.slug}: ${error.message}`);
  }
}

/**
 * Main function to process all items
 * @param {Array<Object>} items Items to process
 */
async function main(items) {
  console.log(`Starting translation process for ${items.length} items`);

  // Process items sequentially to avoid overwhelming the API
  for (const item of items) {
    await processItem(item);
  }

  console.log("\nTranslation process completed");
}

// Run script if directly invoked
if (require.main === module) {
  // Sample input or read from command line args
  const items = [
    // {
    //   slug: "global-air-suspension-market",
    //   targetLangs: ["es", "ar"],
    // },
    {
      slug: "leap-engine-market",
      targetLangs: [
        "ru",
        "ar",
        "de",
        "fr",
        "zh-TW",
        "ja",
        "ko",
        "vi",
        "it",
        "pl",
        "zh-CN",
        "es",
      ],
    },
  ];

  main(items)
    .then(() => console.log("Script completed successfully"))
    .catch((err) => console.error("Script failed:", err));
}

module.exports = {
  processItem,
  main,
  fetchContent,
  saveToFile,
};
