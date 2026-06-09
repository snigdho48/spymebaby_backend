const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const authRoutes = require("./routes/auth.routes");
const trackerRoutes = require("./routes/tracker.routes");
const trackingRoutes = require("./routes/tracking.routes");
const userRoutes = require("./routes/user.routes");

const app = express();

const corsOrigin = process.env.CORS_ORIGIN || "*";
app.use(
  cors({
    origin:
      corsOrigin === "*" ? true : corsOrigin.split(",").map((o) => o.trim()),
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

app.get("/", (req, res) =>
  res.json({ name: "braincount-backend", status: "ok" })
);
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// All frontend calls are namespaced under /api/
app.use("/api", authRoutes);
app.use("/api", trackerRoutes);
app.use("/api", trackingRoutes);
app.use("/api", userRoutes);

app.use((req, res) => res.status(404).json({ error: "Not found." }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON in request body." });
  }
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error("Unhandled error:", err);
  return res.status(status).json({
    error:
      status >= 500
        ? "Internal server error."
        : err.message || "Request failed.",
  });
});

module.exports = app;
