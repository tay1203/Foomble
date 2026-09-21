import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHistoryPayload, prepareReplay } from "../src/lib/chat-history.ts";

const photoA = new File(["A"], "a.png", { type: "image/png" });
const photoB = new File(["B"], "b.png", { type: "image/png" });
const message = (id, type, text, extra = {}) => ({ id, type, message: text, timestamp: new Date(), ...extra });
const conversation = [
  message("welcome", "bot", "Hello"),
  message("q1", "user", "Sugar?", { attachments: [photoA] }),
  message("a1", "bot", "12 g", { replyTo: "q1" }),
  message("q2", "user", "Protein?", { attachments: [photoB] }),
  message("a2", "bot", "Service unavailable", { replyTo: "q2", isError: true }),
];

test("retrying an older question uses its photos and excludes its old answer and future history", () => {
  const replay = prepareReplay(conversation, "q1");
  assert.deepEqual(replay.question.attachments, [photoA]);
  assert.deepEqual(buildHistoryPayload(replay.history), []);
  assert.equal(conversation.length, 5);
});
test("retrying a failed answer retains only the preceding successful conversation", () => {
  const replay = prepareReplay(conversation, conversation[4].replyTo);
  assert.deepEqual(replay.question.attachments, [photoB]);
  assert.deepEqual(buildHistoryPayload(replay.history), [
    { role: "user", text: "Sugar?" }, { role: "model", text: "12 g" },
  ]);
});
test("follow-up questions retain inherited attachments even without visible thumbnails", () => {
  const followUp = message("q3", "user", "And salt?", { attachments: [photoB] });
  const replay = prepareReplay([...conversation, followUp], "q3");
  assert.equal(replay.question.images, undefined);
  assert.deepEqual(replay.question.attachments, [photoB]);
});
test("editing can replace a question without mutating its stored original", () => {
  const replay = prepareReplay(conversation, "q1");
  const edited = { ...replay.question, message: "Fibre?" };
  assert.equal(conversation[1].message, "Sugar?");
  assert.equal(edited.message, "Fibre?");
  assert.deepEqual(edited.attachments, [photoA]);
});
test("history excludes greeting, errors, and loading placeholders", () => {
  const history = buildHistoryPayload([...conversation, message("loading", "bot", "Thinking", { isProcessing: true })]);
  assert.deepEqual(history.map((m) => m.text), ["Sugar?", "12 g", "Protein?"]);
});
test("history is bounded and starts with a user", () => {
  const messages = Array.from({ length: 15 }, (_, i) => message(String(i), i % 2 ? "bot" : "user", `Text ${i}`, i % 2 ? { replyTo: String(i - 1) } : {}));
  const history = buildHistoryPayload(messages);
  assert.ok(history.length <= 8);
  assert.equal(history[0].role, "user");
  assert.equal(history.at(-1).text, "Text 14");
});
test("invalid replay targets and unavailable files cannot send a different product accidentally", () => {
  assert.equal(prepareReplay(conversation, "a1"), null);
  assert.equal(prepareReplay(conversation, "missing"), null);
  assert.equal(prepareReplay([message("q", "user", "Question")], "q"), null);
});
