// statusManager.js
const { query } = require("./db");

// Possible Status values:
// 'pending_translation', 'translating', 'pending_upload',
// 'uploading', 'completed', 'failed_translation', 'failed_upload'

/**
 * Creates initial entries for slugs/languages if they don't exist, processing in batches.
 */
async function initializeJobs(items, targetLangs, contentType) {
  if (
    !items ||
    items.length === 0 ||
    !targetLangs ||
    targetLangs.length === 0
  ) {
    console.log(
      "[StatusManager] No items or target languages provided for job initialization.",
    );
    return;
  }

  console.log(
    `[StatusManager] Initializing/Verifying jobs for ${items.length} items and ${targetLangs.length} languages...`,
  );

  const BATCH_SIZE = 500; // Number of ROWS to insert per batch (adjust as needed, 500-1000 is usually safe)
  let totalInsertedCount = 0;
  let batchNumber = 0;

  // Prepare all potential jobs first
  const allPotentialJobs = [];
  items.forEach((item) => {
    if (item.slug && item.id) {
      // Ensure item is valid
      targetLangs.forEach((lang) => {
        allPotentialJobs.push({
          slug: item.slug,
          contentType: contentType,
          language: lang,
          source_item_id: item.id,
        });
      });
    } else {
      console.warn(
        `[StatusManager Init] Skipping item due to missing slug or id:`,
        item,
      );
    }
  });

  if (allPotentialJobs.length === 0) {
    console.log(
      "[StatusManager Init] No valid jobs to initialize after filtering.",
    );
    return;
  }

  console.log(
    `[StatusManager Init] Total potential job entries to process: ${allPotentialJobs.length}`,
  );

  // Process in batches
  for (let i = 0; i < allPotentialJobs.length; i += BATCH_SIZE) {
    const batch = allPotentialJobs.slice(i, i + BATCH_SIZE);
    batchNumber++;
    console.log(
      `[StatusManager Init] Processing Batch ${batchNumber}, Size: ${batch.length}`,
    );

    const values = [];
    const placeholders = [];
    let counter = 1; // Reset parameter counter for each batch

    batch.forEach((job) => {
      placeholders.push(
        `($${counter++}, $${counter++}, $${counter++}, $${counter++})`,
      );
      values.push(job.slug, job.contentType, job.language, job.source_item_id);
    });

    if (placeholders.length === 0) {
      console.log(
        `[StatusManager Init] Batch ${batchNumber} is empty. Skipping.`,
      );
      continue;
    }

    const insertQuery = `
      INSERT INTO translation_jobs (slug, content_type, language, source_item_id)
      VALUES ${placeholders.join(", ")}
      ON CONFLICT (slug, content_type, language) DO NOTHING;
    `;

    try {
      // Ensure parameters are passed correctly for THIS batch
      const result = await query(insertQuery, values);
      const insertedInBatch = result.rowCount || 0; // rowCount tells how many rows were actually inserted (not ignored by ON CONFLICT)
      totalInsertedCount += insertedInBatch;
      console.log(
        `[StatusManager Init] Batch ${batchNumber} complete. ${insertedInBatch} new jobs added.`,
      );
    } catch (error) {
      console.error(
        `[StatusManager Init] Error processing Batch ${batchNumber}:`,
        error,
      );
      // Decide how to handle batch errors: continue or stop? Let's continue for now.
    }
  } // End for loop

  console.log(
    `[StatusManager] Job initialization finished. Total new jobs added across all batches: ${totalInsertedCount}.`,
  );
}

/**
 * Get the status of a specific job.
 */
async function getJobStatus(slug, contentType, language) {
  const selectQuery = `
    SELECT status, last_error, target_item_id, translation_file_path
    FROM translation_jobs
    WHERE slug = $1 AND content_type = $2 AND language = $3;
  `;
  try {
    const result = await query(selectQuery, [slug, contentType, language]);
    return result.rows[0] || null; // Return the row data or null if not found
  } catch (error) {
    console.error(
      `[StatusManager] Error getting status for ${slug}/${contentType}/${language}:`,
      error,
    );
    return null; // Return null on error to avoid breaking caller
  }
}

/**
 * Update the status (and optionally error, targetId, filePath) of a job.
 */
async function updateJobStatus(
  slug,
  contentType,
  language,
  status,
  options = {},
) {
  const { error, targetItemId, translationFilePath } = options;
  const updates = ["status = $4", "updated_at = NOW()"]; // Always update status and updated_at
  const values = [slug, contentType, language, status];
  let placeholderIndex = 5;

  if (error !== undefined) {
    // Check explicitly for undefined, as null might be valid to clear error
    updates.push(`last_error = $${placeholderIndex++}`);
    values.push(error ? String(error) : null); // Store error as string or null
  }
  if (targetItemId !== undefined) {
    updates.push(`target_item_id = $${placeholderIndex++}`);
    values.push(targetItemId);
  }
  if (translationFilePath !== undefined) {
    updates.push(`translation_file_path = $${placeholderIndex++}`);
    values.push(translationFilePath);
  }

  const updateQuery = `
    UPDATE translation_jobs
    SET ${updates.join(", ")}
    WHERE slug = $1 AND content_type = $2 AND language = $3;
  `;

  try {
    const result = await query(updateQuery, values);
    if (result.rowCount === 0) {
      console.warn(
        `[StatusManager] Attempted to update status for non-existent job: ${slug}/${contentType}/${language}`,
      );
    } else {
      // console.log(`[StatusManager] Updated status for ${slug}/${contentType}/${language} to ${status}`);
    }
    return result.rowCount > 0;
  } catch (error) {
    console.error(
      `[StatusManager] Error updating status for ${slug}/${contentType}/${language} to ${status}:`,
      error,
    );
    return false;
  }
}

/**
 * Find jobs needing translation.
 */
async function getPendingTranslationJobs(limit = 50) {
  const selectQuery = `
     SELECT
       slug,
       content_type,
       language,
       source_item_id
     FROM translation_jobs
     WHERE status = 'pending_translation' OR status = 'failed_translation'
     ORDER BY updated_at ASC
     LIMIT $1;
   `;
  try {
    const result = await query(selectQuery, [limit]);
    // Now returns array of { slug, content_type, language, source_item_id }
    return result.rows;
  } catch (error) {
    console.error(
      "[StatusManager] Error getting pending translation jobs:",
      error,
    );
    return [];
  }
}

/**
 * Find jobs needing upload.
 */
async function getPendingUploadJobs(limit = 50) {
  const selectQuery = `
    SELECT slug, content_type, language, source_item_id, translation_file_path
    FROM translation_jobs
    WHERE (status = 'pending_upload' OR status = 'failed_upload')
      AND translation_file_path IS NOT NULL
    ORDER BY updated_at ASC -- Process older ones first
    LIMIT $1;
  `;
  try {
    const result = await query(selectQuery, [limit]);
    // We need the file path for the upload service
    return result.rows; // Returns array of { slug, contentType, language, source_item_id, translation_file_path }
  } catch (error) {
    console.error("[StatusManager] Error getting pending upload jobs:", error);
    return [];
  }
}

// --- Add functions for viewer ---
// statusManager.js -> getAllJobStatuses function
async function getAllJobStatuses(page = 1, limit = 50, filterStatus = null) {
  const offset = (page - 1) * limit;
  let whereClause = "";
  let whereClauseForCount = ""; // Separate clause for count query parameter index
  const dataValues = [limit, offset];
  const countValues = []; // Separate values array for count query

  if (filterStatus && filterStatus !== "all") {
    whereClause = "WHERE status = $3"; // Data query uses $3
    whereClauseForCount = "WHERE status = $1"; // Count query uses $1
    dataValues.push(filterStatus);
    countValues.push(filterStatus); // Add filter to count values
  }

  const selectDataQuery = `
        SELECT slug, content_type, language, status, last_error, updated_at, source_item_id, target_item_id
        FROM translation_jobs
        ${whereClause}
        ORDER BY updated_at DESC
        LIMIT $1 OFFSET $2;
    `;
  // Count query uses its own where clause with $1 if needed
  const countQuery = `SELECT COUNT(*) FROM translation_jobs ${whereClauseForCount};`;

  try {
    // Pass the correct parameter arrays to each query
    const [dataResult, countResult] = await Promise.all([
      query(selectDataQuery, dataValues),
      query(countQuery, countValues), // Use countValues here
    ]);
    return {
      jobs: dataResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
    };
  } catch (error) {
    console.error("[StatusManager] Error getting all job statuses:", error);
    return { jobs: [], total: 0 };
  }
}

async function getStatusCounts() {
  const selectQuery = `
        SELECT status, COUNT(*) as count
        FROM translation_jobs
        GROUP BY status;
   `;
  try {
    const result = await query(selectQuery);
    const counts = {
      total: 0,
      pending_translation: 0,
      translating: 0,
      pending_upload: 0,
      uploading: 0,
      completed: 0,
      failed_translation: 0,
      failed_upload: 0,
    };
    result.rows.forEach((row) => {
      if (counts.hasOwnProperty(row.status)) {
        counts[row.status] = parseInt(row.count, 10);
      }
      counts.total += parseInt(row.count, 10);
    });
    // Remap for viewer if needed (e.g., pending = pending_translation + pending_upload)
    counts.pending = counts.pending_translation + counts.pending_upload;
    counts.failed = counts.failed_translation + counts.failed_upload;

    return counts;
  } catch (error) {
    console.error("[StatusManager] Error getting status counts:", error);
    return {};
  }
}

module.exports = {
  initializeJobs,
  getJobStatus,
  updateJobStatus,
  getPendingTranslationJobs,
  getPendingUploadJobs,
  getAllJobStatuses, // For viewer
  getStatusCounts, // For viewer
};
