/**
 * Upload Status Tracker Module
 *
 * This module tracks the status of file uploads to Strapi
 * and provides an API for the viewer to check upload status.
 */

const fs = require("fs");
const path = require("path");

class UploadStatusTracker {
  constructor(statusFilePath) {
    this.statusFilePath = statusFilePath || "/app/upload-status.json";
    this.uploadStatus = this.loadStatus();
  }

  /**
   * Load the current status from the status file
   */
  loadStatus() {
    try {
      if (fs.existsSync(this.statusFilePath)) {
        const data = fs.readFileSync(this.statusFilePath, "utf8");
        return JSON.parse(data);
      }
    } catch (error) {
      console.error("Error loading upload status:", error);
    }

    // Default empty status
    return {
      lastUpdated: new Date().toISOString(),
      currentlyUploading: null,
      files: {},
    };
  }

  /**
   * Save the current status to the status file
   */
  saveStatus() {
    try {
      this.uploadStatus.lastUpdated = new Date().toISOString();
      const dataToSave = JSON.stringify(this.uploadStatus, null, 2);
      console.log(
        `[Tracker] Attempting to save status to ${this.statusFilePath}. Data length: ${dataToSave.length}`,
      ); // Log before write
      fs.writeFileSync(this.statusFilePath, dataToSave, "utf8");
      console.log(
        `[Tracker] Successfully saved status to ${this.statusFilePath}`,
      ); // Log after write
    } catch (error) {
      // Log the full error object
      console.error(
        `[Tracker] Error saving upload status to ${this.statusFilePath}:`,
        error,
      );
    }
  }

  /**
   * Mark a file as upload started
   * @param {string} filePath - Path to the file being uploaded
   */
  startUpload(filePath) {
    const relativePath = this.getRelativePath(filePath);
    console.log(`[Tracker] Starting upload for: ${relativePath}`); // Added log
    this.uploadStatus.currentlyUploading = relativePath;
    // Ensure the file entry exists before modifying
    if (!this.uploadStatus.files[relativePath]) {
      this.uploadStatus.files[relativePath] = {}; // Initialize if needed
    }
    this.uploadStatus.files[relativePath].status = "uploading";
    this.uploadStatus.files[relativePath].startedAt = new Date().toISOString();
    this.uploadStatus.files[relativePath].completedAt = null;
    this.uploadStatus.files[relativePath].error = null;
    console.log(
      "[Tracker] Status before saving (startUpload):",
      JSON.stringify(this.uploadStatus.files[relativePath]),
    ); // Log state
    this.saveStatus();
  }

  /**
   * Mark a file as upload completed
   * @param {string} filePath - Path to the file that was uploaded
   * @param {boolean} success - Whether the upload was successful
   * @param {string} error - Error message if the upload failed
   */
  completeUpload(filePath, success = true, error = null) {
    const relativePath = this.getRelativePath(filePath);
    console.log(
      `[Tracker] Completing upload for: ${relativePath}, Success: ${success}, Error: ${error}`,
    ); // Added log

    if (this.uploadStatus.currentlyUploading === relativePath) {
      this.uploadStatus.currentlyUploading = null;
    }

    if (!this.uploadStatus.files[relativePath]) {
      console.warn(
        `[Tracker] completeUpload called for untracked file: ${relativePath}. Initializing.`,
      );
      this.uploadStatus.files[relativePath] = {
        startedAt: new Date().toISOString(), // Or maybe null if start wasn't called?
      };
    }

    this.uploadStatus.files[relativePath].status = success
      ? "completed"
      : "failed";
    this.uploadStatus.files[relativePath].completedAt =
      new Date().toISOString();
    this.uploadStatus.files[relativePath].error = error ? String(error) : null; // Ensure error is string

    console.log(
      "[Tracker] Status before saving (completeUpload):",
      JSON.stringify(this.uploadStatus.files[relativePath]),
    ); // Log state
    this.saveStatus();
  }

  /**
   * Get the status of all uploads
   */
  getStatus() {
    return this.uploadStatus;
  }

  /**
   * Get the status of a specific file
   * @param {string} filePath - Path to the file
   */
  getFileStatus(filePath) {
    const relativePath = this.getRelativePath(filePath);
    return this.uploadStatus.files[relativePath] || { status: "pending" };
  }

  /**
   * Get the currently uploading file
   */
  getCurrentUpload() {
    return this.uploadStatus.currentlyUploading;
  }

  /**
   * Get statistics about uploads
   */
  getStats() {
    const files = Object.values(this.uploadStatus.files);
    return {
      total: files.length,
      completed: files.filter((f) => f.status === "completed").length,
      failed: files.filter((f) => f.status === "failed").length,
      uploading: files.filter((f) => f.status === "uploading").length,
      pending: files.filter((f) => f.status === "pending").length,
    };
  }

  /**
   * Convert an absolute path to a relative path
   * @param {string} filePath - Absolute path to the file
   */
  getRelativePath(filePath) {
    // Remove any common path prefix to get a consistent identifier
    return path.relative(process.cwd(), filePath);
  }

  /**
   * Scan the translations directory to identify all potential files
   * @param {string} translationsDir - Path to the translations directory
   */
  scanTranslationsDirectory(translationsDir) {
    try {
      const pendingFiles = [];

      // Recursive function to walk the directory tree
      const walkDir = (dir) => {
        const files = fs.readdirSync(dir);

        files.forEach((file) => {
          const filePath = path.join(dir, file);
          const stat = fs.statSync(filePath);

          if (stat.isDirectory()) {
            walkDir(filePath);
          } else if (file.endsWith(".json")) {
            const relativePath = this.getRelativePath(filePath);

            // If this file doesn't have a status yet, mark it as pending
            if (!this.uploadStatus.files[relativePath]) {
              this.uploadStatus.files[relativePath] = {
                status: "pending",
                startedAt: null,
                completedAt: null,
                error: null,
              };
              pendingFiles.push(relativePath);
            }
          }
        });
      };

      walkDir(translationsDir);

      if (pendingFiles.length > 0) {
        this.saveStatus();
      }

      return pendingFiles;
    } catch (error) {
      console.error("Error scanning translations directory:", error);
      return [];
    }
  }
}

module.exports = UploadStatusTracker;
