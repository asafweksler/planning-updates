import type { Config, Context } from "@netlify/functions";
import syncHandler from "./sync-xplan.mts";

// Runs once a day (UTC). If you prefer a specific UTC time, replace '@daily' with a cron expression.
export const config: Config = {
  schedule: "@daily",
};

export default async (req: Request, context: Context) => {
  // Scheduled functions receive a JSON body containing next_run; we ignore it.
  // We reuse the same sync logic.
  return syncHandler(new Request(req.url, { method: "POST" }), context);
};
