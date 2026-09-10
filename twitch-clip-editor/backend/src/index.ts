import express from "express";
import dotenv from "dotenv";
import path from "path";
import cors from "cors";
import { routes } from "./routes";
import { getDataDir } from "./services/vodIngest";
import { initDb } from "./db";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

initDb();

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

app.use(cors({ origin: true }));
app.use(express.json());
app.use(
  "/media",
  express.static(getDataDir(), {
    // Exports overwrite the same filename; avoid sticky browser caches of old MP4s.
    setHeaders(res, filePath) {
      if (filePath.endsWith(".mp4") || filePath.endsWith(".webm")) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  })
);
app.use(routes);

const TRIM_PREVIEW_TIMEOUT_MS = 45 * 60 * 1000;

const server = app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
server.timeout = TRIM_PREVIEW_TIMEOUT_MS;
server.keepAliveTimeout = TRIM_PREVIEW_TIMEOUT_MS + 5000;
server.headersTimeout = TRIM_PREVIEW_TIMEOUT_MS + 10000;
