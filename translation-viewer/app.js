const express = require("express");
const fs = require("fs");
const path = require("path");
const glob = require("glob");

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON
app.use(express.json());

// Serve static files
app.use(express.static("public"));

// Set the view engine to EJS
app.set("view engine", "ejs");

// Define the translations directory
const TRANSLATIONS_DIR = process.env.TRANSLATIONS_DIR || "./translations";

// Route to get all content types
app.get("/api/content-types", (req, res) => {
  try {
    const contentTypeDirs = fs
      .readdirSync(TRANSLATIONS_DIR, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    res.json({ contentTypes: contentTypeDirs });
  } catch (error) {
    console.error("Error reading content types:", error);
    res.status(500).json({ error: "Failed to read content types" });
  }
});

// Route to get all items for a content type
app.get("/api/content/:contentType", (req, res) => {
  const { contentType } = req.params;
  const contentTypePath = path.join(TRANSLATIONS_DIR, contentType);

  try {
    if (!fs.existsSync(contentTypePath)) {
      return res.status(404).json({ error: "Content type not found" });
    }

    const items = fs
      .readdirSync(contentTypePath, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    res.json({ items });
  } catch (error) {
    console.error(`Error reading items for ${contentType}:`, error);
    res.status(500).json({ error: "Failed to read items" });
  }
});

// Route to get all translations for an item
app.get("/api/translations/:contentType/:itemSlug", (req, res) => {
  const { contentType, itemSlug } = req.params;
  const itemPath = path.join(TRANSLATIONS_DIR, contentType, itemSlug);

  try {
    if (!fs.existsSync(itemPath)) {
      return res.status(404).json({ error: "Item not found" });
    }

    const files = fs
      .readdirSync(itemPath)
      .filter((file) => file.endsWith(".json"));

    const translations = {};

    files.forEach((file) => {
      const locale = file.split("_").pop().replace(".json", "");
      const filePath = path.join(itemPath, file);
      const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
      translations[locale] = content;
    });

    res.json({ translations });
  } catch (error) {
    console.error(
      `Error reading translations for ${contentType}/${itemSlug}:`,
      error,
    );
    res.status(500).json({ error: "Failed to read translations" });
  }
});

// Route to get all available languages
app.get("/api/languages", (req, res) => {
  try {
    const files = glob.sync(path.join(TRANSLATIONS_DIR, "**", "*.json"));
    const languages = new Set();

    files.forEach((file) => {
      const filename = path.basename(file);
      const locale = filename.split("_").pop().replace(".json", "");
      languages.add(locale);
    });

    res.json({ languages: Array.from(languages) });
  } catch (error) {
    console.error("Error reading languages:", error);
    res.status(500).json({ error: "Failed to read languages" });
  }
});

// Route to get translation stats
app.get("/api/stats", (req, res) => {
  try {
    const contentTypes = fs
      .readdirSync(TRANSLATIONS_DIR, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    const stats = {
      contentTypes: contentTypes.length,
      items: 0,
      translations: 0,
      languages: new Set(),
      byContentType: {},
    };

    contentTypes.forEach((contentType) => {
      const contentTypePath = path.join(TRANSLATIONS_DIR, contentType);
      const items = fs
        .readdirSync(contentTypePath, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name);

      stats.items += items.length;
      stats.byContentType[contentType] = {
        items: items.length,
        translations: 0,
      };

      items.forEach((item) => {
        const itemPath = path.join(contentTypePath, item);
        const files = fs
          .readdirSync(itemPath)
          .filter((file) => file.endsWith(".json"));

        stats.translations += files.length;
        stats.byContentType[contentType].translations += files.length;

        files.forEach((file) => {
          const locale = file.split("_").pop().replace(".json", "");
          stats.languages.add(locale);
        });
      });
    });

    stats.languages = Array.from(stats.languages);

    res.json({ stats });
  } catch (error) {
    console.error("Error generating stats:", error);
    res.status(500).json({ error: "Failed to generate stats" });
  }
});

// Main page route
app.get("/", (req, res) => {
  res.render("index");
});

// Content type view route
app.get("/content/:contentType", (req, res) => {
  res.render("content-type", { contentType: req.params.contentType });
});

// Item view route
app.get("/content/:contentType/:itemSlug", (req, res) => {
  res.render("item", {
    contentType: req.params.contentType,
    itemSlug: req.params.itemSlug,
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Translation viewer app listening at http://localhost:${port}`);
});
