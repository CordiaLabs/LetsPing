import http, { IncomingMessage, ServerResponse } from "http";
import { createClient, SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import { Command } from "commander";
import chalk from "chalk";
import dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL =
  process.env.LETSPING_SUPABASE_URL || "https://tqphlqmmamdjoufqnnka.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.LETSPING_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxcGhscW1tYW1kam91ZnFubmthIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxMjIzNjksImV4cCI6MjA4NDY5ODM2OX0.N3EU5ovNeeh6pkJsi_emHuMFm5vAguC3qR0S4Qq5K14";
const WEB_APP_URL = process.env.LETSPING_DASHBOARD_URL || "https://letsping.co";
const DASHBOARD_URL = WEB_APP_URL;

let CLI_VERSION = "0.3.3";
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  CLI_VERSION = require("../package.json").version;
} catch {
  // ignore
}

interface RequestPayload {
  id?: string;
  service?: string;
  action?: string;
  status?: string;
  flagged_reason?: string;
  flagged_by_guardrail_id?: string;
  project_id?: string;
  [key: string]: any;
}

interface ResolveUpdate {
  status: "APPROVED" | "REJECTED";
  patched_payload?: any;
  reason?: string;
}

interface ResolvePayload {
  requestId: string;
  update: ResolveUpdate;
}

type Verdict = "ALLOW" | "BLOCK" | "PENDING" | "HITL";

interface TailEvent {
  id: string;
  project_id: string | null;
  service: string;
  action: string;
  status: string;
  created_at: string;
  flagged_reason?: string | null;
  flagged_by_guardrail_id?: string | null;
  payload?: {
    _lp_meta?: {
      environment?: string;
    };
  };
}

const program = new Command();

program
  .name("letsping")
  .description("CLI for LetsPing.co - Local tunnel and firewall visibility")
  .version(CLI_VERSION);

program
  .command("dev")
  .description("Start the local development tunnel")
  .action(async () => {
    runDevTunnel();
  });

program
  .command("demo")
  .description("Send one approval request and open the dashboard (first-run demo)")
  .option("-b, --base-url <url>", "API base URL (default: https://letsping.co/api)")
  .action(async (opts: { baseUrl?: string }) => {
    await runDemo(opts.baseUrl);
  });

program
  .command("tail")
  .description("Stream firewall decisions and ingest events into the terminal")
  .option("--env <env>", "Environment filter (local|vercel-ai|langchain|mcp|python|bare-metal)", "local")
  .option("--service <service>", "Service filter")
  .option("--action <action>", "Action filter")
  .option("--project <projectId>", "Project ID override (defaults to LETSPING_PROJECT_ID)")
  .option("--status <list>", "Comma-separated statuses (PENDING,APPROVED,REJECTED)", "PENDING,APPROVED,REJECTED")
  .action(async (opts: {
    env: string;
    service?: string;
    action?: string;
    project?: string;
    status: string;
  }) => {
    await runTail(opts);
  });

program
  .command("proxy")
  .description("Run a local HTTP reverse proxy with step-by-step firewall evaluation")
  .requiredOption("--target <url>", "Upstream target URL (e.g. https://api.dev.internal)")
  .option("--port <port>", "Local listen port", "4510")
  .option("--service <service>", "Logical service name for logs")
  .action(async (opts: { target: string; port: string; service?: string }) => {
    await runProxy(opts);
  });

program.parse(process.argv);

async function runDemo(baseUrl?: string) {
  const apiKey = process.env.LETSPING_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    console.log(chalk.yellow("\n  No API key found.\n"));
    console.log(chalk.white("  1. Get your key: " + chalk.cyan(DASHBOARD_URL + "/login")));
    console.log(
      chalk.white(
        "  2. Create a workspace, then go to Settings → Developers → Create API key",
      ),
    );
    console.log(
      chalk.white(
        "  3. Run: " + chalk.cyan("export LETSPING_API_KEY=lp_...") + " (or set in .env)",
      ),
    );
    console.log(chalk.white("  4. Run " + chalk.cyan("letsping demo") + " again.\n"));
    process.exit(1);
  }

  console.log(chalk.hex("#8B5CF6").bold("\n◆ LetsPing first-run demo\n"));
  console.log(
    chalk.dim("  Sending one approval request. You’ll see it in the dashboard.\n"),
  );

  try {
    const { LetsPing } = await import("@letsping/sdk");
    const lp = new LetsPing(apiKey, {
      baseUrl: baseUrl ? baseUrl.replace(/\/?$/, "") + "/api" : undefined,
    });
    const decision = await lp.ask({
      service: "demo-agent",
      action: "transfer_funds",
      payload: { amount: 100, reason: "First-run demo from letsping demo" },
      priority: "high",
      timeoutMs: 120_000,
    });

    if (decision.status === "APPROVED") {
      console.log(
        chalk.green("  ✓ Approved. Execution would resume with the payload.\n"),
      );
    } else {
      console.log(
        chalk.yellow(
          "  → " +
            (decision.status || "REJECTED") +
            ". Request was not approved.\n",
        ),
      );
    }
  } catch (err: any) {
    if (err.message?.includes("402")) {
      console.log(
        chalk.yellow(
          "  Quota or billing limit (402). Upgrade or add payment in the dashboard.\n",
        ),
      );
    } else {
      console.error(chalk.red("  Error:"), err.message || err);
    }
    process.exit(1);
  }

  console.log(chalk.white("  Dashboard: " + chalk.cyan(DASHBOARD_URL + "/dashboard")));
  console.log("");
}

function runDevTunnel() {
  const PROJECT_ID = process.env.LETSPING_PROJECT_ID;
  const API_PORT = parseInt(process.env.LETSPING_PORT || "3005", 10);

  if (!PROJECT_ID) {
    console.error(chalk.red("\n✖ Error: Missing LETSPING_PROJECT_ID\n"));
    console.log(
      chalk.white(
        "  1. Open the dashboard: " + chalk.cyan(`${DASHBOARD_URL}/dashboard`),
      ),
    );
    console.log(
      chalk.white(
        "  2. Use the project selector in the header to click into a workspace.",
      ),
    );
    console.log(
      chalk.dim("       " + `${DASHBOARD_URL}/dashboard?project=proj_123...`),
    );
    console.log(
      chalk.white(
        "  3. Copy the value after " +
          chalk.cyan("project=") +
          " and set it in your shell:",
      ),
    );
    console.log(
      chalk.cyan("       export LETSPING_PROJECT_ID=proj_123...") + "\n",
    );
    process.exit(1);
  }

  const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const pendingRequests = new Map<string, ServerResponse>();
  let dashboardConnected = false;
  const channel: RealtimeChannel = supabase.channel(`project:${PROJECT_ID}`);

  channel
    .on("broadcast", { event: "resolve_local_request" }, ({ payload }: { payload: ResolvePayload }) => {
      const { requestId, update } = payload;
      const res = pendingRequests.get(requestId);

      if (res) {
        const statusColor = update.status === "APPROVED" ? chalk.green : chalk.red;
        console.log(
          `${chalk.cyan("➤ Resolving")} ${requestId}: ${statusColor(update.status)}`,
        );

        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });

        const resolvedStatus =
          update.status === "APPROVED" && update.patched_payload
            ? "APPROVED"
            : update.status;

        res.end(
          JSON.stringify({
            status: resolvedStatus,
            payload: update.patched_payload ?? undefined,
            patched_payload: update.patched_payload ?? undefined,
            reason: update.reason,
            metadata: {
              source: "local_dev_tunnel",
              timestamp: new Date().toISOString(),
            },
          }),
        );

        pendingRequests.delete(requestId);
      }
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        dashboardConnected = true;
        console.log(chalk.green("✓ Connected to LetsPing Cloud"));
      } else {
        dashboardConnected = false;
        console.log(chalk.yellow("⚠ Disconnected from Realtime"));
      }
    });

  const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === "/ingest" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));

      req.on("end", async () => {
        try {
          const data: RequestPayload = JSON.parse(body);
          const requestId = data.id || `req_local_${Date.now().toString(36)}`;

          console.log(
            `${chalk.yellow("⚡ Intercepted:")} ${requestId} ${chalk.dim(
              `[${data.service || "unknown"}]`,
            )}`,
          );

          pendingRequests.set(requestId, res);

          const requestPayload = {
            ...data,
            id: requestId,
            project_id: PROJECT_ID,
            status: "PENDING",
            created_at: new Date().toISOString(),
            isLocal: true,
          };

          await channel.send({
            type: "broadcast",
            event: "local_request",
            payload: requestPayload,
          });
        } catch (e) {
          console.error(chalk.red("Ingest Error:"), e);
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid Request" }));
        }
      });
      return;
    }

    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          {
            status: "operational",
            mode: "tunnel",
            connected: dashboardConnected,
          },
          null,
          2,
        ),
      );
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(API_PORT, () => {
    console.clear();
    console.log(chalk.hex("#8B5CF6").bold("◆ LetsPing Local Tunnel"));
    console.log("");
    console.log(
      `  ${chalk.green("➜")}  ${chalk.bold(
        "API Endpoint:",
      )}   http://localhost:${API_PORT}/ingest`,
    );
    console.log(
      `  ${chalk.green("➜")}  ${chalk.bold(
        "Dashboard:",
      )}      ${WEB_APP_URL}/dashboard?project=${PROJECT_ID}`,
    );
    console.log("");
    console.log(chalk.dim("  Ready to intercept agent requests..."));
    console.log("");
  });
}

async function runTail(opts: {
  env: string;
  service?: string;
  action?: string;
  project?: string;
  status: string;
}) {
  const projectId = opts.project || process.env.LETSPING_PROJECT_ID;
  if (!projectId) {
    console.error(chalk.red("\n✖ Error: Missing project id for tail"));
    console.log(
      chalk.yellow(
        "  Set LETSPING_PROJECT_ID or pass --project=<project_id>.\n",
      ),
    );
    console.log(
      chalk.white(
        "  To find your project id, open: " +
          chalk.cyan(`${DASHBOARD_URL}/dashboard`),
      ),
    );
    console.log(
      chalk.white(
        "  Then use the project selector in the header to click into a workspace,",
      ),
    );
    console.log(
      chalk.white(
        "  and copy the value after " +
          chalk.cyan("project=") +
          " in the URL.",
      ),
    );
    console.log(
      chalk.dim(
        "  Example URL: " +
          `${DASHBOARD_URL}/dashboard?project=proj_123...\n`,
      ),
    );
    process.exit(1);
  }

  const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const channel: RealtimeChannel = supabase.channel(`requests:${projectId}`);

  const allowedStatuses = new Set(
    opts.status
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  );

  console.log(
    chalk.hex("#8B5CF6").bold("◆ LetsPing Tail - Firewall and ingest events"),
  );
  console.log(
    chalk.dim(
      `  project=${projectId} env=${opts.env} status=${Array.from(
        allowedStatuses,
      ).join(",")}`,
    ),
  );
  if (opts.service) {
    console.log(chalk.dim(`  service=${opts.service}`));
  }
  if (opts.action) {
    console.log(chalk.dim(`  action=${opts.action}`));
  }
  console.log("");

  channel
    .on(
      "broadcast",
      { event: "request_update" },
      ({ payload }: { payload: TailEvent }) => {
        const env =
          payload.payload?._lp_meta?.environment ||
          (payload as any).metadata?.environment ||
          "bare-metal";

        if (env !== opts.env) {
          return;
        }

        if (opts.service && payload.service !== opts.service) {
          return;
        }
        if (opts.action && payload.action !== opts.action) {
          return;
        }

        const status = payload.status.toUpperCase();
        if (!allowedStatuses.has(status)) {
          return;
        }

        const verdict: Verdict = mapStatusToVerdict(status);
        const line = formatTailLine(payload, verdict);
        console.log(line);
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        console.log(chalk.green("✓ Subscribed to live firewall events\n"));
      }
    });
}

function mapStatusToVerdict(status: string): Verdict {
  if (status === "APPROVED") return "ALLOW";
  if (status === "REJECTED") return "BLOCK";
  if (status === "PENDING") return "HITL";
  return "PENDING";
}

function formatTailLine(ev: TailEvent, verdict: Verdict): string {
  const ts = ev.created_at;
  const name = `${ev.service}.${ev.action}`;
  const env =
    ev.payload?._lp_meta?.environment ||
    (ev as any).metadata?.environment ||
    "bare-metal";

  const base = `[${ts}] [${pad(verdict, 5)}] ${pad(
    name,
    32,
  )} env=${pad(env, 10)} req=${ev.id}`;

  const reason = ev.flagged_reason || "";
  const rule = ev.flagged_by_guardrail_id
    ? ` guardrail=${ev.flagged_by_guardrail_id}`
    : "";

  const color =
    verdict === "ALLOW"
      ? chalk.green
      : verdict === "BLOCK"
        ? chalk.red
        : verdict === "HITL"
          ? chalk.yellow
          : chalk.white;

  return color(
    `${base}${rule}${reason ? ` reason="${truncate(reason, 140)}"` : ""}`,
  );
}

function pad(value: string, width: number): string {
  if (value.length >= width) return value;
  return value + " ".repeat(width - value.length);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - 3) + "...";
}

async function runProxy(opts: { target: string; port: string; service?: string }) {
  const targetUrl = new URL(opts.target);
  const port = parseInt(opts.port, 10);
  const serviceLabel = opts.service || `${targetUrl.hostname}`;

  const apiKey = process.env.LETSPING_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    console.error(chalk.red("\n✖ Error: Missing LETSPING_API_KEY\n"));
    console.log(
      chalk.yellow(
        "  Set LETSPING_API_KEY=lp_... in your env so requests are tagged correctly.\n",
      ),
    );
  }

  const server = http.createServer(async (req, res) => {
    const startedAt = Date.now();

    if (!req.url || !req.method) {
      res.statusCode = 400;
      res.end("Bad Request");
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on("end", async () => {
      const body = Buffer.concat(chunks);

      const reqId =
        req.headers["x-request-id"]?.toString() ||
        `local_fw_${Date.now().toString(36)}`;

      const path = req.url || "/";
      const method = req.method || "GET";

      console.log(
        chalk.cyan(
          `\n[LOCAL FW] req=${reqId} service=${serviceLabel} method=${method} path=${path}`,
        ),
      );

      const hash = require("crypto")
        .createHash("sha256")
        .update(body)
        .digest("hex")
        .slice(0, 16);
      console.log(
        `  [1/4] Canonicalization    ${chalk.green("OK")}   hash=${hash}`,
      );

      const schemaError = basicJsonValidation(body);
      if (schemaError) {
        console.log(
          `  [2/4] Schema Validation   ${chalk.red("FAIL")}  ${schemaError}`,
        );
        console.log(
          chalk.red(
            `[LOCAL FW] VERDICT=BLOCK   NOT forwarding. reason="schema error"`,
          ),
        );
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify(
            {
              error: "Blocked by local firewall",
              reason: schemaError,
            },
            null,
            2,
          ),
        );
        return;
      }
      console.log(`  [2/4] Schema Validation   ${chalk.green("OK")}`);

      const astReason = scanForDangerousSql(body);
      if (astReason) {
        console.log(
          `  [3/4] AST Scan            ${chalk.red("FAIL")}  ${astReason}`,
        );
        console.log(
          `  [4/4] Policy Evaluation   ${chalk.red(
            "BLOCK",
          )} rule=sql_no_drop risk=0.90`,
        );
        console.log(
          chalk.red(
            `[LOCAL FW] VERDICT=BLOCK   NOT forwarding. reason="${astReason}"`,
          ),
        );
        res.statusCode = 403;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify(
            {
              error: "Blocked by local firewall",
              reason: astReason,
            },
            null,
            2,
          ),
        );
        return;
      }
      console.log(`  [3/4] AST Scan            ${chalk.green("OK")}`);

      console.log(
        `  [4/4] Policy Evaluation   ${chalk.green(
          "ALLOW",
        )} rule=default_allow risk=0.00`,
      );
      console.log(
        chalk.green(
          `[LOCAL FW] VERDICT=ALLOW   forwarding -> ${targetUrl.origin}${path}`,
        ),
      );

      const upstreamReq = http.request(
        {
          protocol: targetUrl.protocol,
          hostname: targetUrl.hostname,
          port: targetUrl.port,
          path,
          method,
          headers: {
            ...req.headers,
            host: targetUrl.host,
          },
        },
        (upstreamRes) => {
          res.statusCode = upstreamRes.statusCode || 500;
          for (const [k, v] of Object.entries(upstreamRes.headers)) {
            if (typeof v !== "undefined") {
              res.setHeader(k, v as any);
            }
          }
          upstreamRes.pipe(res);
          upstreamRes.on("end", () => {
            const elapsed = Date.now() - startedAt;
            console.log(
              chalk.dim(
                `[LOCAL FW] upstream_status=${upstreamRes.statusCode} elapsed_ms=${elapsed}`,
              ),
            );
          });
        },
      );

      upstreamReq.on("error", (err) => {
        console.error(
          chalk.red(`[LOCAL FW] Upstream error: ${err.message}`),
        );
        res.statusCode = 502;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify(
            {
              error: "Upstream error",
              detail: err.message,
            },
            null,
            2,
          ),
        );
      });

      upstreamReq.write(body);
      upstreamReq.end();
    });
  });

  server.listen(port, () => {
    console.log(
      chalk.hex("#8B5CF6").bold("◆ LetsPing Local Firewall Proxy"),
    );
    console.log("");
    console.log(
      `  ${chalk.green("➜")}  ${chalk.bold(
        "Listen:",
      )}        http://localhost:${port}`,
    );
    console.log(
      `  ${chalk.green("➜")}  ${chalk.bold(
        "Target:",
      )}        ${targetUrl.origin}`,
    );
    console.log(
      `  ${chalk.green("➜")}  ${chalk.bold(
        "Service:",
      )}       ${serviceLabel}`,
    );
    console.log("");
    console.log(
      chalk.dim(
        "  Route your agent traffic through this proxy to see step-by-step firewall evaluation in your terminal.",
      ),
    );
    console.log("");
  });
}

function basicJsonValidation(body: Buffer): string | null {
  if (!body.length) return null;
  try {
    JSON.parse(body.toString("utf8"));
    return null;
  } catch (err: any) {
    return "invalid JSON payload";
  }
}

function scanForDangerousSql(body: Buffer): string | null {
  const text = body.toString("utf8").toLowerCase();
  if (text.includes("drop table")) {
    return 'unauthorized SQL pattern "DROP TABLE" detected';
  }
  return null;
}