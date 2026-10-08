import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

// Star velocity needs a heartbeat: snapshot counts daily so growth can be
// diffed against last week even when nobody is browsing.
crons.interval(
  "refresh star snapshots",
  { hours: 24 },
  internal.github.refreshStarSnapshots,
  {},
);

// Star history only needs a few weeks of runway for growth diffs; prune the
// rest so the table does not keep one row per repo per day forever.
crons.daily(
  "prune star history",
  { hourUTC: 3, minuteUTC: 30 },
  internal.feed.pruneStarHistory,
  {},
);

export default crons;
