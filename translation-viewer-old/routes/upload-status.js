/**
 * Upload Status API Routes
 */

const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");

// Path to the upload status file
const uploadStatusPath = path.join(process.cwd(), "upload-status.json");

/**
 * Get the upload status
 */
router.get("/", (req, res) => {
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

/**
 * Get summary statistics about uploads
 */
router.get("/stats", (req, res) => {
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

/**
 * Get the status of a specific file
 */
router.get("/file/:contentType/:itemSlug/:locale", (req, res) => {
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

module.exports = router;
