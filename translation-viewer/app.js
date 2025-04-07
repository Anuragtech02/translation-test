// translation-viewer/app.js
const express = require("express");
const path = require("path");
const fs = require("fs"); // Need fs for directory scanning
const glob = require("glob"); // Need glob for language scanning
const db = require("../db");
const indexRoutes = require("./routes/index");

const app = express();
const port = process.env.PORT || 3000;

// Define the translations directory
const TRANSLATIONS_DIR = process.env.TRANSLATIONS_DIR || "/app/translations"; // Use absolute path

// View engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

// --- API Endpoints for Directory Scanning (Re-added) ---

// Route to get all content types based on directories
app.get("/api/content-types", (req, res) => {
  console.log(
    `[API] Request received for /api/content-types. Scanning: ${TRANSLATIONS_DIR}`,
  );
  try {
    // Check if base directory exists
    if (!fs.existsSync(TRANSLATIONS_DIR)) {
      console.warn(`[API] TRANSLATIONS_DIR not found: ${TRANSLATIONS_DIR}`);
      return res.json({ contentTypes: [] }); // Return empty if base dir not found
    }
    const contentTypeDirs = fs
      .readdirSync(TRANSLATIONS_DIR, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);
    console.log(`[API] Found content types: ${contentTypeDirs.join(", ")}`);
    res.json({ contentTypes: contentTypeDirs });
  } catch (error) {
    console.error("[API] Error reading content types:", error);
    res.status(500).json({ error: "Failed to read content types" });
  }
});

// Route to get all items (subdirectories) for a content type
app.get("/api/content/:contentType", (req, res) => {
  const { contentType } = req.params;
  const contentTypePath = path.join(TRANSLATIONS_DIR, contentType);
  console.log(
    `[API] Request received for /api/content/${contentType}. Scanning: ${contentTypePath}`,
  );

  try {
    if (!fs.existsSync(contentTypePath)) {
      console.warn(`[API] Content type path not found: ${contentTypePath}`);
      return res.status(404).json({ error: "Content type not found" });
    }

    const items = fs
      .readdirSync(contentTypePath, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);
    console.log(`[API] Found items for ${contentType}: ${items.length}`);
    res.json({ items });
  } catch (error) {
    console.error(`[API] Error reading items for ${contentType}:`, error);
    res.status(500).json({ error: "Failed to read items" });
  }
});

// Route to get all translations (JSON files) for an item
app.get("/api/translations/:contentType/:itemSlug", (req, res) => {
  const { contentType, itemSlug } = req.params;
  const itemPath = path.join(TRANSLATIONS_DIR, contentType, itemSlug);
  console.log(
    `[API] Request received for /api/translations/${contentType}/${itemSlug}. Scanning: ${itemPath}`,
  );

  try {
    if (!fs.existsSync(itemPath)) {
      console.warn(`[API] Item path not found: ${itemPath}`);
      return res.status(404).json({ error: "Item not found" });
    }

    // Find JSON files directly in the item's directory
    const files = fs
      .readdirSync(itemPath)
      .filter(
        (file) => file.endsWith(".json") && file.startsWith(itemSlug + "_"),
      ); // Ensure it's a translation file

    console.log(
      `[API] Found ${files.length} potential translation files for ${itemSlug}`,
    );
    const translations = {};
    let fileReadErrors = 0;

    files.forEach((file) => {
      // Extract locale: assumes format <slug>_<locale>.json
      const localeMatch = file.match(
        /_([a-zA-Z]{2}(?:-[a-zA-Z0-9-]+)?)\.json$/,
      );
      if (localeMatch && localeMatch[1]) {
        const locale = localeMatch[1];
        const filePath = path.join(itemPath, file);
        try {
          // Read and parse the JSON content
          const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
          translations[locale] = content; // Store parsed content by locale
        } catch (parseError) {
          console.error(
            `[API] Error parsing JSON file ${filePath}:`,
            parseError,
          );
          // Optionally store error info: translations[locale] = { error: 'Failed to parse' };
          fileReadErrors++;
        }
      } else {
        console.warn(`[API] Could not extract locale from filename: ${file}`);
      }
    });

    console.log(
      `[API] Successfully parsed ${Object.keys(translations).length} translations for ${itemSlug}. Errors: ${fileReadErrors}.`,
    );
    res.json({ translations }); // Send map of locale -> parsed JSON content
  } catch (error) {
    console.error(
      `[API] Error reading translations for ${contentType}/${itemSlug}:`,
      error,
    );
    res.status(500).json({ error: "Failed to read translations" });
  }
});

// --- Initialize Database ---
db.initializeDatabase()
  .then(() => {
    console.log("[Viewer] Database table ensured.");

    // --- Mount Page Routes (from routes/index.js) ---
    app.use("/", indexRoutes);

    // --- Basic 404 and Error Handling ---
    app.use((req, res, next) => {
      res.status(404).render("error", {
        message: "Page Not Found",
        error: { status: 404 },
      });
    });

    app.use((err, req, res, next) => {
      console.error("[Viewer] Unhandled Error:", err.stack);
      res.status(err.status || 500);
      res.render("error", {
        message: err.message || "Internal Server Error",
        error: req.app.get("env") === "development" ? err : {},
      });
    });

    // --- Start Server ---
    app.listen(port, () => {
      console.log(
        `Translation viewer app listening at http://localhost:${port}`,
      );
    });
  })
  .catch((err) => {
    console.error(
      "CRITICAL: Failed to initialize database for viewer. Exiting.",
      err,
    );
    process.exit(1);
  });

module.exports = app;
