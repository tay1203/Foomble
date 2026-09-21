const { test } = require("node:test");
const assert = require("node:assert/strict");
const { providerErrorResponse } = require("../provider-error");

test("provider overload is reported as temporary unavailability", () => {
  const result = providerErrorResponse({ status: 503, message: "sensitive upstream details" });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "AI_TEMPORARILY_UNAVAILABLE");
  assert.doesNotMatch(result.body.message, /sensitive|clear image/);
});
test("provider quota is distinguished from per-user app limits", () => {
  const result = providerErrorResponse({ status: 429 });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "AI_CAPACITY_LIMIT");
});
test("other upstream errors do not expose their payload", () => {
  assert.equal(providerErrorResponse({ status: 401 }).status, 502);
});
test("extraction validation errors retain their separate handling", () => {
  assert.equal(providerErrorResponse(new SyntaxError("Invalid JSON")), null);
  assert.equal(providerErrorResponse(new Error("Missing evidence")), null);
});
