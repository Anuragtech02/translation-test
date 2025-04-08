// trans_pipeline.js (Final Version - Accepts Cache, Correct Models, Fallback)
const {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} = require("@google/generative-ai");
const TranslationPipeline = require("./translationPipeline"); // Uses updated pipeline
const _ = require("lodash");

const PRIMARY_MODEL_NAME = "gemini-2.0-flash-lite";
const FALLBACK_MODEL_NAME = "gemini-2.0-flash";

const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
];

class TranslationService {
  constructor(apiKey, targetLanguage = "es", languageCache) {
    // Accepts cache
    if (!apiKey) {
      throw new Error("Google API Key required.");
    }
    this.apiKey = apiKey;
    this.genAI = new GoogleGenerativeAI(apiKey);
    console.log(`Initializing primary model: ${PRIMARY_MODEL_NAME}`);
    this.primaryModel = this.genAI.getGenerativeModel({
      model: PRIMARY_MODEL_NAME,
      safetySettings,
    });
    this.fallbackModel = null;
    this.targetLanguage = targetLanguage;
    this.languageCache =
      languageCache && typeof languageCache === "object" ? languageCache : {};
    if (!languageCache || typeof languageCache !== "object") {
      console.warn(`Invalid cache for ${targetLanguage}.`);
    }
    this.pipeline = new TranslationPipeline(this.languageCache); // Pass cache to pipeline
    this.progress = { total: 0, current: 0, status: "idle", errors: [] };
    this.MAX_FRAGMENTS_PER_BATCH = 50;
  }

  _getFallbackModel() {
    if (!this.fallbackModel) {
      console.log(`   --> Initializing fallback model: ${FALLBACK_MODEL_NAME}`);
      this.fallbackModel = this.genAI.getGenerativeModel({
        model: FALLBACK_MODEL_NAME,
        safetySettings,
      });
    }
    return this.fallbackModel;
  }

  createJsonTranslationPrompt(subBatchFragments) {
    const numberedFragments = subBatchFragments
      .map((text, index) => `${index + 1}. ${JSON.stringify(text)}`)
      .join("\n");
    const fragmentCount = subBatchFragments.length;

    // Check if this batch contains titles or headings (likely more important for precision)
    const containsTitles = subBatchFragments.some(
      (fragment) =>
        fragment.length < 100 &&
        (fragment.includes("Market") ||
          fragment.includes("Report") ||
          fragment.includes("Analysis")),
    );

    // Extra instructions for title/heading translations
    const titleGuidance = containsTitles
      ? `\n\nSPECIAL INSTRUCTION FOR TITLES AND HEADINGS: Market report titles and product names contain precise technical terminology. Always translate these using the most specific technical term available in ${this.targetLanguage}, not general or approximate terms. Never substitute technical specificity for general concepts in titles.`
      : "";

    return `Translate the following ${fragmentCount} JSON string fragments from English to ${this.targetLanguage}.

  YOU ARE AN EXPERT TECHNICAL TRANSLATOR WORKING FOR A MAJOR CORPORATION.

  CRITICAL TRANSLATION PRINCIPLES:
  1. TECHNICAL PRECISION IS YOUR HIGHEST PRIORITY - choose the most specific technical term available in ${this.targetLanguage}, never a more generic term.
  2. When English uses a specific technical term, DO NOT substitute it with a more general concept in ${this.targetLanguage}, even if the general term might be more common.
  3. You must distinguish between general concepts and specific technical subcategories. For example, terms like "upholstery," "semiconductor," "algorithm," or "catalyst" refer to specific technical concepts, not general categories like "interior," "electronics," "process," or "material."
  4. Industry reports require terminology that technical specialists would use, not terms for general audiences.
  5. Always translate as if writing for subject matter experts who expect precise terminology.${titleGuidance}

  Your task is to return ONLY a single valid JSON array containing exactly ${fragmentCount} translated strings.
  The order of the translated strings in the array MUST match the order of the input fragments.
  Your entire response MUST start with '[' and end with ']'.
  Do NOT include any text, description, notes, apologies, summaries, or markdown formatting like \`\`\`json before or after the JSON array.
  Maintain all numbers, product codes, and special characters exactly as they appear in the original.

  Input Fragments (JSON strings):
  ${numberedFragments}

  Valid JSON Array Output Example (for 2 fragments):
  ["Translated fragment 1", "Translated fragment 2"]

  JSON Output:`;
  }

  async _attemptTranslationWithModel(
    modelInstance,
    modelName,
    batchFragments,
    attemptNumber,
  ) {
    const expectedCount = batchFragments.length;
    const prompt = this.createJsonTranslationPrompt(batchFragments);
    console.log(
      `     --> Attempt ${attemptNumber} using ${modelName} for batch of ${expectedCount}...`,
    );
    let result;

    try {
      result = await modelInstance.generateContent(prompt);
      // --- ADDED: Explicit Check for Blocked Response ---
      const blockReason = result?.response?.promptFeedback?.blockReason;
      if (blockReason) {
        const blockMessage = `API Call Blocked by Safety Filter (${modelName}). Reason: ${blockReason}.`;
        console.error(`     --> FAILED: ${blockMessage}`);
        // Optionally include safety ratings details if needed: console.error(result.response.promptFeedback?.safetyRatings);
        throw new Error(blockMessage); // Throw specific error
      }
      // --- END ADDED CHECK ---
    } catch (apiError) {
      // Catch errors during the API call itself (network, auth, or SDK-thrown blocking errors)
      console.error(
        `     --> FAILED: API call error with ${modelName} (Attempt ${attemptNumber}): ${apiError.message}`,
      );
      throw apiError; // Re-throw the original error
    }
    const responseText = result.response.text().trim();
    const jsonMatch = responseText.match(/\[.*\]/s);
    if (!jsonMatch || !jsonMatch[0]) {
      console.error(
        `     --> FAILED: Valid JSON array structure not found in response from ${modelName}. Possible partial block or formatting issue.`,
      );
      throw new Error(
        `Valid JSON array structure not found in response from ${modelName}. Raw start: "${responseText.substring(0, 100)}..."`,
      );
    }
    const potentialJson = jsonMatch[0];
    let translatedArray;
    try {
      translatedArray = JSON.parse(potentialJson);
    } catch (parseError) {
      throw new Error(
        `Failed to parse JSON from ${modelName}: ${parseError.message}. Raw extracted: "${potentialJson.substring(0, 200)}..."`,
      );
    }
    if (!Array.isArray(translatedArray)) {
      throw new Error(
        `Validation Error (${modelName}): Parsed result is not a JSON array.`,
      );
    }
    if (translatedArray.length !== expectedCount) {
      throw new Error(
        `Fragment count mismatch (${modelName}): Expected ${expectedCount}, Received ${translatedArray.length}`,
      );
    }
    console.log(
      `     --> Success with ${modelName} on attempt ${attemptNumber}.`,
    );
    return translatedArray;
  }

  async translateSingleBatch(batchFragments) {
    const maxAttemptsPerModel = 2;
    let primaryLastError; // Store last error from primary model specifically
    let lastError;
    const expectedCount = batchFragments.length;
    if (expectedCount === 0) return [];
    // Try Primary
    console.log(
      `   -> Trying primary model (${PRIMARY_MODEL_NAME}) for batch of ${expectedCount}...`,
    );
    for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt++) {
      try {
        return await this._attemptTranslationWithModel(
          this.primaryModel,
          PRIMARY_MODEL_NAME,
          batchFragments,
          attempt,
        );
      } catch (error) {
        primaryLastError = error; // Store the specific error
        // Log the specific error reason
        console.error(
          `   -> Primary Model (${PRIMARY_MODEL_NAME}) Attempt ${attempt} failed for ${this.targetLanguage}: ${error.message}`,
        );
        lastError = error;
        console.error(
          `   -> Primary Model Attempt ${attempt} failed for ${this.targetLanguage}: ${error.message}`,
        );
        if (attempt < maxAttemptsPerModel) {
          const delay = 1000 * Math.pow(2, attempt);
          console.log(
            `   -> Retrying with primary model in ${delay / 1000} seconds...`,
          );
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    // Try Fallback - Log the reason for fallback more explicitly
    console.warn(
      `   -> Primary model failed after ${maxAttemptsPerModel} attempts. Last primary error: "${primaryLastError?.message || "Unknown"}". Trying fallback model (${FALLBACK_MODEL_NAME})...`,
    );
    const fallbackModelInstance = this._getFallbackModel();
    for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt++) {
      try {
        return await this._attemptTranslationWithModel(
          fallbackModelInstance,
          FALLBACK_MODEL_NAME,
          batchFragments,
          attempt,
        );
      } catch (error) {
        fallbackLastError = error; // Store fallback error
        console.error(
          `   -> Fallback Model (${FALLBACK_MODEL_NAME}) Attempt ${attempt} failed for ${this.targetLanguage}: ${error.message}`,
        );
        if (attempt < maxAttemptsPerModel) {
          const delay = 1500 * Math.pow(2, attempt);
          console.log(
            `   -> Retrying with fallback model in ${delay / 1000} seconds...`,
          );
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    // If fallback also failed
    console.error(
      `   -> Translation FAILED PERMANENTLY for batch (both models) for ${this.targetLanguage} after ${maxAttemptsPerModel * 2} total attempts.`,
    );
    console.error(
      `      Last Primary Error: ${primaryLastError?.message || "N/A"}`,
    );
    console.error(
      `      Last Fallback Error: ${fallbackLastError?.message || "N/A"}`,
    );
    // Throw the most recent error encountered (likely from the fallback model)
    throw (
      fallbackLastError ||
      primaryLastError ||
      new Error("Translation failed after all attempts.")
    );
  }

  async translate(fragments) {
    if (!Array.isArray(fragments) || fragments.length === 0) {
      return [];
    }
    const totalFragments = fragments.length;
    console.log(
      ` -> Received ${totalFragments} fragments for translation to ${this.targetLanguage}. Max batch size: ${this.MAX_FRAGMENTS_PER_BATCH}.`,
    );
    if (totalFragments <= this.MAX_FRAGMENTS_PER_BATCH) {
      console.log(
        ` -> Translating all ${totalFragments} fragments in a single batch.`,
      );
      try {
        return await this.translateSingleBatch(fragments);
      } catch (error) {
        console.error(
          ` -> Single batch translation failed for ${this.targetLanguage}: ${error.message}`,
        );
        throw error;
      }
    } else {
      const batches = _.chunk(fragments, this.MAX_FRAGMENTS_PER_BATCH);
      console.log(` -> Splitting into ${batches.length} batches.`);
      const allTranslatedFragments = [];
      try {
        for (let i = 0; i < batches.length; i++) {
          console.log(
            ` -> Processing batch ${i + 1} of ${batches.length} for ${this.targetLanguage}...`,
          );
          const translatedBatchResult = await this.translateSingleBatch(
            batches[i],
          );
          allTranslatedFragments.push(...translatedBatchResult);
          console.log(
            ` -> Finished batch ${i + 1}. Total translated so far: ${allTranslatedFragments.length}`,
          );
        }
        if (allTranslatedFragments.length !== totalFragments) {
          throw new Error("Final fragment count mismatch.");
        }
        console.log(
          ` -> Successfully combined results from ${batches.length} batches for ${this.targetLanguage}. Total: ${allTranslatedFragments.length}`,
        );
        return allTranslatedFragments;
      } catch (error) {
        console.error(
          ` -> Error during sequential batch processing for ${this.targetLanguage}: ${error.message}`,
        );
        throw error;
      }
    }
  }

  async translateContent(cmsData, targetLocale) {
    // Added targetLocale parameter
    console.log(
      `Starting JSON-based translation process for item ID: ${cmsData?.id || "N/A"} in ${targetLocale}...`,
    );
    if (!targetLocale) {
      console.error("FATAL: targetLocale not passed to translateContent.");
      throw new Error("targetLocale is required in translateContent.");
    }
    try {
      // --- MODIFIED CALL: Pass targetLocale to pipeline ---
      const result = await this.pipeline.translateContent(
        cmsData,
        (fragmentsArray) => this.translate(fragmentsArray), // The translate function itself
        targetLocale, // The target language code
      );
      // --- END MODIFIED CALL ---
      return result;
    } catch (pipelineError) {
      console.error(
        ` -> Error during pipeline execution for ${targetLocale}: ${pipelineError.message}`,
      );
      throw pipelineError; // Re-throw
    }
  }
}

async function translateCMSContent(cmsData, apiKey, targetLanguage = "es") {
  /* ... */
} // Keep if needed

module.exports = { TranslationService, translateCMSContent };
