import http, { IncomingMessage, ServerResponse } from 'http';
import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { Command } from 'commander';
import chalk from 'chalk';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = "https://tqphlqmmamdjoufqnnka.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxcGhscW1tYW1kam91ZnFubmthIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxMjIzNjksImV4cCI6MjA4NDY5ODM2OX0.N3EU5ovNeeh6pkJsi_emHuMFm5vAguC3qR0S4Qq5K14";
const WEB_APP_URL = process.env.LETSPING_DASHBOARD_URL || "https://letsping.co";
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
  .version('0.1.0');

program
  .command('dev')
  .description('Start the local development tunnel')
  .action(async () => {
    runDevTunnel();
  });

program.parse(process.argv);

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

        res.end(JSON.stringify({
          status: update.status,
          payload: update.patched_payload || undefined,
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