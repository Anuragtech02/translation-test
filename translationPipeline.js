// translationPipeline.js (FINAL Version - JSON Mode, Cache, Alt Tags, SEO w/ metaSocial title reuse, Ignored CTAs, Canonical URL)
const { JSDOM } = require("jsdom");
const _ = require("lodash");
const crypto = require("crypto");
const { URL } = require("url"); // Import URL class

// Helper function to generate a consistent hash for complex content
function generateContentHash(content) {
  // Sort object keys for consistent hashing regardless of property order
  const sortedContent = {};
  if (content && typeof content === "object") {
    Object.keys(content)
      .sort()
      .forEach((key) => {
        if (content[key] !== null && content[key] !== undefined) {
          // Only include non-null/undefined
          sortedContent[key] = content[key];
        }
      });
  }
  const stringToHash = JSON.stringify(sortedContent);
  return crypto.createHash("sha256").update(stringToHash).digest("hex");
}

class TranslationPipeline {
  constructor(languageCache) {
    // Use the language-specific cache passed from TranslationService
    this.cache = languageCache || {};
    // Ensure sub-cache objects exist
    this.cache.headings = this.cache.headings || {};
    this.cache.tocItems = this.cache.tocItems || {};
    this.cache.faqItems = this.cache.faqItems || {};
    this.cache.variantItems = this.cache.variantItems || {};
    this.cache.altTags = this.cache.altTags || {};
    this.cache.seoComponents = this.cache.seoComponents || {};
  }

  // --- Field Definitions ---
  // Simple text fields to translate
  translatableTextFields = [
    "title",
    "shortDescription",
    "faqSectionHeading", // Uses 'headings' cache
    "relatedReportsSectionHeading", // Uses 'headings' cache
    "relatedReportsSectionSubheading", // Uses 'headings' cache
    "clientsSectionHeading", // Uses 'headings' cache
    "rightSectionHeading", // Uses 'headings' cache
  ];

  // Fields containing HTML content
  translatableHtmlFields = ["description", "researchMethodology"];

  // Definitions for REPEATABLE components (arrays)
  translatableArrayFields = [
    {
      fieldName: "tableOfContent",
      cacheType: "tocItems",
      contentProps: ["title", "description"], // Fields defining uniqueness (English)
      translatableProps: [
        // Fields within the item to translate
        { name: "title", type: "text" },
        { name: "description", type: "html" },
      ],
    },
    {
      fieldName: "faqList",
      cacheType: "faqItems",
      contentProps: ["title", "description"],
      translatableProps: [
        { name: "title", type: "text" },
        { name: "description", type: "html" },
      ],
    },
    {
      fieldName: "variants",
      cacheType: "variantItems",
      contentProps: ["title", "description"], // Assumes these define uniqueness
      translatableProps: [
        { name: "title", type: "text" },
        { name: "description", type: "html" }, // Adjust type if not HTML
      ],
    },
  ];

  // Definitions for SINGLE (non-repeatable) components
  translatableSingleComponents = [
    {
      fieldName: "seo",
      cacheType: "seoComponents",
      // Define props that determine if SEO content is identical (use original English values)
      contentProps: ["metaTitle", "metaDescription", "keywords", "metaSocial"],
      translatableProps: [
        // Define which props within SEO need translation
        { name: "metaTitle", type: "text" },
        { name: "metaDescription", type: "text" },
        { name: "keywords", type: "text" },
        // Define nested metaSocial array
        {
          name: "metaSocial", // Field containing the array
          type: "nestedArray", // Special type identifier
          subProps: [
            // Properties within each metaSocial item
            { name: "title", type: "text" },
            { name: "description", type: "text" }, // Assuming plain text
          ],
        },
        // Other SEO fields (metaImage, metaRobots, etc.) are NOT listed, so won't be processed
      ],
    },
    // CTA components are intentionally omitted here as requested
  ];

  /**
   * Extracts text nodes AND image alt attributes from HTML.
   */
  async extractHtmlContent(html) {
    try {
      const wrappedHtml = `<body>${html || ""}</body>`;
      const dom = new JSDOM(wrappedHtml);
      const document = dom.window.document;
      const textNodesMap = new Map(); // nodeId -> { text, node }
      const altTagsMap = new Map(); // altId -> { text, node }
      let nodeIndex = 0;
      let imgIndex = 0;
      const textWalker = document.createTreeWalker(
        document.body,
        dom.window.NodeFilter.SHOW_TEXT,
        null,
        false,
      );
      let node;
      while ((node = textWalker.nextNode())) {
        if (
          node.textContent?.trim().length > 0 &&
          node.parentNode.tagName !== "SCRIPT" &&
          node.parentNode.tagName !== "STYLE"
        ) {
          const nodeId = `html_text_${nodeIndex++}`;
          textNodesMap.set(nodeId, {
            text: node.textContent.trim(),
            node: node,
          });
        }
      }
      const imgElements = document.querySelectorAll("img[alt]");
      imgElements.forEach((imgNode) => {
        const altText = imgNode.getAttribute("alt")?.trim();
        if (altText) {
          const altId = `html_alt_${imgIndex++}`;
          altTagsMap.set(altId, { text: altText, node: imgNode });
        }
      });
      return { dom, textNodesMap, altTagsMap };
    } catch (error) {
      console.error("Error extracting HTML content:", error);
      throw error;
    }
  }

  /**
   * Main translation function: Collects fragments, uses cache, translates remaining, reconstructs, modifies URL.
   */
  async translateContent(cmsData, translateFn, targetLocale) {
    // Added targetLocale
    console.log(
      `Starting pipeline processing for item ID: ${cmsData?.id || "N/A"}...`,
    );
    const originalAttributes = cmsData.attributes || cmsData; // Use original for hashing & comparisons
    const resultAttributes = _.cloneDeep(originalAttributes); // Work on the clone

    const fragmentsToTranslate = []; // Array: { id, text, cacheInfo? }
    const cachedTranslations = {}; // Map: { fragmentId: translatedValue }
    const htmlProcessingData = {}; // Map: { key: { dom, textNodesMap, altTagsMap } }
    let translationsFromApi = {}; // Map: { fragmentId: translatedValue } - Initialize outside 'if'

    if (!targetLocale) {
      console.error("FATAL: targetLocale not passed.");
      throw new Error("targetLocale required.");
    }

    try {
      // --- Step 1: Collect Fragments (with Caching) ---
      console.log(" -> Step 1: Collecting text fragments (with caching)...");

      // 1a: Simple Text Fields (Headings Cache)
      for (const field of this.translatableTextFields) {
        const originalText = originalAttributes[field];
        if (originalText && typeof originalText === "string") {
          const trimmedText = originalText.trim();
          const fragmentId = `field::${field}`;
          const isHeading = field.toLowerCase().includes("heading");
          const cacheType = isHeading ? "headings" : null;
          const cacheKey = isHeading ? trimmedText : null;
          if (cacheType && cacheKey && this.cache[cacheType]?.[cacheKey]) {
            cachedTranslations[fragmentId] = this.cache[cacheType][cacheKey];
            console.log(
              `    -> Cache HIT for ${cacheType}: "${cacheKey.substring(0, 30)}..."`,
            );
          } else {
            fragmentsToTranslate.push({
              id: fragmentId,
              text: trimmedText,
              cacheInfo: cacheType
                ? { type: cacheType, key: cacheKey }
                : undefined,
            });
          }
        }
      }

      // 1b: HTML Fields (Alt Tag Cache)
      for (const field of this.translatableHtmlFields) {
        const originalHtml = originalAttributes[field];
        if (originalHtml && typeof originalHtml === "string") {
          const { dom, textNodesMap, altTagsMap } =
            await this.extractHtmlContent(originalHtml);
          htmlProcessingData[field] = { dom, textNodesMap, altTagsMap };
          for (const [nodeId, { text }] of textNodesMap.entries()) {
            fragmentsToTranslate.push({
              id: `html::${field}::${nodeId}`,
              text: text,
            });
          }
          for (const [altId, { text }] of altTagsMap.entries()) {
            const cacheKey = text;
            const fragmentId = `html::${field}::${altId}`;
            if (this.cache.altTags?.[cacheKey]) {
              cachedTranslations[fragmentId] = this.cache.altTags[cacheKey];
              console.log(
                `    -> Cache HIT for altTag: "${cacheKey.substring(0, 30)}..."`,
              );
            } else {
              fragmentsToTranslate.push({
                id: fragmentId,
                text: text,
                cacheInfo: { type: "altTags", key: cacheKey },
              });
            }
          }
        }
      }

      // 1c: Repeatable Components / Arrays (Item Content Cache)
      for (const arrayDef of this.translatableArrayFields) {
        const fieldName = arrayDef.fieldName;
        const cacheType = arrayDef.cacheType;
        const originalArray = originalAttributes[fieldName];
        if (Array.isArray(originalArray) && originalArray.length > 0) {
          for (let i = 0; i < originalArray.length; i++) {
            const item = originalArray[i];
            if (!item) continue;
            const itemPrefix = `array::${fieldName}::${i}`;
            const contentToHash = {};
            arrayDef.contentProps.forEach((prop) => {
              if (item[prop]) contentToHash[prop] = item[prop];
            });
            const itemHash = generateContentHash(contentToHash);

            if (this.cache[cacheType]?.[itemHash]) {
              // Cache HIT
              const cachedItemTranslations = this.cache[cacheType][itemHash];
              console.log(
                `    -> Cache HIT for ${cacheType} item (hash ${itemHash.substring(0, 8)}...)`,
              );
              for (const propDef of arrayDef.translatableProps) {
                const propName = propDef.name;
                const idBase = `${itemPrefix}::${propName || "value"}`;
                if (cachedItemTranslations[propName || "value"]) {
                  if (propDef.type === "html") {
                    const { dom, textNodesMap, altTagsMap } =
                      await this.extractHtmlContent(item[propName]);
                    htmlProcessingData[idBase] = {
                      dom,
                      textNodesMap,
                      altTagsMap,
                    };
                  } // Store original maps
                  cachedTranslations[idBase] =
                    cachedItemTranslations[propName || "value"];
                }
              }
            } else {
              // Cache MISS
              for (const propDef of arrayDef.translatableProps) {
                const propName = propDef.name;
                const propType = propDef.type;
                const textValue = propName === null ? item : item[propName];
                const idBase = `${itemPrefix}::${propName || "value"}`;
                if (textValue && typeof textValue === "string") {
                  if (propType === "text") {
                    fragmentsToTranslate.push({
                      id: idBase,
                      text: textValue.trim(),
                      cacheInfo: {
                        type: cacheType,
                        key: itemHash,
                        prop: propName || "value",
                      },
                    });
                  } else if (propType === "html") {
                    const { dom, textNodesMap, altTagsMap } =
                      await this.extractHtmlContent(textValue);
                    const htmlDataKey = idBase;
                    htmlProcessingData[htmlDataKey] = {
                      dom,
                      textNodesMap,
                      altTagsMap,
                    };
                    for (const [nodeId, { text }] of textNodesMap.entries()) {
                      fragmentsToTranslate.push({
                        id: `${htmlDataKey}::${nodeId}`,
                        text: text,
                      });
                    }
                    for (const [
                      altId,
                      { text: altText },
                    ] of altTagsMap.entries()) {
                      const altCacheKey = altText;
                      const altFragmentId = `${htmlDataKey}::${altId}`;
                      if (this.cache.altTags?.[altCacheKey]) {
                        cachedTranslations[altFragmentId] =
                          this.cache.altTags[altCacheKey];
                        console.log(
                          `    -> Cache HIT for altTag (in array): "${altCacheKey.substring(0, 30)}..."`,
                        );
                      } else {
                        fragmentsToTranslate.push({
                          id: altFragmentId,
                          text: altText,
                          cacheInfo: { type: "altTags", key: altCacheKey },
                        });
                      }
                    }
                    // Mark HTML prop for assembly before caching
                    if (!translationsFromApi._cacheData)
                      translationsFromApi._cacheData = {};
                    if (!translationsFromApi._cacheData[itemHash])
                      translationsFromApi._cacheData[itemHash] = {
                        cacheType: cacheType,
                        translations: {},
                      };
                    translationsFromApi._cacheData[itemHash].translations[
                      propName
                    ] = { _needsAssembly: true, _idBase: htmlDataKey };
                  }
                }
              }
            }
          }
        }
      }

      // 1d: Single Components (Item Content Cache) - Handles nested metaSocial
      for (const compDef of this.translatableSingleComponents) {
        const fieldName = compDef.fieldName;
        const cacheType = compDef.cacheType;
        const componentData = originalAttributes[fieldName];
        if (componentData && typeof componentData === "object") {
          const contentToHash = {};
          compDef.contentProps.forEach((prop) => {
            if (componentData[prop]) contentToHash[prop] = componentData[prop];
          });
          const itemHash = generateContentHash(contentToHash);
          const componentPrefix = `component::${fieldName}`;

          if (this.cache[cacheType]?.[itemHash]) {
            // Cache HIT for component
            const cachedCompTranslations = this.cache[cacheType][itemHash];
            console.log(
              `    -> Cache HIT for ${cacheType} component (hash ${itemHash.substring(0, 8)}...)`,
            );
            for (const propDef of compDef.translatableProps) {
              const propName = propDef.name;
              const idBase = `${componentPrefix}::${propName}`;
              if (propDef.type === "nestedArray") {
                if (
                  cachedCompTranslations[propName] &&
                  Array.isArray(cachedCompTranslations[propName])
                ) {
                  cachedCompTranslations[propName].forEach((nestedItem, j) => {
                    propDef.subProps.forEach((subProp) => {
                      const subPropName = subProp.name;
                      const nestedFragmentId = `${idBase}::${subPropName}::${j}`;
                      if (nestedItem[subPropName]) {
                        cachedTranslations[nestedFragmentId] =
                          nestedItem[subPropName];
                      }
                    });
                  });
                }
              } else if (cachedCompTranslations[propName]) {
                cachedTranslations[idBase] = cachedCompTranslations[propName];
              }
            }
          } else {
            // Cache MISS for component
            for (const propDef of compDef.translatableProps) {
              const propName = propDef.name;
              const propType = propDef.type;
              const idBase = `${componentPrefix}::${propName}`;
              if (propType === "nestedArray") {
                const nestedArray = componentData[propName];
                if (nestedArray && Array.isArray(nestedArray)) {
                  nestedArray.forEach((nestedItem, j) => {
                    propDef.subProps.forEach((subProp) => {
                      const subPropName = subProp.name;
                      const subPropType = subProp.type;
                      const nestedTextValue = nestedItem[subPropName];
                      const nestedFragmentId = `${idBase}::${subPropName}::${j}`;
                      if (
                        nestedTextValue &&
                        typeof nestedTextValue === "string"
                      ) {
                        if (subPropType === "text") {
                          fragmentsToTranslate.push({
                            id: nestedFragmentId,
                            text: nestedTextValue.trim(),
                            cacheInfo: {
                              type: cacheType,
                              key: itemHash,
                              prop: propName,
                              index: j,
                              subProp: subPropName,
                            },
                          });
                        }
                        // Add nested HTML handling here if needed
                      }
                    });
                  });
                }
              } else {
                const textValue = componentData[propName];
                if (textValue && typeof textValue === "string") {
                  if (propType === "text") {
                    fragmentsToTranslate.push({
                      id: idBase,
                      text: textValue.trim(),
                      cacheInfo: {
                        type: cacheType,
                        key: itemHash,
                        prop: propName,
                      },
                    });
                  } else if (propType === "html") {
                    console.warn(
                      `HTML processing within component '${fieldName}.${propName}' not implemented.`,
                    );
                  }
                }
              }
            }
          }
        }
      }

      // --- Step 2: Translate Remaining Fragments ---
      if (fragmentsToTranslate.length > 0) {
        console.log(
          ` -> Step 2: Found ${Object.keys(cachedTranslations).length} cached fragments. Sending ${fragmentsToTranslate.length} fragments for translation...`,
        );
        const originalTextsArray = fragmentsToTranslate.map((f) => f.text);
        const translatedTextsArray = await translateFn(originalTextsArray);
        if (
          !Array.isArray(translatedTextsArray) ||
          translatedTextsArray.length !== fragmentsToTranslate.length
        ) {
          throw new Error(`API Fragment count mismatch`);
        }

        // Process results and update cache
        for (let i = 0; i < fragmentsToTranslate.length; i++) {
          const fragment = fragmentsToTranslate[i];
          const translatedText =
            typeof translatedTextsArray[i] === "string"
              ? translatedTextsArray[i].trim()
              : "";
          translationsFromApi[fragment.id] = translatedText;
          if (fragment.cacheInfo) {
            const { type, key, prop, index, subProp } = fragment.cacheInfo;
            if (type === "headings" || type === "altTags") {
              this.cache[type] = this.cache[type] || {};
              if (key && !this.cache[type][key]) {
                this.cache[type][key] = translatedText;
                console.log(
                  `    -> Cache SET for ${type}: "${key.substring(0, 30)}..."`,
                );
              }
            } else if (
              type === "tocItems" ||
              type === "faqItems" ||
              type === "variantItems" ||
              type === "seoComponents"
            ) {
              if (key) {
                if (!translationsFromApi._cacheData)
                  translationsFromApi._cacheData = {};
                if (!translationsFromApi._cacheData[key])
                  translationsFromApi._cacheData[key] = {
                    cacheType: type,
                    translations: {},
                  };
                if (prop && subProp !== undefined && index !== undefined) {
                  // Nested prop
                  if (!translationsFromApi._cacheData[key].translations[prop])
                    translationsFromApi._cacheData[key].translations[prop] = [];
                  while (
                    translationsFromApi._cacheData[key].translations[prop]
                      .length <= index
                  ) {
                    translationsFromApi._cacheData[key].translations[prop].push(
                      {},
                    );
                  }
                  if (
                    !translationsFromApi._cacheData[key].translations[prop][
                      index
                    ]
                  )
                    translationsFromApi._cacheData[key].translations[prop][
                      index
                    ] = {};
                  translationsFromApi._cacheData[key].translations[prop][index][
                    subProp
                  ] = translatedText;
                } else if (prop) {
                  // Simple prop
                  translationsFromApi._cacheData[key].translations[prop] =
                    translatedText;
                }
              }
            }
          }
        }
        // Finalize item/component cache
        if (translationsFromApi._cacheData) {
          for (const itemHash in translationsFromApi._cacheData) {
            const { cacheType, translations } =
              translationsFromApi._cacheData[itemHash];
            this.cache[cacheType] = this.cache[cacheType] || {};
            if (!this.cache[cacheType][itemHash]) {
              // Assemble HTML if needed
              const itemDefinition = [
                ...this.translatableArrayFields,
                ...this.translatableSingleComponents,
              ].find((def) => def.cacheType === cacheType);
              if (itemDefinition) {
                for (const propDef of itemDefinition.translatableProps) {
                  if (
                    propDef.type === "html" &&
                    translations[propDef.name]?._needsAssembly
                  ) {
                    const idBase = translations[propDef.name]._idBase;
                    if (htmlProcessingData[idBase]) {
                      const { dom, textNodesMap, altTagsMap } =
                        htmlProcessingData[idBase];
                      for (const [nodeId, { node }] of textNodesMap.entries()) {
                        const id = `${idBase}::${nodeId}`;
                        if (translationsFromApi[id])
                          node.textContent = translationsFromApi[id];
                      }
                      for (const [altId, { node }] of altTagsMap.entries()) {
                        const id = `${idBase}::${altId}`;
                        if (translationsFromApi[id])
                          node.setAttribute("alt", translationsFromApi[id]);
                      }
                      translations[propDef.name] =
                        dom.window.document.body.innerHTML;
                    } else {
                      translations[propDef.name] = "";
                    }
                  }
                  // Nested HTML assembly not implemented
                }
              }
              this.cache[cacheType][itemHash] = translations;
              console.log(
                `    -> Cache SET for ${cacheType} item/component (hash ${itemHash.substring(0, 8)}...)`,
              );
            }
          }
          delete translationsFromApi._cacheData;
        }
      } else {
        console.log(
          ` -> Step 2: All ${Object.keys(cachedTranslations).length} required fragments found in cache. Skipping API call.`,
        );
      }

      const finalTranslationsMap = {
        ...cachedTranslations,
        ...translationsFromApi,
      };

      // --- Step 3: Reconstruct Result Object ---
      console.log(" -> Step 3: Reconstructing item with translations...");
      // 3a: Text fields
      for (const field of this.translatableTextFields) {
        const id = `field::${field}`;
        if (finalTranslationsMap.hasOwnProperty(id)) {
          resultAttributes[field] = finalTranslationsMap[id];
        }
      }
      // 3b: HTML fields
      for (const field of this.translatableHtmlFields) {
        if (htmlProcessingData[field]) {
          const { dom, textNodesMap, altTagsMap } = htmlProcessingData[field];
          for (const [nodeId, { node }] of textNodesMap.entries()) {
            const id = `html::${field}::${nodeId}`;
            if (finalTranslationsMap.hasOwnProperty(id)) {
              node.textContent = finalTranslationsMap[id];
            }
          }
          for (const [altId, { node }] of altTagsMap.entries()) {
            const id = `html::${field}::${altId}`;
            if (finalTranslationsMap.hasOwnProperty(id)) {
              node.setAttribute("alt", finalTranslationsMap[id]);
            }
          }
          resultAttributes[field] = dom.window.document.body.innerHTML;
        }
      }
      // 3c: Array fields
      for (const arrayDef of this.translatableArrayFields) {
        const fieldName = arrayDef.fieldName;
        if (Array.isArray(resultAttributes[fieldName])) {
          for (let i = 0; i < resultAttributes[fieldName].length; i++) {
            const item = resultAttributes[fieldName][i];
            if (!item) continue;
            const itemPrefix = `array::${fieldName}::${i}`;
            for (const propDef of arrayDef.translatableProps) {
              const propName = propDef.name;
              const propType = propDef.type;
              const idBase = `${itemPrefix}::${propName || "value"}`;
              if (propType === "text") {
                if (finalTranslationsMap.hasOwnProperty(idBase)) {
                  if (propName === null)
                    resultAttributes[fieldName][i] =
                      finalTranslationsMap[idBase];
                  else item[propName] = finalTranslationsMap[idBase];
                }
              } else if (propType === "html") {
                const htmlDataKey = idBase;
                if (
                  finalTranslationsMap.hasOwnProperty(htmlDataKey) &&
                  !finalTranslationsMap.hasOwnProperty(
                    `${htmlDataKey}::html_text_0`,
                  )
                ) {
                  item[propName] = finalTranslationsMap[htmlDataKey];
                } // From cache
                else if (htmlProcessingData[htmlDataKey]) {
                  const { dom, textNodesMap, altTagsMap } =
                    htmlProcessingData[htmlDataKey];
                  for (const [nodeId, { node }] of textNodesMap.entries()) {
                    const id = `${htmlDataKey}::${nodeId}`;
                    if (finalTranslationsMap.hasOwnProperty(id)) {
                      node.textContent = finalTranslationsMap[id];
                    }
                  }
                  for (const [altId, { node }] of altTagsMap.entries()) {
                    const id = `${htmlDataKey}::${altId}`;
                    if (finalTranslationsMap.hasOwnProperty(id)) {
                      node.setAttribute("alt", finalTranslationsMap[id]);
                    }
                  }
                  item[propName] = dom.window.document.body.innerHTML;
                } // Reconstructed
              }
            }
          }
        }
      }
      // 3d: Single Components (Updated for Title Reuse)
      for (const compDef of this.translatableSingleComponents) {
        const fieldName = compDef.fieldName;
        const componentData = resultAttributes[fieldName];
        const originalComponentData = originalAttributes[fieldName]; // Use original for comparison
        if (
          componentData &&
          typeof componentData === "object" &&
          originalComponentData
        ) {
          const componentPrefix = `component::${fieldName}`;
          let translatedMetaTitle = null; // Store translated main meta title

          // First Pass: Handle metaTitle
          const metaTitlePropDef = compDef.translatableProps.find(
            (p) => p.name === "metaTitle",
          );
          if (metaTitlePropDef) {
            const metaTitleFragmentId = `${componentPrefix}::metaTitle`;
            if (finalTranslationsMap.hasOwnProperty(metaTitleFragmentId)) {
              translatedMetaTitle = finalTranslationsMap[metaTitleFragmentId];
              resultAttributes[fieldName].metaTitle = translatedMetaTitle;
            }
          }

          // Second Pass: Handle others, including metaSocial
          for (const propDef of compDef.translatableProps) {
            const propName = propDef.name;
            const propType = propDef.type;
            const idBase = `${componentPrefix}::${propName}`;
            if (propName === "metaTitle") {
              continue;
            } // Skip, already done

            if (propType === "nestedArray" && propName === "metaSocial") {
              const nestedResultArray = resultAttributes[fieldName][propName];
              const originalNestedArray = originalComponentData[propName];
              if (
                nestedResultArray &&
                Array.isArray(nestedResultArray) &&
                originalNestedArray &&
                Array.isArray(originalNestedArray)
              ) {
                nestedResultArray.forEach((nestedItem, j) => {
                  const originalNestedItem = originalNestedArray[j];
                  propDef.subProps.forEach((subProp) => {
                    const subPropName = subProp.name;
                    const nestedFragmentId = `${idBase}::${subPropName}::${j}`;
                    // --- Optimization Check for Title Reuse ---
                    if (
                      subPropName === "title" &&
                      translatedMetaTitle !== null &&
                      originalNestedItem?.title?.trim() &&
                      originalComponentData?.metaTitle?.trim() &&
                      originalNestedItem.title.trim() ===
                        originalComponentData.metaTitle.trim()
                    ) {
                      console.log(
                        `    -> Reusing translated metaTitle for metaSocial[${j}].title.`,
                      );
                      nestedItem[subPropName] = translatedMetaTitle; // Reuse
                    } else if (
                      finalTranslationsMap.hasOwnProperty(nestedFragmentId)
                    ) {
                      nestedItem[subPropName] =
                        finalTranslationsMap[nestedFragmentId];
                    } // Fallback
                  });
                });
              }
            } else if (propType !== "nestedArray") {
              // Handle simple properties
              if (finalTranslationsMap.hasOwnProperty(idBase)) {
                resultAttributes[fieldName][propName] =
                  finalTranslationsMap[idBase];
              }
            }
          }
        }
      }

      // --- Step 4: Post-Translation Modifications (Canonical URL) ---
      console.log(" -> Step 4: Applying post-translation modifications...");
      if (resultAttributes.seo && originalAttributes.seo?.canonicalURL) {
        const originalUrl = originalAttributes.seo.canonicalURL;
        try {
          const urlObj = new URL(originalUrl);
          let originalPath = urlObj.pathname;
          if (!originalPath.startsWith("/")) {
            originalPath = "/" + originalPath;
          }
          const newPathname = `/${targetLocale}${originalPath}`;
          const newCanonicalUrl = `${urlObj.protocol}//${urlObj.host}${newPathname}${urlObj.search}${urlObj.hash}`;
          resultAttributes.seo.canonicalURL = newCanonicalUrl;
          console.log(
            `    -> Updated canonicalURL: ${originalUrl} -> ${newCanonicalUrl}`,
          );
        } catch (urlError) {
          console.warn(
            `    -> Failed to parse/modify canonical URL '${originalUrl}': ${urlError.message}.`,
          );
          resultAttributes.seo.canonicalURL =
            resultAttributes.seo.canonicalURL || originalUrl;
        }
      } else {
        console.log("    -> Skipping canonicalURL update.");
      }

      console.log(
        ` -> Pipeline finished successfully for item ID: ${cmsData?.id || "N/A"}.`,
      );
      if (cmsData.attributes) {
        return { ..._.cloneDeep(cmsData), attributes: resultAttributes };
      } else {
        return resultAttributes;
      }
    } catch (error) {
      console.error(`Pipeline Error for item ${cmsData?.id}: ${error}`);
      throw error;
    }
  }
}

module.exports = TranslationPipeline;
