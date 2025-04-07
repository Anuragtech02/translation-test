// db.js
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DATABASE_HOST || "localhost",
  port: parseInt(process.env.DATABASE_PORT || "5432", 10),
  database: process.env.DATABASE_NAME || "translation_status",
  user: process.env.DATABASE_USER || "translator",
  password: process.env.DATABASE_PASSWORD || "changeme",
  max: 10, // Max number of clients in the pool
  idleTimeoutMillis: 30000, // How long a client is allowed to remain idle before being closed
  connectionTimeoutMillis: 5000, // How long to wait for a connection attempt to succeed
});

pool.on("error", (err, client) => {
  console.error("PostgreSQL pool error:", err);
});

console.log(
  `DB Pool created for database: ${process.env.DATABASE_NAME} on ${process.env.DATABASE_HOST}`,
);

// Helper function to execute queries
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    // console.log('[DB] Executed query', { text, duration: `${duration}ms`, rows: res.rowCount }); // Optional verbose logging
    return res;
  } catch (err) {
    console.error("[DB] ERROR executing query:", { text, params });
    console.error(err.stack);
    throw err; // Re-throw the error for handling upstream
  }
}

// Function to create the table if it doesn't exist
async function initializeDatabase() {
  console.log('[DB] Initializing database table "translation_jobs"...');
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS translation_jobs (
      id SERIAL PRIMARY KEY,
      slug VARCHAR(255) NOT NULL,
      content_type VARCHAR(100) NOT NULL,
      language VARCHAR(20) NOT NULL,
      source_item_id INTEGER,
      target_item_id INTEGER,
      status VARCHAR(50) NOT NULL DEFAULT 'pending_translation', -- e.g., pending_translation, translating, pending_upload, uploading, completed, failed_translation, failed_upload
      last_error TEXT,
      translation_file_path VARCHAR(1024),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(slug, content_type, language) -- Ensure only one entry per item/language
    );
  `;
  const createUpdatedAtFunctionQuery = `
    CREATE OR REPLACE FUNCTION trigger_set_timestamp()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `;
  const createTriggerQuery = `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_timestamp_trigger') THEN
        CREATE TRIGGER set_timestamp_trigger
        BEFORE UPDATE ON translation_jobs
        FOR EACH ROW
        EXECUTE FUNCTION trigger_set_timestamp();
      END IF;
    END
    $$;
  `;

  try {
    await query(createTableQuery);
    await query(createUpdatedAtFunctionQuery);
    await query(createTriggerQuery);
    console.log('[DB] Table "translation_jobs" ensured and trigger set.');
  } catch (err) {
    console.error("[DB] Failed to initialize database table:", err);
    // Consider exiting if DB init fails critically
    process.exit(1);
  }
}

/** Check if a specific migration has been completed */
async function checkMigrationStatus(migrationName) {
  // Ensure migration table exists first
  const createMetaTableQuery = `
        CREATE TABLE IF NOT EXISTS ${MIGRATION_STATUS_TABLE} (
            migration_name VARCHAR(255) PRIMARY KEY,
            completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `;
  const checkQuery = `SELECT 1 FROM ${MIGRATION_STATUS_TABLE} WHERE migration_name = $1;`;
  try {
    await query(createMetaTableQuery); // Create if not exists
    const result = await query(checkQuery, [migrationName]);
    return result.rowCount > 0; // True if migration entry exists
  } catch (err) {
    console.error(
      `[DB Migration Check] Error checking status for ${migrationName}:`,
      err,
    );
    throw err; // Re-throw to signal failure
  }
}

/** Mark a specific migration as completed */
async function markMigrationComplete(migrationName) {
  const insertQuery = `INSERT INTO ${MIGRATION_STATUS_TABLE} (migration_name) VALUES ($1) ON CONFLICT DO NOTHING;`;
  try {
    await query(insertQuery, [migrationName]);
    console.log(
      `[DB Migration Mark] Marked migration '${migrationName}' as complete.`,
    );
  } catch (err) {
    console.error(
      `[DB Migration Mark] Error marking migration ${migrationName} as complete:`,
      err,
    );
    throw err; // Re-throw
  }
}

module.exports = {
  query,
  initializeDatabase,
  pool, // Export pool if direct access is needed for transactions etc.
  checkMigrationStatus,
  markMigrationComplete,
  MIGRATION_NAME_JSON_STATUS, // Export the name for consistency
};
