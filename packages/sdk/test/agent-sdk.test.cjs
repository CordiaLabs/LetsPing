const test = require("node:test");
const assert = require("node:assert/strict");

const sdk = require("../dist/index.js");

test("createAgentWorkspace happy path uses retry and returns credentials", async (t) => {
  let call = 0;
  global.fetch = async (url, init) => {
    call++;
    if (call === 1) {
      // request-token
      assert.equal(init.method, "POST");
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: "tok-123" }),
      };
    }
    if (call === 2) {
      // redeem
      return {
        ok: true,
        status: 200,
        json: async () => ({
          project_id: "proj1",
          api_key: "k_test",
          ingest_url: "https://letsping.co/api/ingest",
          agents_register_url: "https://letsping.co/api/agents/register",
          org_id: "org1",
          docs_url: "https://letsping.co/docs",
        }),
      };
    }
    // register
    return {
      ok: true,
      status: 200,
      json: async () => ({ agent_id: "agent1", agent_secret: "secret1" }),
    };
  };

  const creds = await sdk.createAgentWorkspace({
    baseUrl: "https://letsping.co",
    retry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 5 },
  });

  assert.equal(creds.project_id, "proj1");
  assert.equal(creds.api_key, "k_test");
  assert.equal(creds.agent_id, "agent1");
  assert.equal(creds.agent_secret, "secret1");
});

test("ingestWithAgentSignature maps non-2xx to LetsPingError with code and docs URL", async () => {
  global.fetch = async () => ({
    ok: false,
    status: 402,
    json: async () => ({ error: "quota", code: "LETSPING_402_QUOTA" }),
  });

  try {
    await sdk.ingestWithAgentSignature(
      "agent1",
      "secret1",
      {
        service: "TestAgent",
        action: "Search",
        payload: { query: "test" },
      },
      {
        projectId: "proj1",
        ingestUrl: "https://letsping.co/api/ingest",
        apiKey: "k_test",
        retry: { maxAttempts: 1 },
      }
    );
    assert.fail("expected error");
  } catch (err) {
    assert.ok(err instanceof sdk.LetsPingError);
    assert.equal(err.status, 402);
    assert.equal(err.code, "LETSPING_402_QUOTA");
    assert.ok(typeof err.documentationUrl === "string");
    assert.ok(err.documentationUrl.includes("#billing"));
  }
});

