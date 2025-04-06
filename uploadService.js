/**
 * Modified Upload Service
 *
 * This file is a wrapper around the original uploadTranslations.js
 * that adds tracking of upload status.
 */

const fs = require("fs");
const path = require("path");
const glob = require("glob");
const { promisify } = require("util");
const UploadStatusTracker = require("./uploadStatusTracker");

// Import the original upload module
const originalUploader = require("./uploadTranslations");

// Create a status tracker
const statusTracker = new UploadStatusTracker();

// Override the pushSingleTranslation function to track status
const originalPushSingleTranslation = originalUploader.pushSingleTranslation;

originalUploader.pushSingleTranslation = async function (translationData) {
  const { originalSlug, contentType, targetLocale } = translationData;
  const filePath = path.join(
    process.env.OUTPUT_DIR || "./translations",
    contentType,
    originalSlug,
    `${originalSlug}_${targetLocale}.json`,
  );

  try {
    // Mark upload as started
    statusTracker.startUpload(filePath);

    // Call the original upload function
    const result = await originalPushSingleTranslation(translationData);

    // Mark upload as completed with the result
    if (result.success) {
      statusTracker.completeUpload(filePath, true);
    } else {
      statusTracker.completeUpload(filePath, false, result.message);
    }

    return result;
  } catch (error) {
    // Mark upload as failed if an exception occurred
    statusTracker.completeUpload(filePath, false, error.message);
    throw error;
  }
};

// Add a periodic scan of the translations directory
const scanTranslationsDirectory = () => {
  const translationsDir = process.env.OUTPUT_DIR || "./translations";
  statusTracker.scanTranslationsDirectory(translationsDir);

  // Schedule next scan
  setTimeout(scanTranslationsDirectory, 60000); // Scan every minute
};

// Start scanning
scanTranslationsDirectory();

// Add a new method to get the status
originalUploader.getUploadStatus = () => {
  return statusTracker.getStatus();
};

originalUploader.getUploadStats = () => {
  return statusTracker.getStats();
};

module.exports = originalUploader;
