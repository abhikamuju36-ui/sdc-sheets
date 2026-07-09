import { test } from "node:test";
import assert from "node:assert/strict";
import { compareJobIds } from "../src/lib/job-filters";

test("compareJobIds: numeric order, not lexicographic", () => {
  const ids = ["10000", "1020", "979", "1083"];
  ids.sort(compareJobIds);
  assert.deepEqual(ids, ["979", "1020", "1083", "10000"]);
});

test("compareJobIds: zero-padded ids compare by value", () => {
  assert.ok(compareJobIds("0979", "1020") < 0);
  assert.equal(compareJobIds("0100", "100"), 0);
});

test("compareJobIds: non-numeric ids fall back to string compare", () => {
  const ids = ["SVC-2", "1020", "SVC-1"];
  ids.sort(compareJobIds);
  assert.deepEqual(ids, ["1020", "SVC-1", "SVC-2"]);
});
