// Tests for pure.js — run with `node --test` from the repo root.
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../pure.js");

// -------- escapeHtml --------
test("escapeHtml escapes the five specials and tolerates null", () => {
  assert.equal(P.escapeHtml('<a href="x">&\'</a>'), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  assert.equal(P.escapeHtml(null), "");
  assert.equal(P.escapeHtml(123), "123");
});

// -------- parsePriceCsv --------
test("parsePriceCsv parses a plain comma CSV", () => {
  const { header, objects } = P.parsePriceCsv("BackendID,Price\nA1,10.50\nA2,11\n");
  assert.deepEqual(header, ["BackendID", "Price"]);
  assert.equal(objects.length, 2);
  assert.deepEqual(objects[0], { BackendID: "A1", Price: "10.50" });
});

test("parsePriceCsv strips a UTF-8 BOM", () => {
  const { header } = P.parsePriceCsv("﻿BackendID,Price\nA1,1\n");
  assert.deepEqual(header, ["BackendID", "Price"]);
});

test("parsePriceCsv sniffs tab delimiter", () => {
  const { delim, objects } = P.parsePriceCsv("BackendID\tPrice\nA1\t9,99\n");
  assert.equal(delim, "\t");
  assert.equal(objects[0].Price, "9,99");
});

test("parsePriceCsv handles quoted fields with embedded delimiter and quotes", () => {
  const { objects } = P.parsePriceCsv('BackendID,Note\nA1,"hello, ""world"""\n');
  assert.equal(objects[0].Note, 'hello, "world"');
});

test("parsePriceCsv handles CRLF and a missing trailing newline", () => {
  const { objects } = P.parsePriceCsv("BackendID,Price\r\nA1,1\r\nA2,2");
  assert.equal(objects.length, 2);
  assert.equal(objects[1].BackendID, "A2");
});

test("parsePriceCsv on empty input returns no rows", () => {
  const { header, objects } = P.parsePriceCsv("");
  assert.deepEqual(header, []);
  assert.deepEqual(objects, []);
});

// -------- pickCol --------
test("pickCol is case-insensitive and walks aliases", () => {
  const row = { "backendid": "B1", "Value": "5" };
  assert.equal(P.pickCol(row, ["BackendID", "ProductID"]), "B1");
  assert.equal(P.pickCol(row, ["Price", "Value"]), "5");
  assert.equal(P.pickCol(row, ["Missing"]), "");
});

// -------- normaliseDate --------
test("normaliseDate handles the supported formats", () => {
  assert.equal(P.normaliseDate("2024-01-02"), "2024-01-02T00:00:00Z");
  assert.equal(P.normaliseDate("2024-01-02T10:00:00Z"), "2024-01-02T10:00:00Z"); // passthrough
  assert.equal(P.normaliseDate("2024-1-2 9:5"), "2024-01-02T09:05:00Z");
  assert.equal(P.normaliseDate("31/12/2024"), "2024-12-31T00:00:00Z");
  assert.equal(P.normaliseDate("31-12-9000  00:00:00"), "9000-12-31T00:00:00Z"); // double space
  assert.equal(P.normaliseDate(""), null);
  assert.equal(P.normaliseDate("not a date"), "not a date"); // unknown → passthrough
});

// -------- buildAdjBody --------
test("buildAdjBody validates and maps a row", () => {
  const ok = P.buildAdjBody({ BackendID: "B1", Price: "12,50", EffectiveDate: "2024-01-01" }, "999");
  assert.equal(ok.error, undefined);
  assert.deepEqual(ok.body, {
    PriceListAdjustmentID: "999",
    ProductID: "B1",
    Value: 12.5,
    EffectiveDate: "2024-01-01T00:00:00Z",
  });
});

test("buildAdjBody rejects bad rows", () => {
  assert.match(P.buildAdjBody({ BackendID: "B1", Price: "1" }, null).error, /adjustment/i);
  assert.match(P.buildAdjBody({ Price: "1" }, "999").error, /BackendID/);
  assert.match(P.buildAdjBody({ BackendID: "B1" }, "999").error, /Price/);
  assert.match(P.buildAdjBody({ BackendID: "B1", Price: "abc" }, "999").error, /not numeric/);
});

// -------- buildPriceEntry --------
test("buildPriceEntry maps a row to a Push Prices[] entry", () => {
  const ok = P.buildPriceEntry({ BackendID: "B1", Price: "9.99", ExpireDate: "2030-01-01" });
  assert.equal(ok.error, undefined);
  assert.deepEqual(ok.entry, {
    ID: "B1",
    ProductID: "B1",
    Price: 9.99,
    EndDate: "2030-01-01T00:00:00Z",
  });
});

test("buildPriceEntry rejects bad rows", () => {
  assert.match(P.buildPriceEntry({ Price: "1" }).error, /BackendID/);
  assert.match(P.buildPriceEntry({ BackendID: "B1" }).error, /Price/);
});

// -------- orderObjectIsReturnFlagged --------
test("orderObjectIsReturnFlagged detects boolean flags", () => {
  assert.equal(P.orderObjectIsReturnFlagged({ is_returned: true }), true);
  assert.equal(P.orderObjectIsReturnFlagged({ is_returned: false }), false);
});

test("orderObjectIsReturnFlagged detects status strings", () => {
  assert.equal(P.orderObjectIsReturnFlagged({ status: "Order Returned" }), true);
  assert.equal(P.orderObjectIsReturnFlagged({ nested: { type: "RefundOrder" } }), true);
  assert.equal(P.orderObjectIsReturnFlagged({ status: "Shipped" }), false);
});

test("orderObjectIsReturnFlagged detects non-empty return arrays", () => {
  assert.equal(P.orderObjectIsReturnFlagged({ return_lines: [{}] }), true);
  assert.equal(P.orderObjectIsReturnFlagged({ return_lines: [] }), false);
});

// -------- detectSearchTerm --------
test("detectSearchTerm accepts numeric IDs and emails only", () => {
  assert.equal(P.detectSearchTerm("123456"), "123456");
  assert.equal(P.detectSearchTerm(" a@b.co "), "a@b.co");
  assert.equal(P.detectSearchTerm("hello world"), null);
  assert.equal(P.detectSearchTerm(""), null);
});

// -------- formatDuration --------
test("formatDuration formats seconds, minutes, hours", () => {
  assert.equal(P.formatDuration(45), "45s");
  assert.equal(P.formatDuration(125), "2m 5s");
  assert.equal(P.formatDuration(3700), "1h 1m");
});
