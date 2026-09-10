import { initDb } from "../src/db/index.js";
import {
  deleteSeedLibraryItems,
  listEffectLibraryItems,
} from "../src/services/effectsLibraryService.js";

initDb();
const before = listEffectLibraryItems({ includeArchived: true }).length;
const deleted = await deleteSeedLibraryItems();
const after = listEffectLibraryItems({ includeArchived: true }).length;
console.log(JSON.stringify({ before, deleted, after, remaining: after }));
