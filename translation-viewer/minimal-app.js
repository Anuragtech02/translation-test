/**
 * Minimal Translation Viewer App
 * This is a backup version for when the main app.js is unavailable or has issues
 */

const express = require("express");
const fs = require("fs");
const path = require("path");

// Create express app
const app = express();
const port = process.env.PORT || 3000;

// Set the views directory and view engine
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Define translations directory
const TRANSLATIONS_DIR = process.env.TRANSLATIONS_DIR || "./translations";

// Home page route
app.get("/", (req, res) => {
  res.render("index");
});

// Content type route
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

// Upload status dashboard route
app.get("/upload-status", (req, res) => {
  res.render("upload-status");
});

// Simple API to get content types
app.get("/api/content-types", (req, res) => {
  try {
    let contentTypes = [];
    if (fs.existsSync(TRANSLATIONS_DIR)) {
      contentTypes = fs
        .readdirSync(TRANSLATIONS_DIR, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name);
    }
    res.json({ contentTypes });
  } catch (error) {
    console.error("Error reading content types:", error);
    res.status(500).json({ error: "Failed to read content types" });
  }
});

// Simple API to get items for a content type
app.get("/api/content/:contentType", (req, res) => {
  const { contentType } = req.params;
  const contentTypePath = path.join(TRANSLATIONS_DIR, contentType);

  try {
    if (!fs.existsSync(contentTypePath)) {
      return res.json({ items: [] });
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

// Simple API to get translations for an item
app.get("/api/translations/:contentType/:itemSlug", (req, res) => {
  const { contentType, itemSlug } = req.params;
  const itemPath = path.join(TRANSLATIONS_DIR, contentType, itemSlug);

  try {
    if (!fs.existsSync(itemPath)) {
      return res.json({ translations: {} });
    }

    const files = fs
      .readdirSync(itemPath)
      .filter((file) => file.endsWith(".json"));

    const translations = {};

    files.forEach((file) => {
      try {
        const locale = file.split("_").pop().replace(".json", "");
        const filePath = path.join(itemPath, file);
        const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
        translations[locale] = content;
      } catch (fileError) {
        console.error(`Error reading file ${file}:`, fileError);
      }
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

// Upload status placeholders
app.get("/api/upload-status", (req, res) => {
  const emptyStatus = {
    status: {
      lastUpdated: new Date().toISOString(),
      currentlyUploading: null,
      files: {},
    },
  };
  res.json(emptyStatus);
});

app.get("/api/upload-status/stats", (req, res) => {
  const emptyStats = {
    stats: {
      total: 0,
      completed: 0,
      failed: 0,
      uploading: 0,
      pending: 0,
      currentlyUploading: null,
      lastUpdated: new Date().toISOString(),
    },
  };
  res.json(emptyStats);
});

// Start the server
app.listen(port, () => {
  console.log(`Minimal Translation Viewer running at http://localhost:${port}`);
  console.log(`Views directory: ${path.join(__dirname, "views")}`);
  console.log(`Translations directory: ${TRANSLATIONS_DIR}`);
});
