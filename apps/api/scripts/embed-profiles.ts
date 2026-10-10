// CONN-08: npm run db:embed-profiles, embeds every profile that has goals or a bio but no
// embedding yet (e.g. after db:seed:demo, or profiles saved while HF_TOKEN was unset).
import { createNeonDb } from "../src/db.js";
import { hfEmbedder } from "../src/integrations/huggingface/embeddings.js";
import { backfillProfileEmbeddings } from "../src/services/profileEmbeddings.js";

const url = process.env.DATABASE_URL;
const token = process.env.HF_TOKEN;
if (!url || !token) {
  console.error("DATABASE_URL and HF_TOKEN must be set.");
  process.exit(1);
}

const { db, close } = createNeonDb(url);
try {
  const count = await backfillProfileEmbeddings(db, hfEmbedder(token));
  console.log(`Embedded ${count} profiles.`);
} finally {
  await close();
}
