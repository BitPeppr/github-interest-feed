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

export default crons;
