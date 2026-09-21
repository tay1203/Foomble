const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readLabelImages } = require("../label-upload");
function request(files) {
  return {
    headers: { "content-type": "multipart/form-data; boundary=label-test" },
    rawBody: Buffer.from(files.map(({ type = "image/png", body = "photo" }) =>
      `--label-test\r\nContent-Disposition: form-data; name="images"; filename="photo.png"\r\nContent-Type: ${type}\r\n\r\n${body}\r\n`
    ).join("") + "--label-test--\r\n"),
  };
}
test("accepts four photos and preserves order", async () => {
  const images = await readLabelImages(request(["A", "B", "C", "D"].map((body) => ({ body }))));
  assert.equal(images.length, 4);
  assert.equal(Buffer.from(images[1].inlineData.data, "base64").toString(), "B");
});
test("rejects missing, empty, unsupported, oversized, and excessive photos", async () => {
  for (const files of [[], [{ body: "" }], [{ type: "text/plain" }], [{ body: "x".repeat(8 * 1024 * 1024 + 1) }], Array.from({ length: 5 }, () => ({}))]) {
    await assert.rejects(readLabelImages(request(files)), { status: 400 });
  }
});
test("rejects malformed multipart", async () => {
  await assert.rejects(readLabelImages({ headers: {}, rawBody: Buffer.from("") }), { status: 400 });
  await assert.rejects(readLabelImages({ headers: request([]).headers, rawBody: Buffer.from("--label-test\r\nbroken") }), { status: 400 });
});
