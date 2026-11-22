import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY_MS, criterionText, datesMatch, filtersText, hasDates, inRange, normalizeDates, rangeText, sameRange } from "../src/dates.ts";

const now = 1000 * DAY_MS;

test("rangeText / criterionText / filtersText", () => {
  assert.equal(rangeText({ within: true, days: 1 }), "in the last day");
  assert.equal(rangeText({ within: true, days: 30 }), "in the last 30 days");
  assert.equal(rangeText({ within: true, days: 365 }), "in the last year");
  assert.equal(rangeText({ within: false, days: 90 }), "more than 90 days ago");
  assert.equal(rangeText({ within: false, days: 365 }), "more than a year ago");
  assert.equal(criterionText("created", { within: true, days: 7 }), "created in the last 7 days");
  assert.equal(filtersText({ modified: { within: false, days: 365 }, created: { within: true, days: 7 } }), "created in the last 7 days, modified more than a year ago");
  assert.equal(filtersText({}), "");
});

test("inRange: recent includes the limit, old is strictly before it", () => {
  const r = { within: true, days: 30 };
  assert.equal(inRange(now - 30 * DAY_MS, r, now), true);
  assert.equal(inRange(now - 31 * DAY_MS, r, now), false);
  const old = { within: false, days: 30 };
  assert.equal(inRange(now - 30 * DAY_MS, old, now), false);
  assert.equal(inRange(now - 31 * DAY_MS, old, now), true);
});

test("datesMatch: every criterion set must hold; no criterion matches all; no dates (folder) matches none", () => {
  const times = { ctime: now - 400 * DAY_MS, mtime: now - 2 * DAY_MS };
  assert.equal(datesMatch({}, times, now), true);
  assert.equal(datesMatch({}, null, now), true);
  assert.equal(datesMatch({ created: { within: false, days: 365 } }, times, now), true);
  assert.equal(datesMatch({ created: { within: false, days: 365 }, modified: { within: true, days: 7 } }, times, now), true);
  assert.equal(datesMatch({ created: { within: false, days: 365 }, modified: { within: false, days: 7 } }, times, now), false);
  assert.equal(datesMatch({ created: { within: true, days: 30 } }, times, now), false);
  assert.equal(datesMatch({ modified: { within: true, days: 7 } }, null, now), false);
});

test("hasDates / sameRange", () => {
  assert.equal(hasDates({}), false);
  assert.equal(hasDates({ modified: { within: true, days: 1 } }), true);
  assert.equal(sameRange({ within: true, days: 7 }, { within: true, days: 7 }), true);
  assert.equal(sameRange({ within: true, days: 7 }, { within: false, days: 7 }), false);
  assert.equal(sameRange(undefined, { within: true, days: 7 }), false);
});

test("normalizeDates: keeps valid ranges, drops the rest", () => {
  assert.deepEqual(normalizeDates(null), {});
  assert.deepEqual(normalizeDates("x"), {});
  assert.deepEqual(
    normalizeDates({ created: { within: true, days: 7 }, modified: { within: "yes", days: 7 }, other: { within: true, days: 1 } }),
    { created: { within: true, days: 7 } },
  );
  assert.deepEqual(normalizeDates({ modified: { within: false, days: 0 } }), {});
  assert.deepEqual(normalizeDates({ modified: { within: false, days: 1.5 } }), {});
});
