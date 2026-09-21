const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateLabel, extractLabel, NUTRIENTS } = require("../label-analysis");
const evidence = [{ imageIndex: 0, text: "Per 100 g; sugar <0.5 g" }];
const fact = () => ({ text: null, evidence: [] });
function fixture() {
  return {
    productCount: 1, name: { text: "Example", evidence }, brand: fact(), variant: fact(),
    netQuantity: null, servingSize: null, servingsPerPack: null,
    ingredients: fact(), allergens: { contains: fact(), mayContain: fact() }, claims: [], issues: [],
    panels: [{ heading: "Per 100 g", basis: "per_100g", basisQuantity: { value: 100, unit: "g", evidence },
      preparation: "dry", preparationText: fact(),
      nutrients: Object.fromEntries(NUTRIENTS.map((key) => [key, {
        value: null, unit: key === "energyKcal" ? "kcal" : key === "energyKj" ? "kJ" : key === "sodium" ? "mg" : "g",
        qualifier: "unknown", status: "missing", evidence: [],
      }])),
    }],
  };
}
test("retains missing values and qualified readings without conversion", () => {
  const label = fixture();
  label.panels[0].nutrients.sugar = { value: 0.5, unit: "g", qualifier: "less_than", status: "read", evidence };
  const result = validateLabel(label, 1);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.panels[0].nutrients.fibre.value, null);
  assert.equal(result.panels[0].nutrients.sugar.qualifier, "less_than");
});
test("preserves dry and prepared panels and unequal serving sizes", () => {
  const a = fixture();
  a.servingSize = { value: 25, unit: "g", evidence };
  const prepared = structuredClone(a.panels[0]);
  prepared.preparation = "prepared";
  prepared.basis = "per_serving";
  prepared.basisQuantity = { value: 200, unit: "ml", evidence };
  a.panels.push(prepared);
  const b = fixture();
  b.servingSize = { value: 40, unit: "g", evidence };
  assert.equal(validateLabel(a, 1).panels.length, 2);
  assert.equal(validateLabel(a, 1).servingSize.value, 25);
  assert.equal(validateLabel(b, 1).servingSize.value, 40);
});
for (const [name, mutate] of [
  ["multiple products", (x) => { x.productCount = 2; }],
  ["invalid source", (x) => { x.name.evidence = [{ imageIndex: 9, text: "Example" }]; }],
  ["missing evidence", (x) => { x.name.evidence = []; }],
  ["invented zero", (x) => { x.panels[0].nutrients.sugar.value = 0; }],
  ["wrong energy unit", (x) => { x.panels[0].nutrients.energyKcal.unit = "g"; }],
  ["wrong per-100 quantity", (x) => { x.panels[0].basisQuantity.value = 30; }],
  ["negative serving", (x) => { x.servingSize = { value: -1, unit: "g", evidence }; }],
  ["unexpected data", (x) => { x.inventedScore = 99; }],
]) test(`rejects ${name}`, () => { const label = fixture(); mutate(label); assert.throws(() => validateLabel(label, 1)); });
test("trace is retained without pretending it is zero", () => {
  const label = fixture();
  label.panels[0].nutrients.sugar = { value: null, unit: "g", qualifier: "trace", status: "read", evidence };
  assert.equal(validateLabel(label, 1).panels[0].nutrients.sugar.value, null);
});
test("model response must parse and validate", async () => {
  const images = [{ inlineData: { data: "example", mimeType: "image/png" } }];
  const model = { generateContent: async () => ({ response: { text: () => JSON.stringify(fixture()) } }) };
  assert.equal((await extractLabel(model, images)).productCount, 1);
  model.generateContent = async () => ({ response: { text: () => "not JSON" } });
  await assert.rejects(extractLabel(model, images));
});
