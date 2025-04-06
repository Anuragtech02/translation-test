// uploadTranslations.js (Fixed Version for metaSocial issues)
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const dotenv = require("dotenv");
const glob = require("glob");
const _ = require("lodash"); // Ensure lodash is installed

dotenv.config();

// --- Configuration ---
const TRANSLATIONS_DIR = process.env.OUTPUT_DIR || "./translations";
const TARGET_URL = process.env.TARGET_URL;
const TARGET_TOKEN = process.env.TARGET_TOKEN;
const UPLOAD_DELAY_MS = parseInt(process.env.UPLOAD_DELAY_MS || "500", 10);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || "3", 10);
const RETRY_DELAY_MS = parseInt(process.env.RETRY_DELAY_MS || "2000", 10);

const LOCALIZED_FIELDS_TO_SEND = [
  "title",
  "shortDescription",
  "tableOfContent",
  "faqList",
  "faqSectionHeading",
  "description",
  "relatedReportsSectionHeading",
  "relatedReportsSectionSubheading",
  "clientsSectionHeading",
  "rightSectionHeading",
  "researchMethodology",
  "variants",
  "seo", // Keep 'seo' here, we'll build it selectively
];

const NON_TRANSLATED_SEO_FIELDS = [
  "metaRobots",
  "canonicalURL",
  "structuredData",
  "metaViewport",
  "extraScripts",
];

const TOP_LEVEL_REPEATABLE_COMPONENT_FIELDS = [
  "tableOfContent",
  "faqList",
  "variants",
];
const SINGLE_COMPONENT_FIELDS = ["seo"];

const NON_LOCALIZED_FIELDS_TO_COPY = [
  "highlightImage", // Media field
  "industry", // Relation
  "geography", // Relation
  "reportID", // Simple non-localized fields if needed
  "totalPagesCount",
  "tablesCount",
  "figuresCount",
  "status",
  "slug",
];

// --- NEW: Fields WITHIN the 'seo' component that are text and should be sent ---
const SEO_TRANSLATABLE_FIELDS = ["metaTitle", "metaDescription", "keywords"]; // --- NEW: Definition of the nested repeatable component within SEO ---
const SEO_NESTED_REPEATABLE = {
  fieldName: "metaSocial",
  translatableSubFields: ["title", "description"], // Text fields within metaSocial to send
};

// Fields to explicitly copy from SOURCE on CREATE only
const NON_LOCALIZED_FIELDS_TO_COPY_ON_CREATE = [
  "highlightImage",
  "industry",
  "geography",
  "reportID",
  "totalPagesCount",
  "tablesCount",
  "figuresCount",
  "status",
];

// Validate env vars
if (!TARGET_URL || !TARGET_TOKEN) {
  console.error("Missing TARGET_URL or TARGET_TOKEN");
  process.exit(1);
}

// Axios instance
const targetApi = axios.create({
  baseURL: TARGET_URL,
  headers: {
    Authorization: `Bearer ${TARGET_TOKEN}`,
    "Content-Type": "application/json",
  },
  timeout: 120000,
});

// Debug function to help analyze the content
function analyzeTranslationFile(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, "utf8");
    const translationData = JSON.parse(fileContent);

    console.log("\nAnalyzing translation file:", path.basename(filePath));

    if (translationData.translatedAttributes?.seo?.metaSocial) {
      const metaSocial = translationData.translatedAttributes.seo.metaSocial;
      console.log("MetaSocial entries:", metaSocial.length);

      metaSocial.forEach((entry, index) => {
        console.log(`Entry ${index + 1}:`);
        console.log(
          `  socialNetwork: "${entry.socialNetwork}" (type: ${typeof entry.socialNetwork})`,
        );
        console.log(`  title: ${entry.title ? "present" : "missing"}`);
        console.log(
          `  description: ${entry.description ? "present" : "missing"}`,
        );
        console.log(`  image: ${entry.image ? "present" : "missing"}`);
        if (entry.image && entry.image.data) {
          console.log(`    image ID: ${entry.image.data.id || "undefined"}`);
        }
      });
    } else {
      console.log("No metaSocial data found in file");
    }

    return translationData;
  } catch (error) {
    console.error(`Error analyzing file ${filePath}:`, error.message);
    return null;
  }
}

// findTranslationFiles
async function findTranslationFiles(targetLocales = []) {
  const localePatternPart =
    targetLocales.length > 0
      ? `_@(${targetLocales.join("|")}).json`
      : "_*.json";
  const pattern = path
    .join(TRANSLATIONS_DIR, "**", `*${localePatternPart}`)
    .replace(/\\/g, "/");
  console.log(`Searching for translation files using pattern: ${pattern}`);
  try {
    const files = await glob.glob(pattern, { nodir: true });
    console.log(
      `Found ${files.length} translation files for specified locales.`,
    );
    return files;
  } catch (error) {
    console.error("Error finding translation files:", error);
    return [];
  }
}

// Enhanced findExistingTranslationId function to find correct translation ID or confirm none exists
async function findExistingTranslationId(
  contentType,
  targetLocale,
  originalItemId,
) {
  try {
    // STEP 1: First check from the original content which translation ID is linked
    console.log(
      `Looking up linked translations for original content ${contentType}/${originalItemId}...`,
    );

    const originalResponse = await targetApi.get(
      `/api/${contentType}/${originalItemId}`,
      {
        params: {
          populate: ["localizations"],
        },
      },
    );

    if (originalResponse.data?.data?.attributes?.localizations?.data) {
      const linkedTranslations =
        originalResponse.data.data.attributes.localizations.data;
      console.log(
        `Found ${linkedTranslations.length} linked translations for original content`,
      );

      // Look for our target locale
      const targetTranslation = linkedTranslations.find(
        (t) => t.attributes?.locale === targetLocale,
      );

      if (targetTranslation) {
        console.log(
          `✓ Found properly linked ${targetLocale} translation with ID ${targetTranslation.id}`,
        );
        return targetTranslation.id;
      } else {
        console.log(
          `✗ No linked ${targetLocale} translation found in original content's relationships`,
        );
      }
    }

    // STEP 2: If we couldn't find the translation via relationships, do a thorough search
    console.log(`Searching for any existing ${targetLocale} translations...`);

    const params = {
      locale: targetLocale,
      filters: {
        localizations: { id: { $eq: originalItemId } },
        locale: { $eq: targetLocale },
      },
      fields: ["id", "slug", "locale", "publishedAt"],
      publicationState: "preview",
    };

    const response = await targetApi.get(`/api/${contentType}`, { params });

    if (response.data?.data?.length > 0) {
      console.log(
        `Found ${response.data.data.length} potential ${targetLocale} translations through search`,
      );

      // Log all matches for debugging
      response.data.data.forEach((item, idx) => {
        console.log(
          `  Match ${idx + 1}: ID=${item.id}, Locale=${item.attributes?.locale}, Published=${!!item.attributes?.publishedAt}`,
        );
      });

      // Try to find a published entry first
      const publishedEntry = response.data.data.find(
        (item) => item.attributes?.publishedAt,
      );
      if (publishedEntry) {
        console.log(`  Selecting published entry with ID ${publishedEntry.id}`);
        return publishedEntry.id;
      }

      // Return the first match if no published entry was found
      console.log(
        `  Selecting first available entry with ID ${response.data.data[0].id}`,
      );
      return response.data.data[0].id;
    }

    console.log(
      `✓ Confirmed no existing translations found for ${contentType} in ${targetLocale} - will create new`,
    );
    return null;
  } catch (error) {
    console.warn(
      `Warning: Error finding translation (${contentType}, ${targetLocale}, ${originalItemId}): ${error.message}`,
    );
    console.error(error);
    return null;
  }
}

// removeIdsFromComponentArrays
function removeIdsFromComponentArrays(data) {
  if (Array.isArray(data)) {
    data.forEach((item) => {
      if (item && typeof item === "object") {
        if (item.hasOwnProperty("id")) {
          delete item.id;
        }
        removeIdsFromComponentArrays(item);
      }
    });
  } else if (data && typeof data === "object") {
    for (const field of TOP_LEVEL_REPEATABLE_COMPONENT_FIELDS) {
      if (data.hasOwnProperty(field) && Array.isArray(data[field])) {
        removeIdsFromComponentArrays(data[field]);
      }
    }
    for (const field of SINGLE_COMPONENT_FIELDS) {
      if (
        data.hasOwnProperty(field) &&
        data[field] &&
        typeof data[field] === "object"
      ) {
        if (
          field === "seo" &&
          data.seo.hasOwnProperty("metaSocial") &&
          Array.isArray(data.seo.metaSocial)
        ) {
          removeIdsFromComponentArrays(data.seo.metaSocial);
        }
      }
    }
  }
}

async function fixSeoImages(contentType, itemId, targetLocale) {
  try {
    console.log(
      `Fixing SEO images for ${contentType}/${itemId} (${targetLocale})...`,
    );

    // First, get the current item with highlighting image
    const response = await targetApi.get(`/api/${contentType}/${itemId}`, {
      params: {
        populate: ["highlightImage", "seo"],
      },
    });

    const attributes = response.data?.data?.attributes;
    if (!attributes) {
      console.log(
        `  No attributes found for ${itemId}, skipping SEO image fix`,
      );
      return false;
    }

    // Check if we have a highlight image to use
    const highlightImage = attributes.highlightImage?.data;
    if (!highlightImage) {
      console.log(
        `  No highlight image found for ${itemId}, skipping SEO image fix`,
      );
      return false;
    }

    // Get current SEO data or create empty structure
    const seo = attributes.seo || {};

    // Create an updated SEO object
    const updatedSeo = {
      ...seo,
      // Set metaImage directly to the highlight image ID
      metaImage: highlightImage.id,
    };
    console.log("Updated SEO:", updatedSeo);

    // If metaSocial exists, update the image references there too
    if (Array.isArray(seo.metaSocial) && seo.metaSocial.length > 0) {
      updatedSeo.metaSocial = seo.metaSocial.map((entry) => ({
        ...entry,
        // Set image to highlight image ID
        image: highlightImage.id,
      }));
    }

    // Update the item with fixed SEO data
    console.log(`  Updating SEO with highlightImage ID: ${highlightImage.id}`);
    await targetApi.put(`/api/${contentType}/${itemId}`, {
      data: {
        seo: updatedSeo,
      },
    });

    console.log(`  ✓ Successfully updated SEO images for ${itemId}`);
    return true;
  } catch (error) {
    console.error(`  Error fixing SEO images for ${itemId}: ${error.message}`);
    return false;
  }
}

async function fixTranslationFile(filePath) {
  try {
    console.log(`Fixing image references in ${path.basename(filePath)}`);

    // Read the file
    const fileContent = fs.readFileSync(filePath, "utf8");
    const translationData = JSON.parse(fileContent);

    let modified = false;

    // Check if we have SEO data
    if (translationData.translatedAttributes?.seo) {
      const seo = translationData.translatedAttributes.seo;

      // We need to ensure the metaImage is correctly set in the file
      // Normally this is pulled from highlightImage during upload,
      // but let's make sure it's properly referenced

      // For the JSON file fix, we'll use a placeholder that will be resolved during upload
      if (!seo.metaImage) {
        seo.metaImage = {
          data: {
            // Use a placeholder ID that will be replaced during upload
            id: "HIGHLIGHT_IMAGE_ID",
          },
        };
        modified = true;
        console.log(`  Added metaImage placeholder reference`);
      }

      // Also ensure metaSocial entries have image references
      if (Array.isArray(seo.metaSocial)) {
        seo.metaSocial.forEach((entry, index) => {
          if (!entry.image) {
            entry.image = {
              data: {
                // Use a placeholder ID that will be replaced during upload
                id: "HIGHLIGHT_IMAGE_ID",
              },
            };
            modified = true;
            console.log(
              `  Added image placeholder to metaSocial entry ${index + 1}`,
            );
          }
        });
      }
    }

    // Save the modified file if changes were made
    if (modified) {
      fs.writeFileSync(filePath, JSON.stringify(translationData, null, 2));
      console.log(`  Saved updated file: ${path.basename(filePath)}`);
    } else {
      console.log(`  No image changes needed for: ${path.basename(filePath)}`);
    }

    return translationData;
  } catch (error) {
    console.error(
      `Error fixing image references in ${path.basename(filePath)}:`,
      error.message,
    );
    return null;
  }
}

// Fixed function to format metaSocial entries correctly with proper capitalization
function formatMetaSocialEntries(metaSocialArray) {
  if (!Array.isArray(metaSocialArray)) return [];

  return metaSocialArray.map((item) => {
    const newItem = {};

    // Ensure socialNetwork has the correct capitalization (Twitter/Facebook)
    if (item.socialNetwork) {
      // First convert to lowercase
      const network = item.socialNetwork.toLowerCase();
      // Then capitalize first letter
      if (network === "twitter") {
        newItem.socialNetwork = "Twitter";
      } else if (network === "facebook") {
        newItem.socialNetwork = "Facebook";
      } else {
        // Keep the original if it's not twitter or facebook
        newItem.socialNetwork = item.socialNetwork;
      }
    } else {
      // Default to Twitter if missing
      newItem.socialNetwork = "Twitter";
    }

    // Copy translatable fields
    if (item.title) newItem.title = item.title;
    if (item.description) newItem.description = item.description;

    // Don't include image in the payload - it will be handled separately
    // We'll rely on the non-localized fields copy mechanism

    return newItem;
  });
}

/**
 * Fetches specified non-localized fields from the source entry.
 */
async function fetchNonLocalizedData(contentType, originalItemId) {
  if (!originalItemId) return null;
  const fieldsToFetch = NON_LOCALIZED_FIELDS_TO_COPY;
  // For relations, we just need the ID(s) to link
  const populateParams = {};
  fieldsToFetch.forEach((field, index) => {
    // Basic populate for direct relations (adjust if nested needed)
    // For media like highlightImage, we often need the full object or just ID
    populateParams[`populate[${index}]`] = field;
  });

  try {
    console.log(
      `   Fetching non-localized data for ${contentType} ID: ${originalItemId}...`,
    );
    const response = await targetApi.get(
      `/api/${contentType}/${originalItemId}`,
      {
        params: {
          // We only need the non-localized fields themselves
          // Strapi v4 might require 'fields' param to limit, or just fetch everything and filter later
          // Let's try populating them specifically
          ...populateParams,
          // fields: fieldsToFetch // Alternative if populate doesn't work as expected
        },
      },
    );

    const attributes = response.data?.data?.attributes;
    if (!attributes) {
      console.warn(
        `   -> Could not find attributes for original item ${originalItemId}.`,
      );
      return null;
    }

    const nonLocalizedData = {};
    for (const field of fieldsToFetch) {
      if (attributes.hasOwnProperty(field)) {
        // For relations, Strapi returns { data: { id: X } } or { data: [{ id: Y }, ...] }
        // For media, it returns { data: { id: Z } } or { data: [...] }
        // We generally want to pass just the ID(s) for linking.
        const value = attributes[field];
        if (
          value &&
          typeof value === "object" &&
          value.hasOwnProperty("data")
        ) {
          // Handle single relation/media or null
          if (value.data === null) {
            nonLocalizedData[field] = null;
          } else if (Array.isArray(value.data)) {
            // Handle multi relation/media
            nonLocalizedData[field] = value.data.map((item) => item.id); // Array of IDs
          } else if (value.data && typeof value.data === "object") {
            // Handle single relation/media
            nonLocalizedData[field] = value.data.id; // Just the ID
          } else {
            nonLocalizedData[field] = value; // Use original value if structure unexpected
          }
        } else if (value !== undefined) {
          // Copy simple values directly
          nonLocalizedData[field] = value;
        }
      }
    }
    console.log(
      `   -> Fetched non-localized fields: ${Object.keys(nonLocalizedData).join(", ")}`,
    );
    return nonLocalizedData;
  } catch (error) {
    console.error(
      `   -> Error fetching non-localized data for ${originalItemId}: ${error.message}`,
    );
    return null; // Return null on error, proceed without this data
  }
}

/**
 * Pushes a single translation to Strapi (Create or Update).
 * Uses correct endpoints, removes IDs, explicitly copies non-localized fields on CREATE,
 * and includes explicit publish step + optional verification.
 */
async function pushSingleTranslation(translationData) {
  const {
    originalItemId,
    originalSlug,
    contentType,
    targetLocale,
    translatedAttributes,
  } = translationData;

  // Validate input data
  if (
    !contentType ||
    !targetLocale ||
    !originalItemId ||
    !translatedAttributes ||
    typeof translatedAttributes !== "object"
  ) {
    return {
      success: false,
      message: `Invalid data structure in JSON file (contentType: ${contentType}, locale: ${targetLocale}, originalId: ${originalItemId}).`,
    };
  }

  let attempt = 0;
  let createdOrUpdatedId = null; // To store the ID for post-actions
  let lastAction = ""; // Store the last attempted action for final error message

  // --- Main Operation Loop (Retry Logic) ---
  while (attempt < MAX_RETRIES) {
    attempt++;
    let currentAction = ""; // Action for this specific attempt

    try {
      const existingId = await findExistingTranslationId(
        contentType,
        targetLocale,
        originalItemId,
      );

      // --- First, fetch the source item to get highlightImage ---
      console.log(`   Fetching source item to get highlightImage ID...`);
      const sourceResponse = await targetApi.get(
        `/api/${contentType}/${originalItemId}`,
        {
          params: {
            populate: ["highlightImage"],
          },
        },
      );

      const highlightImageId =
        sourceResponse.data?.data?.attributes?.highlightImage?.data?.id;
      console.log(`   Source highlightImage ID: ${highlightImageId || "None"}`);

      // --- Prepare Payload Data ---
      const payloadData = {};
      console.log(`   Building payload for locale ${targetLocale}...`);

      for (const field of LOCALIZED_FIELDS_TO_SEND) {
        // Check if the field exists in the translated data and is not null/undefined
        if (
          translatedAttributes.hasOwnProperty(field) &&
          translatedAttributes[field] !== null &&
          translatedAttributes[field] !== undefined
        ) {
          // --- Special handling for SEO component ---
          if (field === "seo") {
            const translatedSeo = translatedAttributes.seo;

            const seoPayload = {}; // Start fresh for the SEO payload

            // 1. Copy only the defined translatable TEXT fields for SEO
            for (const seoField of SEO_TRANSLATABLE_FIELDS) {
              if (
                translatedSeo.hasOwnProperty(seoField) &&
                translatedSeo[seoField] !== null &&
                translatedSeo[seoField] !== undefined
              ) {
                seoPayload[seoField] = translatedSeo[seoField];
              }
            }

            // 2. Set the metaImage to the highlightImage if we have it
            if (highlightImageId) {
              seoPayload.metaImage = highlightImageId;
            }

            // add non translated SEO fields
            for (const field of NON_TRANSLATED_SEO_FIELDS) {
              // if (seoPayload.hasOwnProperty(field)) {
              //   continue;
              // }
              if (
                translatedAttributes.seo[field] !== null &&
                translatedAttributes.seo[field] !== undefined
              ) {
                seoPayload[field] = translatedAttributes.seo[field];
              }
            }

            // 3. Handle the nested metaSocial array with fixes for socialNetwork and image
            const nestedField = SEO_NESTED_REPEATABLE.fieldName; // 'metaSocial'
            if (
              translatedSeo.hasOwnProperty(nestedField) &&
              Array.isArray(translatedSeo[nestedField])
            ) {
              // Fix the metaSocial entries (ensure proper capitalization and image)
              seoPayload[nestedField] = translatedSeo[nestedField].map(
                (entry) => {
                  const newEntry = {};

                  // Ensure proper capitalization for socialNetwork
                  if (entry.socialNetwork) {
                    const network = entry.socialNetwork.toLowerCase();
                    newEntry.socialNetwork =
                      network === "twitter"
                        ? "Twitter"
                        : network === "facebook"
                          ? "Facebook"
                          : entry.socialNetwork;
                  } else {
                    newEntry.socialNetwork = "Twitter"; // Default
                  }

                  // Copy translatable fields
                  if (entry.title) newEntry.title = entry.title;
                  if (entry.description)
                    newEntry.description = entry.description;

                  // Set image to highlightImage if available
                  if (highlightImageId) {
                    newEntry.image = highlightImageId;
                  }

                  return newEntry;
                },
              );
            }

            // 4. Assign the carefully constructed seoPayload
            payloadData.seo = seoPayload;
          } else {
            // For all other fields (non-SEO)
            let attributeValue = _.cloneDeep(translatedAttributes[field]);
            // Remove top-level ID if it's a single component (though 'seo' is handled above now)
            if (
              SINGLE_COMPONENT_FIELDS.includes(field) &&
              attributeValue?.hasOwnProperty("id")
            ) {
              delete attributeValue.id;
            }
            payloadData[field] = attributeValue;
          }
        }
      } // End loop through LOCALIZED_FIELDS_TO_SEND

      // --- Remove Component Item IDs ---
      // Needs to run AFTER building the main payloadData structure
      removeIdsFromComponentArrays(payloadData);
      // ---

      let response;
      let finalPayload; // Define payload variable for logging/sending

      if (existingId) {
        // --- UPDATE Existing Localization ---
        currentAction = `UPDATE (ID: ${existingId})`;
        console.log(
          ` -> ${currentAction} ${contentType} '${originalSlug}' (${targetLocale})`,
        );
        finalPayload = { data: payloadData }; // Wrap in data for PUT
        response = await targetApi.put(
          `/api/${contentType}/${existingId}`,
          finalPayload,
        );
        createdOrUpdatedId = existingId;
      } else {
        // --- CREATE New Localization using Dedicated Endpoint ---
        currentAction = "CREATE";
        console.log(
          ` -> ${currentAction} ${contentType} '${originalSlug}' (${targetLocale}) using localization endpoint...`,
        );
        const localizationUrl = `/api/${contentType}/${originalItemId}/localizations`;
        const nonLocalizedData = await fetchNonLocalizedData(
          contentType,
          originalItemId,
        ); // Fetch non-localized

        // Build payload for POST /localizations (NOT wrapped in data, includes locale)
        finalPayload = {
          locale: targetLocale,
          ...payloadData, // Contains ONLY localized, translated data (with nested IDs removed)
          ...(nonLocalizedData || {}), // Add non-localized data (IDs for relations/media etc.)
        };

        response = await targetApi.post(localizationUrl, finalPayload);
        createdOrUpdatedId = response.data?.id || response.data?.data?.id;
        if (!createdOrUpdatedId) {
          throw new Error(
            "Failed to get ID from create localization response.",
          );
        }
      }

      // --- If PUT/POST succeeded, break retry loop ---
      console.log(
        `   -> ${currentAction} API call successful. Result ID: ${createdOrUpdatedId}.`,
      );
      lastAction = currentAction;
      break; // Exit while loop
    } catch (error) {
      lastAction = currentAction || "operation"; // Store the action that failed
      console.error(
        ` ❌ FAILED ${lastAction} ... (Attempt ${attempt}/${MAX_RETRIES}): ${error.message}`,
      );
      if (error.response) {
        console.error("   Strapi Error Status:", error.response.status);
        console.error(
          "   Strapi Error Details:",
          JSON.stringify(
            error.response.data || error.response.statusText,
            null,
            2,
          ),
        );
        if (error.response.status >= 400 && error.response.status < 500) {
          return {
            success: false,
            message: `Strapi validation/client error (Status ${error.response.status}).`,
          };
        }
      } else {
        console.error("   Error details:", error);
      }
      if (attempt < MAX_RETRIES) {
        console.log(`   Retrying in ${RETRY_DELAY_MS / 1000} seconds...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      } else {
        return {
          success: false,
          message: `Failed after ${MAX_RETRIES} attempts during ${lastAction}. Last error: ${error.message}`,
        };
      } // Use lastAction here
    }
  } // End while loop

  // --- Post-Action Steps (Only if PUT/POST succeeded and we have an ID) ---
  if (createdOrUpdatedId) {
    console.log(`   Attempting post-actions for ID: ${createdOrUpdatedId}...`);

    // First, fix SEO images explicitly
    console.log(`   -> Fixing SEO images for newly created/updated entry...`);
    await fixSeoImages(contentType, createdOrUpdatedId, targetLocale);

    // Then publish the entry
    let publishAttempt = 0;
    let published = false;
    while (publishAttempt < MAX_RETRIES && !published) {
      // Retry publishing
      publishAttempt++;
      try {
        console.log(
          `   -> Explicitly publishing ${contentType} ID: ${createdOrUpdatedId} (Attempt ${publishAttempt})...`,
        );
        await targetApi.put(`/api/${contentType}/${createdOrUpdatedId}`, {
          data: { publishedAt: new Date().toISOString() },
        });
        console.log(`     Publish request successful.`);
        published = true;
      } catch (publishError) {
        console.warn(
          `   -> Publish Attempt ${publishAttempt} failed: ${publishError.message}`,
        );
        if (
          publishError.response?.status === 400 &&
          publishError.response?.data?.error?.message?.includes(
            "already published",
          )
        ) {
          console.log("      Entry already published.");
          published = true;
        } else if (publishAttempt < MAX_RETRIES) {
          console.log(
            `     Retrying publish in ${RETRY_DELAY_MS / 1000} seconds...`,
          );
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        } else {
          console.error(
            `   -> Publishing failed permanently after ${MAX_RETRIES} attempts.`,
          );
        }
      }
    }

    // Cache Invalidation (Optional, Specific to rest-cache plugin)
    // try {
    //   console.log(
    //     `   -> Attempting cache invalidation for ${contentType}/${createdOrUpdatedId}`,
    //   );
    //   await targetApi.delete(
    //     `/api/rest-cache/invalidate/${contentType}/${createdOrUpdatedId}`,
    //   );
    //   console.log(`     Cache invalidation request sent (if plugin enabled).`);
    // } catch (cacheError) {
    //   // Only log if it's not a 404 (meaning endpoint doesn't exist = plugin not installed)
    //   if (cacheError.response?.status !== 404) {
    //     console.warn(
    //       `   -> Warning: Cache invalidation failed: ${cacheError.message}`,
    //     );
    //   } else {
    //     console.log(`     (Cache invalidation endpoint not found - skipping).`);
    //   }
    // }

    // Relationship Verification (Optional)
    try {
      console.log(`   -> Verifying relationship...`);
      const verifyResponse = await targetApi.get(
        `/api/${contentType}/${originalItemId}`,
        { params: { populate: ["localizations"] } },
      );
      const localizations =
        verifyResponse.data?.data?.attributes?.localizations?.data || [];
      const linkedLocales = localizations.map((l) => l.attributes.locale);
      console.log(
        `     Original item linked locales: ${linkedLocales.join(", ")}`,
      );
      if (!linkedLocales.includes(targetLocale)) {
        console.warn(
          `     WARNING: ${targetLocale} localization MAY NOT be linked correctly back from original!`,
        );
      } else {
        console.log(
          `     ✓ ${targetLocale} localization appears correctly linked.`,
        );
      }
    } catch (verifyError) {
      console.warn(
        `   -> Warning: Relationship verification failed: ${verifyError.message}`,
      );
    }

    return {
      success: true,
      message: `Successfully processed (${lastAction}). Strapi ID: ${createdOrUpdatedId}. Published: ${published}.`,
      id: createdOrUpdatedId,
    };
  } else {
    // This case means the main PUT/POST loop failed after all retries
    return {
      success: false,
      message: `Main ${lastAction || "operation"} failed after ${MAX_RETRIES} attempts.`,
    };
  }
}

// Add function to verify content is visible
async function verifyContentVisibility(contentType, id, targetLocale) {
  try {
    // Try to fetch the entry with both preview and live modes
    const previewParams = {
      locale: targetLocale,
      publicationState: "preview",
    };

    const liveParams = {
      locale: targetLocale,
      publicationState: "live",
    };

    const [previewResponse, liveResponse] = await Promise.all([
      targetApi.get(`/api/${contentType}/${id}`, { params: previewParams }),
      targetApi.get(`/api/${contentType}/${id}`, { params: liveParams }),
    ]);

    console.log(
      `Verification results for ${contentType}/${id} (${targetLocale}):`,
    );
    console.log(`  Available in preview: ${!!previewResponse.data?.data}`);
    console.log(`  Available as published: ${!!liveResponse.data?.data}`);

    if (!liveResponse.data?.data) {
      console.warn(
        `  WARNING: Content exists but is not published/visible in the live API.`,
      );
    }

    return {
      existsInPreview: !!previewResponse.data?.data,
      existsInLive: !!liveResponse.data?.data,
    };
  } catch (error) {
    console.warn(`  Error verifying visibility: ${error.message}`);
    return {
      existsInPreview: false,
      existsInLive: false,
      error: error.message,
    };
  }
}

// New function to preprocess all translation files before upload
async function preprocessTranslationFiles(files) {
  console.log("\n--- Preprocessing Translation Files ---");

  for (const filePath of files) {
    try {
      console.log(`\nPreprocessing ${path.basename(filePath)}`);

      // Read the file
      const fileContent = fs.readFileSync(filePath, "utf8");
      const translationData = JSON.parse(fileContent);

      let modified = false;

      // Fix metaSocial entries if they exist
      if (translationData.translatedAttributes?.seo?.metaSocial) {
        const metaSocial = translationData.translatedAttributes.seo.metaSocial;

        // Fix the socialNetwork field - ensure proper capitalization
        metaSocial.forEach((entry, index) => {
          if (entry.socialNetwork) {
            const originalValue = entry.socialNetwork;
            const network = entry.socialNetwork.toLowerCase();

            // Apply proper capitalization
            if (network === "twitter") {
              entry.socialNetwork = "Twitter";
            } else if (network === "facebook") {
              entry.socialNetwork = "Facebook";
            }

            if (originalValue !== entry.socialNetwork) {
              console.log(
                `  Fixed socialNetwork from "${originalValue}" to "${entry.socialNetwork}" in entry ${index + 1}`,
              );
              modified = true;
            }
          } else {
            // If missing, add default value based on index
            entry.socialNetwork = index === 0 ? "Twitter" : "Facebook";
            console.log(
              `  Added missing socialNetwork: "${entry.socialNetwork}" to entry ${index + 1}`,
            );
            modified = true;
          }

          // Make sure image references are added if needed
          if (!entry.image) {
            // Add a placeholder that will be fixed during upload
            entry.image = {
              data: {
                id: "HIGHLIGHT_IMAGE_ID", // Will be replaced with actual ID
              },
            };
            console.log(
              `  Added image placeholder to metaSocial entry ${index + 1}`,
            );
            modified = true;
          }
        });
      }

      // Fix metaImage if needed
      if (
        translationData.translatedAttributes?.seo &&
        !translationData.translatedAttributes.seo.metaImage
      ) {
        translationData.translatedAttributes.seo.metaImage = {
          data: {
            id: "HIGHLIGHT_IMAGE_ID", // Will be replaced with actual ID
          },
        };
        console.log(`  Added metaImage placeholder reference`);
        modified = true;
      }

      // Save the modified file if changes were made
      if (modified) {
        fs.writeFileSync(filePath, JSON.stringify(translationData, null, 2));
        console.log(`  Saved updated file: ${path.basename(filePath)}`);
      } else {
        console.log(`  No changes needed for: ${path.basename(filePath)}`);
      }
    } catch (error) {
      console.error(
        `Error preprocessing file ${path.basename(filePath)}:`,
        error.message,
      );
    }
  }

  console.log("\n--- Preprocessing Complete ---");
}

// Modify uploadMain to include preprocessing and verification
async function uploadMain() {
  const mainTimerLabel = "Total Upload Script Execution Time";
  console.time(mainTimerLabel);
  console.log("Starting Strapi Upload Process...");

  const localesToProcess = process.argv.slice(2);
  if (localesToProcess.length === 0) {
    console.warn("No specific locales provided.");
    console.timeEnd(mainTimerLabel);
    return;
  }

  console.log(`Processing uploads for locales: ${localesToProcess.join(", ")}`);
  const files = await findTranslationFiles(localesToProcess);

  if (files.length === 0) {
    console.log("No files found.");
    console.timeEnd(mainTimerLabel);
    return;
  }

  // Preprocess all translation files first
  await preprocessTranslationFiles(files);

  let successCount = 0;
  let failureCount = 0;
  const failedFiles = [];
  const successfulOperations = [];

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    console.log(
      `\nProcessing file ${i + 1}/${files.length}: ${path.basename(filePath)}`,
    );

    try {
      // First, analyze the file content to check for issues
      const translationData = analyzeTranslationFile(filePath);

      if (!translationData) {
        throw new Error("File analysis failed.");
      }

      if (
        !translationData.contentType ||
        !translationData.targetLocale ||
        !translationData.originalItemId
      ) {
        throw new Error("JSON missing required fields.");
      }

      const result = await pushSingleTranslation(translationData);

      if (result.success) {
        successCount++;
        console.log(`   ${result.message}`);

        // Store successful operation for verification
        successfulOperations.push({
          contentType: translationData.contentType,
          id: result.id,
          locale: translationData.targetLocale,
          file: path.basename(filePath),
        });
      } else {
        failureCount++;
        console.error(
          `   Upload FAILED for ${path.basename(filePath)}: ${result.message}`,
        );
        failedFiles.push({ file: filePath, reason: result.message });
      }
    } catch (error) {
      failureCount++;
      console.error(
        `   Critical error processing file ${path.basename(filePath)}: ${error.message}`,
      );
      failedFiles.push({
        file: filePath,
        reason: `Critical error: ${error.message}`,
      });
    }

    if (i < files.length - 1) {
      await new Promise((r) => setTimeout(r, UPLOAD_DELAY_MS));
    }
  }

  // Verify visibility of successful operations
  if (successfulOperations.length > 0) {
    console.log("\n--- Verifying Content Visibility ---");
    for (const op of successfulOperations) {
      if (op.id) {
        console.log(`Verifying ${op.contentType}/${op.id} (${op.locale})...`);
        await verifyContentVisibility(op.contentType, op.id, op.locale);
      }
    }
  }

  // Try to fix SEO metaSocial image links for successful operations
  // if (successfulOperations.length > 0) {
  //   console.log("\n--- Fixing SEO MetaSocial Image Links ---");
  //   for (const op of successfulOperations) {
  //     if (op.id) {
  //       try {
  //         console.log(
  //           `Checking SEO image for ${op.contentType}/${op.id} (${op.locale})...`,
  //         );

  //         // Get the original item to check for highlightImage
  //         const originalResponse = await targetApi.get(
  //           `/api/${op.contentType}/${op.id}`,
  //           {
  //             params: {
  //               populate: ["highlightImage", "seo.metaSocial.image"],
  //             },
  //           },
  //         );

  //         const attributes = originalResponse.data?.data?.attributes;
  //         if (!attributes) continue;

  //         // Check if there is a highlightImage to use
  //         const highlightImage = attributes.highlightImage?.data?.id;
  //         if (!highlightImage) {
  //           console.log(
  //             `  No highlight image found for ${op.id}, skipping SEO image fix`,
  //           );
  //           continue;
  //         }

  //         // Check if SEO metaSocial exists
  //         const metaSocial = attributes.seo?.metaSocial;
  //         if (!Array.isArray(metaSocial) || metaSocial.length === 0) {
  //           console.log(`  No metaSocial entries found for ${op.id}, skipping`);
  //           continue;
  //         }

  //         // Create update payload for fixing metaSocial images
  //         const seoPayload = {
  //           ...attributes.seo,
  //           metaSocial: metaSocial.map((entry) => ({
  //             ...entry,
  //             image: highlightImage, // Set image to highlightImage ID
  //           })),
  //         };

  //         // Update the SEO component with fixed image references
  //         console.log(
  //           `  Updating SEO metaSocial images to use highlightImage (ID: ${highlightImage})`,
  //         );
  //         const updateResponse = await targetApi.put(
  //           `/api/${op.contentType}/${op.id}`,
  //           {
  //             data: {
  //               seo: seoPayload,
  //             },
  //           },
  //         );

  //         console.log(`  ✓ Successfully updated SEO images for ${op.id}`);
  //       } catch (error) {
  //         console.error(
  //           `  Error fixing SEO images for ${op.id}: ${error.message}`,
  //         );
  //       }
  //     }
  //   }
  // }

  console.log("\n--- Upload Process Summary ---");
  console.log(`Total Files Processed: ${files.length}`);
  console.log(`Target Locales: ${localesToProcess.join(", ")}`);
  console.log(`Successful Uploads: ${successCount}`);
  console.log(`Failed Uploads: ${failureCount}`);

  if (failureCount > 0) {
    console.warn("\nFailed Files/Operations:");
    failedFiles.forEach((f) =>
      console.warn(`- ${path.basename(f.file)}: ${f.reason}`),
    );
  }

  console.timeEnd(mainTimerLabel);

  // Instructions for troubleshooting
  if (successCount > 0 && successfulOperations.some((op) => op.id)) {
    console.log("\n--- Troubleshooting Instructions ---");
    console.log("If content is still not visible in the UI, try these steps:");
    console.log("1. Clear your browser cache or try in an incognito window");
    console.log(
      "2. Check if the REST API cache needs to be cleared by visiting:",
    );
    console.log(`   ${TARGET_URL}/admin/settings/rest-cache`);
    console.log(
      "3. Verify that your admin user has permissions to view all localized content",
    );
  }

  console.log("\n--- Fix Summary ---");
  console.log(
    "1. Fixed 'socialNetwork' field in metaSocial to ensure it's lowercase (twitter/facebook)",
  );
  console.log(
    "2. Added automatic image linking to metaSocial entries using the report's highlightImage",
  );
  console.log(
    "3. Added preprocessing step to fix issues before upload attempts",
  );
}

module.exports = {
  pushSingleTranslation,
  // Export other functions if they might be useful externally, e.g.:
  findTranslationFiles,
  findExistingTranslationId,
  analyzeTranslationFile,
  preprocessTranslationFiles,
  verifyContentVisibility,
  fixSeoImages,
};

// Run main
if (require.main === module) {
  uploadMain()
    .then(() => console.log("\nUpload script finished."))
    .catch((err) => {
      console.error("\n--- UPLOAD SCRIPT FAILED ---");
      console.error(err);
      process.exit(1);
    });
}
