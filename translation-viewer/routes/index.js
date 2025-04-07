// translation-viewer/routes/index.js
const express = require("express");
const router = express.Router();
const statusManager = require("../statusManager"); // Adjust path if needed

const JOBS_PER_PAGE = 50;

/* === Main Dashboard Route (DB Driven) === */
router.get("/", async (req, res, next) => {
  // ... Keep the existing DB-driven dashboard logic here ...
  // It fetches from statusManager and renders 'dashboard.ejs'
  try {
    const page = parseInt(req.query.page) || 1;
    const statusFilter = req.query.status || "all"; // Default to showing all

    const [counts, jobData] = await Promise.all([
      statusManager.getStatusCounts(),
      statusManager.getAllJobStatuses(page, JOBS_PER_PAGE, statusFilter),
    ]);

    const totalJobs = jobData.total;
    const totalPages = Math.ceil(totalJobs / JOBS_PER_PAGE);

    const viewCounts = {
      total: counts.total || 0,
      pending_translation: counts.pending_translation || 0,
      translating: counts.translating || 0,
      pending_upload: counts.pending_upload || 0,
      uploading: counts.uploading || 0,
      completed: counts.completed || 0,
      failed_translation: counts.failed_translation || 0,
      failed_upload: counts.failed_upload || 0,
      pending_any:
        (counts.pending_translation || 0) + (counts.pending_upload || 0),
      active_any: (counts.translating || 0) + (counts.uploading || 0),
      failed_any:
        (counts.failed_translation || 0) + (counts.failed_upload || 0),
    };

    const possibleStatuses = [
      "all",
      "pending_translation",
      "translating",
      "pending_upload",
      "uploading",
      "completed",
      "failed_translation",
      "failed_upload",
    ];

    res.render("dashboard", {
      title: "Translation Status Dashboard",
      counts: viewCounts,
      jobs: jobData.jobs || [],
      currentPage: page,
      totalPages: totalPages,
      currentFilter: statusFilter,
      possibleStatuses: possibleStatuses,
      lastUpdated: new Date(),
    });
  } catch (err) {
    console.error("Error fetching dashboard data:", err);
    next(err);
  }
});

/* === Routes for Browsing Generated Files (Directory Scanning) === */

// Route to display the list of items for a specific content type
// This relies on the '/api/content/:contentType' endpoint being available in app.js
router.get("/content/:contentType", (req, res) => {
  // Simply render the view; the client-side JS in the EJS file will fetch data
  res.render("content-type", {
    title: `${req.params.contentType} Items`,
    contentType: req.params.contentType,
  });
});

// Route to display the details and translations for a specific item
// This relies on the '/api/translations/:contentType/:itemSlug' endpoint
router.get("/content/:contentType/:itemSlug", (req, res) => {
  // Simply render the view; the client-side JS will fetch data
  res.render("item", {
    title: `${req.params.itemSlug} Translations`,
    contentType: req.params.contentType,
    itemSlug: req.params.itemSlug,
  });
});

module.exports = router;
