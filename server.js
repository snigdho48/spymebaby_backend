require("dotenv").config();
const app = require("./src/app");
const { ping } = require("./src/config/db");
const { migrate } = require("./src/db/migrate");

const PORT = process.env.PORT || 3001;

(async () => {
  try {
    await ping();
    await migrate();
    console.log("MySQL connection OK.");
  } catch (err) {
    console.error(
      "WARNING: could not connect to MySQL on startup:",
      err.message
    );
    console.error("Run `npm run init-db` and check your .env DB settings.");
  }

  app.listen(PORT, () => {
    console.log(`BrainCount backend running on http://localhost:${PORT}`);
  });
})();
