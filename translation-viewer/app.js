const express = require("express");
const fs = require("fs");
const path = require("path");
const glob = require("glob");

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Set the view engine to EJS and set the views directory correctly
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Define the translations directory
const TRANSLATIONS_DIR = process.env.TRANSLATIONS_DIR || "./translations";

// Create upload status routes
const uploadStatusRoutes = express.Router();

// Path to the upload status file
const uploadStatusPath = path.resolve(process.cwd(), "upload-status.json");

// Get the upload status
uploadStatusRoutes.get("/", (req, res) => {
  try {
    if (fs.existsSync(uploadStatusPath)) {
      const statusData = fs.readFileSync(uploadStatusPath, "utf8");
      const status = JSON.parse(statusData);

      res.json({ status });
    } else {
      res.json({
        status: {
          lastUpdated: null,
          currentlyUploading: null,
          files: {},
        },
      });
    }
  } catch (error) {
    console.error("Error reading upload status:", error);
    res.status(500).json({ error: "Failed to read upload status" });
  }
});

// Get summary statistics about uploads
uploadStatusRoutes.get("/stats", (req, res) => {
  try {
    if (fs.existsSync(uploadStatusPath)) {
      const statusData = fs.readFileSync(uploadStatusPath, "utf8");
      const status = JSON.parse(statusData);

      const files = Object.values(status.files || {});
      const stats = {
        total: files.length,
        completed: files.filter((f) => f.status === "completed").length,
        failed: files.filter((f) => f.status === "failed").length,
        uploading: files.filter((f) => f.status === "uploading").length,
        pending: files.filter((f) => !f.status || f.status === "pending")
          .length,
        currentlyUploading: status.currentlyUploading,
        lastUpdated: status.lastUpdated,
      };

      res.json({ stats });
    } else {
      res.json({
        stats: {
          total: 0,
          completed: 0,
          failed: 0,
          uploading: 0,
          pending: 0,
          currentlyUploading: null,
          lastUpdated: null,
        },
      });
    }
  } catch (error) {
    console.error("Error reading upload stats:", error);
    res.status(500).json({ error: "Failed to read upload stats" });
  }
});

// Get the status of a specific file
uploadStatusRoutes.get("/file/:contentType/:itemSlug/:locale", (req, res) => {
  try {
    const { contentType, itemSlug, locale } = req.params;
    const filePath = path.join(
      "translations",
      contentType,
      itemSlug,
      `${itemSlug}_${locale}.json`,
    );

    if (fs.existsSync(uploadStatusPath)) {
      const statusData = fs.readFileSync(uploadStatusPath, "utf8");
      const status = JSON.parse(statusData);

      const fileStatus = status.files[filePath] || { status: "unknown" };
      res.json({ fileStatus });
    } else {
      res.json({ fileStatus: { status: "unknown" } });
    }
  } catch (error) {
    console.error("Error reading file status:", error);
    res.status(500).json({ error: "Failed to read file status" });
  }
});

// Use routes
app.use("/api/upload-status", uploadStatusRoutes);

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
    const files = glob.glob(path.join(TRANSLATIONS_DIR, "**", "*.json"));
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
        try {
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
        } catch (itemErr) {
          console.error(`Error processing item ${item}:`, itemErr);
        }
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

// Upload status dashboard route
app.get("/upload-status", (req, res) => {
  res.render("upload-status");
});

// Create an empty upload-status.json file if it doesn't exist
if (!fs.existsSync(uploadStatusPath)) {
  const emptyStatus = {
    lastUpdated: new Date().toISOString(),
    currentlyUploading: null,
    files: {},
  };
  try {
    fs.writeFileSync(
      uploadStatusPath,
      JSON.stringify(emptyStatus, null, 2),
      "utf8",
    );
    console.log(`Created empty upload-status.json file at ${uploadStatusPath}`);
  } catch (err) {
    console.error("Failed to create upload-status.json file:", err);
  }
}

// Start the server
app.listen(port, () => {
  console.log(`Translation viewer app listening at http://localhost:${port}`);
  console.log(`Views directory set to: ${path.join(__dirname, "views")}`);
  console.log(`Translations directory: ${TRANSLATIONS_DIR}`);
});
