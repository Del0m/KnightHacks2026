import { HfLlm, llmConfigFromEnv } from "../src/integrations/huggingface/llm.js";
import { Moderator, moderationConfigFromEnv } from "../src/integrations/huggingface/moderation.js";

// Warnings stay on so an unreachable check (allowed, checked=false) is visible.
const m = new Moderator(moderationConfigFromEnv(), undefined, console, new HfLlm(llmConfigFromEnv()));

const samples = [
  "New squat PR today, 100 kg!",
  "your form is trash lol",
  "I'm going to find you after the gym and hurt you",
  "I know where you live, watch your back at the gym tomorrow",
  "you're a fat useless pig, quit the gym",
  "if you skip leg day again I'll kill you 😂",
  "I'm going to destroy legs today",
  "saw you at the 6am class, you go every day right? see you there 😉",
  "nice squats, I enjoyed the view 😏",
  "see you at 6am class tomorrow, let's hit legs",
];

for (const text of samples) {
  const r = await m.moderate(text, "comment");
  console.log(r.allowed ? "ALLOWED" : "BLOCKED", `checked=${r.checked}`, `"${text}"`, r.categories.join(", "), r.message ?? "");
}
