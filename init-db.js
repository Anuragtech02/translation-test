// init-db.js
const db = require("./db");

console.log("[DB Init Script] Starting database initialization...");

db.initializeDatabase()
  .then(() => {
    console.log("[DB Init Script] Database initialization successful.");
    // Close the pool after init is done for this script
    return db.pool.end();
  })
  .then(() => {
    console.log("[DB Init Script] Database pool closed.");
    process.exit(0); // Success exit code
  })
  .catch((err) => {
    console.error("[DB Init Script] Database initialization FAILED:", err);
    process.exit(1); // Failure exit code
  });

// Add a timeout in case initialization hangs
setTimeout(() => {
  console.error(
    "[DB Init Script] Initialization timed out after 30 seconds. Exiting with error.",
  );
  process.exit(1);
}, 30000);
