import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const DATA_DIR = path.resolve(__dirname, "..", "..", "data");

let db: Database.Database | null = null;

export function getDbPath(): string {
  return path.join(DATA_DIR, "app.db");
}

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS vods (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  duration REAL,
  upload_date TEXT,
  webpage_url TEXT,
  extractor TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  vod_id TEXT NOT NULL REFERENCES vods(id),
  start REAL NOT NULL,
  "end" REAL NOT NULL,
  original_start REAL,
  original_end REAL,
  score REAL NOT NULL,
  reason TEXT NOT NULL,
  origin TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  preview_relative_path TEXT,
  clip_transcript_relative_path TEXT,
  clip_ass_relative_path TEXT,
  clip_srt_relative_path TEXT,
  export_relative_path TEXT,
  is_manually_edited INTEGER
);

CREATE TABLE IF NOT EXISTS clip_segments (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  vod_id TEXT NOT NULL REFERENCES vods(id),
  candidate_id TEXT REFERENCES candidates(id),
  source_start REAL NOT NULL,
  source_end REAL NOT NULL,
  role TEXT NOT NULL DEFAULT 'normal',
  zoom_keyframes TEXT,
  color_preset TEXT,
  speed_ramp TEXT,
  is_reusable INTEGER NOT NULL DEFAULT 0,
  reusable_name TEXT,
  tags TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'marked',
  original_source_start REAL,
  original_source_end REAL,
  preview_relative_path TEXT,
  clip_transcript_relative_path TEXT,
  clip_ass_relative_path TEXT,
  clip_srt_relative_path TEXT,
  export_relative_path TEXT,
  is_manually_edited INTEGER
);

CREATE TABLE IF NOT EXISTS compositions (
  id TEXT PRIMARY KEY,
  vod_id TEXT REFERENCES vods(id),
  name TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS composition_segments (
  id TEXT PRIMARY KEY,
  composition_id TEXT NOT NULL REFERENCES compositions(id),
  clip_segment_id TEXT NOT NULL REFERENCES clip_segments(id),
  order_index INTEGER NOT NULL
);

-- audio_library: effects library for video overlays / music / sfx
-- (legacy table name kept; type = "video" | "music" | "sfx").
CREATE TABLE IF NOT EXISTS audio_library (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  duration_seconds REAL,
  tags TEXT,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  usage_count INTEGER NOT NULL DEFAULT 0,
  source_type TEXT NOT NULL,
  source_item_id TEXT REFERENCES audio_library(id),
  created_at TEXT NOT NULL,
  chroma_key_color TEXT,
  chroma_key_similarity REAL,
  chroma_key_blend REAL
);

-- clip_audio_instances: applied effect instances on a candidate OR clip_segment.
-- clip_segment_id stores either id; validated via findClipEditableById (no rigid FK).
CREATE TABLE IF NOT EXISTS clip_audio_instances (
  id TEXT PRIMARY KEY,
  clip_segment_id TEXT NOT NULL,
  audio_library_item_id TEXT NOT NULL REFERENCES audio_library(id),
  type TEXT NOT NULL,
  source_trim_start REAL,
  source_trim_end REAL,
  volume REAL,
  fade_in_seconds REAL,
  fade_out_seconds REAL,
  ducking_enabled INTEGER NOT NULL DEFAULT 0,
  clip_timestamp REAL,
  position_x REAL,
  position_y REAL,
  position_width REAL,
  position_height REAL
);
`;

/**
 * Open (or create) backend/data/app.db and ensure schema exists.
 * Safe to call on every boot — CREATE TABLE IF NOT EXISTS.
 */
export function initDb(): Database.Database {
  if (db) return db;

  const dataDir = DATA_DIR;
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = getDbPath();
  db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  migrateClipSegmentsColumns(db);
  migrateCompositionsColumns(db);
  migrateEffectsLibraryColumns(db);
  migrateLibraryBrowseIndexes(db);
  return db;
}

/** Idempotent ALTER for DBs created before Layer-2 media/status columns. */
function migrateClipSegmentsColumns(database: Database.Database): void {
  const cols = (
    database.prepare("PRAGMA table_info(clip_segments)").all() as Array<{
      name: string;
    }>
  ).map((c) => c.name);
  const have = new Set(cols);
  const add: Array<[string, string]> = [
    ["status", "TEXT NOT NULL DEFAULT 'marked'"],
    ["original_source_start", "REAL"],
    ["original_source_end", "REAL"],
    ["preview_relative_path", "TEXT"],
    ["clip_transcript_relative_path", "TEXT"],
    ["clip_ass_relative_path", "TEXT"],
    ["clip_srt_relative_path", "TEXT"],
    ["export_relative_path", "TEXT"],
    ["is_manually_edited", "INTEGER"],
    ["tags", "TEXT"],
    ["preset_applications_json", "TEXT"],
  ];
  for (const [name, def] of add) {
    if (!have.has(name)) {
      database.exec(`ALTER TABLE clip_segments ADD COLUMN ${name} ${def}`);
    }
  }
}

function migrateCompositionsColumns(database: Database.Database): void {
  const cols = (
    database.prepare("PRAGMA table_info(compositions)").all() as Array<{
      name: string;
    }>
  ).map((c) => c.name);
  if (!cols.includes("subtitle_settings_json")) {
    database.exec(
      `ALTER TABLE compositions ADD COLUMN subtitle_settings_json TEXT`
    );
  }
  if (!cols.includes("join_settings_json")) {
    database.exec(
      `ALTER TABLE compositions ADD COLUMN join_settings_json TEXT`
    );
  }
  if (!cols.includes("color_settings_json")) {
    database.exec(
      `ALTER TABLE compositions ADD COLUMN color_settings_json TEXT`
    );
  }
  if (!cols.includes("opening_settings_json")) {
    database.exec(
      `ALTER TABLE compositions ADD COLUMN opening_settings_json TEXT`
    );
  }
  if (!cols.includes("closing_settings_json")) {
    database.exec(
      `ALTER TABLE compositions ADD COLUMN closing_settings_json TEXT`
    );
  }
}

/**
 * Idempotent ALTERs for effects library (video chroma + overlay position).
 * Also rebuilds clip_audio_instances if it still has a rigid FK to clip_segments
 * (legacy schema) so clip_segment_id can hold candidate OR clip_segment ids.
 */
function migrateEffectsLibraryColumns(database: Database.Database): void {
  const libraryCols = (
    database.prepare("PRAGMA table_info(audio_library)").all() as Array<{
      name: string;
    }>
  ).map((c) => c.name);
  const libraryHave = new Set(libraryCols);
  const libraryAdd: Array<[string, string]> = [
    ["chroma_key_color", "TEXT"],
    ["chroma_key_similarity", "REAL"],
    ["chroma_key_blend", "REAL"],
    ["sensation_tags", "TEXT"],
    ["status", "TEXT NOT NULL DEFAULT 'active'"],
    ["last_used_at", "TEXT"],
    ["thumbnail_path", "TEXT"],
    ["waveform_path", "TEXT"],
    ["image_width", "INTEGER"],
    ["image_height", "INTEGER"],
    ["background_removal_mode", "TEXT"],
  ];
  for (const [name, def] of libraryAdd) {
    if (!libraryHave.has(name)) {
      database.exec(`ALTER TABLE audio_library ADD COLUMN ${name} ${def}`);
    }
  }

  const instanceCols = (
    database.prepare("PRAGMA table_info(clip_audio_instances)").all() as Array<{
      name: string;
    }>
  ).map((c) => c.name);
  const instanceHave = new Set(instanceCols);
  const instanceAdd: Array<[string, string]> = [
    ["position_x", "REAL"],
    ["position_y", "REAL"],
    ["position_width", "REAL"],
    ["position_height", "REAL"],
    ["video_loop_enabled", "INTEGER NOT NULL DEFAULT 0"],
  ];
  for (const [name, def] of instanceAdd) {
    if (!instanceHave.has(name)) {
      database.exec(
        `ALTER TABLE clip_audio_instances ADD COLUMN ${name} ${def}`
      );
    }
  }

  // Drop rigid FK clip_segment_id → clip_segments if present (SQLite: recreate).
  const fkList = database
    .prepare("PRAGMA foreign_key_list(clip_audio_instances)")
    .all() as Array<{ table: string; from: string }>;
  const hasClipSegmentFk = fkList.some(
    (fk) => fk.table === "clip_segments" && fk.from === "clip_segment_id"
  );
  if (!hasClipSegmentFk) return;

  database.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE clip_audio_instances_new (
      id TEXT PRIMARY KEY,
      clip_segment_id TEXT NOT NULL,
      audio_library_item_id TEXT NOT NULL REFERENCES audio_library(id),
      type TEXT NOT NULL,
      source_trim_start REAL,
      source_trim_end REAL,
      volume REAL,
      fade_in_seconds REAL,
      fade_out_seconds REAL,
      ducking_enabled INTEGER NOT NULL DEFAULT 0,
      clip_timestamp REAL,
      position_x REAL,
      position_y REAL,
      position_width REAL,
      position_height REAL
    );
    INSERT INTO clip_audio_instances_new (
      id, clip_segment_id, audio_library_item_id, type,
      source_trim_start, source_trim_end, volume,
      fade_in_seconds, fade_out_seconds, ducking_enabled, clip_timestamp,
      position_x, position_y, position_width, position_height
    )
    SELECT
      id, clip_segment_id, audio_library_item_id, type,
      source_trim_start, source_trim_end, volume,
      fade_in_seconds, fade_out_seconds, ducking_enabled, clip_timestamp,
      position_x, position_y, position_width, position_height
    FROM clip_audio_instances;
    DROP TABLE clip_audio_instances;
    ALTER TABLE clip_audio_instances_new RENAME TO clip_audio_instances;
    PRAGMA foreign_keys = ON;
  `);
}

/** Indexes for paginated library browse (filter + sort). */
function migrateLibraryBrowseIndexes(database: Database.Database): void {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_audio_library_browse
      ON audio_library(status, type, usage_count DESC);
    CREATE INDEX IF NOT EXISTS idx_audio_library_favorite_active
      ON audio_library(is_favorite, status);
    CREATE INDEX IF NOT EXISTS idx_audio_library_last_used
      ON audio_library(last_used_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audio_library_created
      ON audio_library(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audio_library_name
      ON audio_library(name COLLATE NOCASE);
  `);
}

export function getDb(): Database.Database {
  if (!db) {
    return initDb();
  }
  return db;
}

/** Ensure a vods row exists so candidates FK can succeed (e.g. pre-DB VODs). */
export function ensureVodRow(vodId: string, partial?: {
  title?: string;
  duration?: number | null;
  uploadDate?: string | null;
  webpageUrl?: string | null;
  extractor?: string | null;
}): void {
  const database = getDb();
  const existing = database
    .prepare("SELECT id FROM vods WHERE id = ?")
    .get(vodId) as { id: string } | undefined;
  if (existing) {
    if (partial && (partial.title || partial.webpageUrl || partial.extractor)) {
      database
        .prepare(
          `UPDATE vods SET
            title = COALESCE(?, title),
            duration = COALESCE(?, duration),
            upload_date = COALESCE(?, upload_date),
            webpage_url = COALESCE(?, webpage_url),
            extractor = COALESCE(?, extractor)
           WHERE id = ?`
        )
        .run(
          partial.title ?? null,
          partial.duration ?? null,
          partial.uploadDate ?? null,
          partial.webpageUrl ?? null,
          partial.extractor ?? null,
          vodId
        );
    }
    return;
  }

  database
    .prepare(
      `INSERT INTO vods (id, title, duration, upload_date, webpage_url, extractor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      vodId,
      partial?.title ?? vodId,
      partial?.duration ?? null,
      partial?.uploadDate ?? null,
      partial?.webpageUrl ?? null,
      partial?.extractor ?? null,
      new Date().toISOString()
    );
}
