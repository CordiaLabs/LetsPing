# @letsping/cli

Official command-line interface for [LetsPing](https://letsping.co).

This tool creates a secure bidirectional tunnel between your local development environment and the LetsPing cloud dashboard. It enables real-time human-in-the-loop approval of agent actions running on `localhost` without requiring public deployment.

## Quick Start

Run the tunnel using `npx` (recommended – no global installation needed):

```bash
npx @letsping/cli dev
```

## Required Configuration

Place a `.env` file in the directory where you run the CLI:

```env
# Required
LETSPING_PROJECT_ID=proj_xxxxxxxxxxxx
```

## Optional Configuration

```env
# Change local listening port (default: 3005)
LETSPING_PORT=4000
```

## Development Workflow

1. **Start your local application/agent**  
   Configure your LetsPing SDK (or direct HTTP calls) to send approval requests to the local ingestion endpoint.

2. **Start the tunnel**  
   In a separate terminal:

   ```bash
   npx @letsping/cli dev
   ```

3. **Look for the startup message**  
   You should see output similar to:

   ```
   ◆ LetsPing Local Tunnel
   ➜  API Endpoint:   http://localhost:3005/ingest
   ➜  Dashboard:      https://letsping.co/dashboard?project=proj_xxxxxxxxxxxx
   ```

4. **Send a test request**  
   Direct your SDK or HTTP client to:

   ```
   POST http://localhost:3005/ingest
   ```

   The request will appear almost instantly in your LetsPing dashboard under the **Localhost** environment.

## Important Notes

- The ingestion endpoint is **`http://localhost:<port>/ingest`**  
  Sending requests to the root path (`/`) will return 404.

- Use **POST** requests with JSON payload matching the LetsPing request format.

- The tunnel automatically reconnects on network interruptions.
### How the local tunnel keeps everything secure & private

The CLI does **not** expose any endpoint to the public internet.

- Your agent sends approval requests **only to `http://localhost:<port>/ingest`** (loopback interface).
- The CLI receives these requests locally and forwards them **outbound** over a secure WebSocket tunnel to LetsPing cloud.
- All traffic flows **from your machine → LetsPing** (no inbound connections are accepted).
- The dashboard shows requests under the **Localhost** environment for easy testing.
- When a human approves/rejects, the decision travels **back through the tunnel** to your waiting agent.

This architecture means:
- No firewall changes needed
- No public URL is ever created
- Works behind NAT, corporate proxies, etc.

## Troubleshooting

| Problem                            | Likely Cause / Solution                                                                 |
|:-----------------------------------|:----------------------------------------------------------------------------------------|
| `Missing LETSPING_PROJECT_ID`      | No `.env` file in current directory or missing/invalid `LETSPING_PROJECT_ID` value     |
| Port 3005 already in use           | Set `LETSPING_PORT=xxxx` in `.env` or kill the occupying process                       |
| Requests not appearing in dashboard| • Using wrong endpoint (`/` instead of `/ingest`)<br>• Wrong project ID<br>• Firewall blocking websocket |
| 404 Not Found                      | Sending to root URL instead of `/ingest`                                               |
| Tunnel disconnects frequently      | Unstable network – the CLI includes automatic reconnection logic                       |

For full documentation and request format specification, visit:  
https://www.letsping.co/docs#local-dev

Happy local developing!