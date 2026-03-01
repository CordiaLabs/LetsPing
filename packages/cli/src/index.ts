import http, { IncomingMessage, ServerResponse } from 'http';
import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { Command } from 'commander';
import chalk from 'chalk';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.LETSPING_SUPABASE_URL || "https://tqphlqmmamdjoufqnnka.supabase.co";
const SUPABASE_ANON_KEY = process.env.LETSPING_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxcGhscW1tYW1kam91ZnFubmthIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxMjIzNjksImV4cCI6MjA4NDY5ODM2OX0.N3EU5ovNeeh6pkJsi_emHuMFm5vAguC3qR0S4Qq5K14";
const WEB_APP_URL = process.env.LETSPING_DASHBOARD_URL || "https://letsping.co";

let CLI_VERSION = "0.2.0";
try { CLI_VERSION = require("../package.json").version; } catch { }
interface RequestPayload {
  id?: string;
  service?: string;
  [key: string]: any;
}

interface ResolveUpdate {
  status: 'APPROVED' | 'REJECTED';
  patched_payload?: any;
  reason?: string;
}

interface ResolvePayload {
  requestId: string;
  update: ResolveUpdate;
}

const program = new Command();

program
  .name('letsping')
  .description('CLI for LetsPing.co - The Human-in-the-Loop Control Plane')
  .version(CLI_VERSION);

program
  .command('dev')
  .description('Start the local development tunnel')
  .action(async () => {
    runDevTunnel();
  });

program
  .command('demo')
  .description('Send one approval request and open the dashboard (first-run demo)')
  .option('-b, --base-url <url>', 'API base URL (default: https://letsping.co/api)')
  .action(async (opts: { baseUrl?: string }) => {
    await runDemo(opts.baseUrl);
  });

program.parse(process.argv);

const DASHBOARD_URL = process.env.LETSPING_DASHBOARD_URL || "https://letsping.co";

async function runDemo(baseUrl?: string) {
  const apiKey = process.env.LETSPING_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    console.log(chalk.yellow("\n  No API key found.\n"));
    console.log(chalk.white("  1. Get your key: " + chalk.cyan(DASHBOARD_URL + "/login")));
    console.log(chalk.white("  2. Create a workspace, then go to Settings → Developers → Create API key"));
    console.log(chalk.white("  3. Run: " + chalk.cyan("export LETSPING_API_KEY=lp_...") + " (or set in .env)"));
    console.log(chalk.white("  4. Run " + chalk.cyan("letsping demo") + " again.\n"));
    process.exit(1);
  }

  console.log(chalk.hex("#8B5CF6").bold("\n◆ LetsPing first-run demo\n"));
  console.log(chalk.dim("  Sending one approval request. You’ll see it in the dashboard.\n"));

  try {
    const { LetsPing } = await import("@letsping/sdk");
    const lp = new LetsPing(apiKey, { baseUrl: baseUrl ? baseUrl.replace(/\/?$/, "") + "/api" : undefined });
    const decision = await lp.ask({
      service: "demo-agent",
      action: "transfer_funds",
      payload: { amount: 100, reason: "First-run demo from letsping demo" },
      priority: "high",
      timeoutMs: 120_000,
    });

    if (decision.status === "APPROVED") {
      console.log(chalk.green("  ✓ Approved. Execution would resume with the payload.\n"));
    } else {
      console.log(chalk.yellow("  → " + (decision.status || "REJECTED") + ". Request was not approved.\n"));
    }
  } catch (err: any) {
    if (err.message?.includes("402")) {
      console.log(chalk.yellow("  Quota or billing limit (402). Upgrade or add payment in the dashboard.\n"));
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
  const API_PORT = parseInt(process.env.LETSPING_PORT || '3005', 10);

  if (!PROJECT_ID) {
    console.error(chalk.red('\n✖ Error: Missing LETSPING_PROJECT_ID'));
    console.log(chalk.yellow('  Please create a .env file with your project ID.'));
    console.log(chalk.dim('  Example: LETSPING_PROJECT_ID=proj_123\n'));
    process.exit(1);
  }

  const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const pendingRequests = new Map<string, ServerResponse>();
  let dashboardConnected = false;
  const channel: RealtimeChannel = supabase.channel(`project:${PROJECT_ID}`);

  channel
    .on('broadcast', { event: 'resolve_local_request' }, ({ payload }: { payload: ResolvePayload }) => {
      const { requestId, update } = payload;
      const res = pendingRequests.get(requestId);

      if (res) {
        const statusColor = update.status === 'APPROVED' ? chalk.green : chalk.red;
        console.log(`${chalk.cyan('➤ Resolving')} ${requestId}: ${statusColor(update.status)}`);

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });

        const resolvedStatus = update.status === 'APPROVED' && update.patched_payload
          ? 'APPROVED'
          : update.status;

        res.end(JSON.stringify({
          status: resolvedStatus,
          payload: update.patched_payload ?? undefined,
          patched_payload: update.patched_payload ?? undefined,
          reason: update.reason,
          metadata: { source: 'local_dev_tunnel', timestamp: new Date().toISOString() }
        }));

        pendingRequests.delete(requestId);
      }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        dashboardConnected = true;
        console.log(chalk.green('✓ Connected to LetsPing Cloud'));
      } else {
        dashboardConnected = false;
        console.log(chalk.yellow('⚠ Disconnected from Realtime'));
      }
    });

  const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === '/ingest' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => body += chunk);

      req.on('end', async () => {
        try {
          const data: RequestPayload = JSON.parse(body);
          const requestId = data.id || `req_local_${Date.now().toString(36)}`;

          console.log(`${chalk.yellow('⚡ Intercepted:')} ${requestId} ${chalk.dim(`[${data.service || 'unknown'}]`)}`);

          pendingRequests.set(requestId, res);

          const requestPayload = {
            ...data,
            id: requestId,
            project_id: PROJECT_ID,
            status: 'PENDING',
            created_at: new Date().toISOString(),
            isLocal: true
          };

          await channel.send({
            type: 'broadcast',
            event: 'local_request',
            payload: requestPayload
          });

        } catch (e) {
          console.error(chalk.red('Ingest Error:'), e);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid Request' }));
        }
      });
      return;
    }

    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'operational',
        mode: 'tunnel',
        connected: dashboardConnected
      }, null, 2));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(API_PORT, () => {
    console.clear();
    console.log(chalk.hex('#8B5CF6').bold('◆ LetsPing Local Tunnel'));
    console.log('');
    console.log(`  ${chalk.green('➜')}  ${chalk.bold('API Endpoint:')}   http://localhost:${API_PORT}/ingest`);
    console.log(`  ${chalk.green('➜')}  ${chalk.bold('Dashboard:')}      ${WEB_APP_URL}/dashboard?project=${PROJECT_ID}`);
    console.log('');
    console.log(chalk.dim('  Ready to intercept agent requests...'));
    console.log('');
  });
}