import assert from "node:assert/strict";
import test from "node:test";
import { addressForGender, morningCheckIn } from "../dist/persona.js";

test("gender choices map to the requested Vietnamese forms of address", () => {
  assert.equal(addressForGender("male"), "anh");
  assert.equal(addressForGender("female"), "chị");
  assert.equal(addressForGender("neutral"), "bạn");
  assert.equal(addressForGender("unexpected"), "bạn");
});

test("morning check-ins are stable, personalized, and identify Bé 3", () => {
  const first = morningCheckIn("male", "2026-08-14:123456789");
  assert.equal(first, morningCheckIn("male", "2026-08-14:123456789"));
  assert.match(first, /Bé 3/);
  assert.match(first, /anh/i);
  assert.doesNotMatch(first, /chị/i);
});
