import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { Pool } from "pg";
import ts from "typescript";

const mode = process.env.RFQ_HTTP_TEST_MODE;
const base = "http://127.0.0.1:3109";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeRequire = createRequire(import.meta.url);

// Safe by default: importing or running without an explicit mode opens no
// HTTP or database connection and never enables the API server.
if (mode !== "closed" && mode !== "write") {
  console.log("RFQ HTTP integration: disabled; no HTTP or database operations");
} else {
  await main();
}

function load(relativePath) {
  const filePath = path.join(root, `${relativePath}.ts`);
  const compiled = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    fileName: filePath,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const record = { exports: {} };
  new Function("require", "exports", compiled)((specifier) => {
    if (specifier.startsWith("node:")) return nodeRequire(specifier);
    if (specifier.startsWith("@/")) return load(`src/${specifier.slice(2)}`);
    return load(path.relative(root, path.resolve(path.dirname(filePath), specifier)));
  }, record.exports);
  return record.exports;
}

function requireLoopbackHTTPListener() {
  const lines = execFileSync("lsof", ["-nP", "-iTCP:3109", "-sTCP:LISTEN"], {
    encoding: "utf8", timeout: 3000,
  }).trim().split("\n").slice(1);
  if (lines.length !== 1 || !/^node\s/.test(lines[0]) ||
      !lines[0].includes("TCP 127.0.0.1:3109 (LISTEN)"))
    throw new Error("LOCAL_HTTP_LISTENER_REJECTED");
}

async function post(body, headers = {}) {
  const requestHeaders = { Host: "127.0.0.1:3109", Origin: base, ...headers };
  for (const [name, value] of Object.entries(requestHeaders)) {
    if (value === undefined) delete requestHeaders[name];
  }
  const response = await fetch(`${base}/api/rfq`, {
    method: "POST", body, redirect: "manual", signal: AbortSignal.timeout(12_000),
    headers: requestHeaders,
  });
  const raw = await response.text();
  return parseResponse(response.status, raw);
}

function parseResponse(status, raw) {
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error("HTTP_RESPONSE_NOT_JSON"); }
  return { status, data, raw };
}

// Node fetch may replace a custom Host with the URL host. Use a raw HTTP
// request so the invalid Host negative case reaches the server unchanged.
async function postWithInvalidHost(body, key) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port: 3109, path: "/api/rfq",
      method: "POST", setHost: false, timeout: 12_000, headers: { Host: "evil.example", Origin: base,
        "Content-Type": "application/json", "Idempotency-Key": key,
        "Content-Length": Buffer.byteLength(body) } }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { raw += chunk; });
      response.on("end", () => {
        try { resolve(parseResponse(response.statusCode, raw)); }
        catch (error) { reject(error); }
      });
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("HTTP_TIMEOUT")));
    request.on("error", reject);
    request.end(body);
  });
}

function assertSafeResponse(result, forbidden) {
  for (const text of forbidden) assert.equal(result.raw.includes(text), false);
}

async function main() {
  requireLoopbackHTTPListener();
  if (mode === "closed") {
    const result = await post("{}", { "Content-Type": "application/json" });
    assert.equal(result.status, 503);
    assert.deepEqual(result.data, { error: "RFQ_UNAVAILABLE" });
    console.log("PASS closed route: 503; no database connection by this runner");
    return;
  }
  if (process.env.RFQ_RUN_LOCAL_HTTP_WRITES !== "1")
    throw new Error("HTTP_WRITE_GATE_REJECTED");

  const { localTestConnection } = load("src/lib/rfq/local-connection");
  const config = localTestConnection(process.env.RFQ_TEST_AUDIT_DATABASE_URL, "rfq_test_auditor");
  if (config.host !== "127.0.0.1" || config.port !== 5432)
    throw new Error("TEST_AUDITOR_ENDPOINT_REJECTED");
  const audit = new Pool(config);
  audit.on("error", () => {});
  let caseName = "preflight";
  let passed = 0;
  const runId = randomBytes(5).toString("hex").toUpperCase();
  async function test(name, work) {
    caseName = name;
    await work();
    passed++;
    console.log(`PASS ${name}`);
  }
  async function counts(key) {
    const result = await audit.query(`SELECT
      (SELECT count(*)::int FROM rfq_private.rfq_requests WHERE idempotency_key=$1) AS requests,
      (SELECT count(*)::int FROM rfq_private.rfq_items i JOIN rfq_private.rfq_requests r
        ON r.id=i.rfq_request_id WHERE r.idempotency_key=$1) AS items,
      (SELECT count(*)::int FROM rfq_private.rfq_notification_jobs j JOIN rfq_private.rfq_requests r
        ON r.id=j.rfq_request_id WHERE r.idempotency_key=$1) AS jobs`, [key]);
    return Object.values(result.rows[0]);
  }
  try {
    await test("auditor backend identity", async () => {
      const result = await audit.query(`SELECT current_user AS role, current_database() AS database,
        host(inet_server_addr()) AS address, inet_server_port() AS port,
        current_setting('server_version') AS version, r.rolsuper AS superuser,
        r.rolbypassrls AS bypassrls FROM pg_roles r WHERE r.rolname=current_user`);
      assert.deepEqual(result.rows[0], { role: "rfq_test_auditor", database: "rfq_integration_test",
        address: "127.0.0.1", port: 5432, version: "17.11 (Postgres.app)",
        superuser: false, bypassrls: false });
    });
    const { mockProducts } = load("src/lib/catalog/mock-products");
    const product = mockProducts[0];
    assert.ok(product?.variants[0]?.sku && product.variants[0].moq.quantity > 0);
    const body = { contact: { fullName: `HTTP Fixture ${runId}`,
      email: `buyer+${runId.toLowerCase()}@example.invalid`, companyName: "Synthetic Fixture", country: "US" },
      requirements: `Synthetic local HTTP RFQ test ${runId}.`,
      items: [{ productId: product.id, sku: product.variants[0].sku,
        quantity: product.variants[0].moq.quantity }] };
    const serialized = JSON.stringify(body);
    const forbidden = [body.contact.fullName, body.contact.email, body.contact.companyName,
      "postgresql://", "rfq_integration_test"];
    const key = randomUUID();
    const concurrentKey = randomUUID();
    console.log(`RFQ HTTP synthetic run ${runId}; keys ${key}, ${concurrentKey}`);

    await test("normal Host and Origin reach parameter validation", async () => {
      const result = await post("{}", { "Content-Type": "application/json" });
      assert.equal(result.status, 400);
      assert.deepEqual(result.data, { error: "INVALID_IDEMPOTENCY_KEY" });
      assert.deepEqual(await counts(key), [0, 0, 0]);
    });
    await test("invalid or absent Origin and invalid raw Host", async () => {
      assert.equal((await post(serialized, { "Content-Type": "application/json", "Idempotency-Key": key,
        Origin: "http://evil.example" })).status, 403);
      assert.equal((await post(serialized, { "Content-Type": "application/json", "Idempotency-Key": key,
        Origin: undefined })).status, 403);
      assert.equal((await postWithInvalidHost(serialized, key)).status, 403);
      assert.deepEqual(await counts(key), [0, 0, 0]);
    });
    await test("content type, body size and idempotency key", async () => {
      assert.equal((await post(serialized, { "Content-Type": "text/plain", "Idempotency-Key": key })).status, 415);
      assert.equal((await post(" ".repeat(32 * 1024 + 1), { "Content-Type": "application/json",
        "Idempotency-Key": key })).status, 413);
      assert.equal((await post(serialized, { "Content-Type": "application/json" })).status, 400);
      assert.equal((await post(serialized, { "Content-Type": "application/json",
        "Idempotency-Key": "not-a-uuid" })).status, 400);
      assert.deepEqual(await counts(key), [0, 0, 0]);
    });
    const headers = { "Content-Type": "application/json", "Idempotency-Key": key };
    await test("201 creation, 200 replay and 409 changed request", async () => {
      const first = await post(serialized, headers);
      assert.equal(first.status, 201); assert.equal(first.data.replayed, false);
      assertSafeResponse(first, forbidden);
      const replay = await post(serialized, headers);
      assert.equal(replay.status, 200); assert.equal(replay.data.replayed, true);
      assert.equal(replay.data.id, first.data.id); assertSafeResponse(replay, forbidden);
      const changed = await post(JSON.stringify({ ...body, requirements: `Changed synthetic request ${runId}.` }), headers);
      assert.equal(changed.status, 409); assertSafeResponse(changed, forbidden);
      assert.deepEqual(await counts(key), [1, 1, 1]);
    });
    await test("two concurrent HTTP requests create one RFQ and one job", async () => {
      const concurrentHeaders = { "Content-Type": "application/json", "Idempotency-Key": concurrentKey };
      const responses = await Promise.all([post(serialized, concurrentHeaders), post(serialized, concurrentHeaders)]);
      assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 201]);
      for (const response of responses) assertSafeResponse(response, forbidden);
      assert.deepEqual(await counts(concurrentKey), [1, 1, 1]);
    });
    console.log(`RFQ HTTP integration: ${passed} passed; synthetic run ${runId}`);
  } catch {
    console.error(`RFQ HTTP integration failed at ${caseName}; synthetic run ${runId}; no automatic retry or cleanup`);
    process.exitCode = 1;
  } finally { await audit.end(); }
}
