# Abroo

> **Note**: Abroo is an **unofficial**, community-maintained [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for the [Liara](https://liara.ir) cloud platform. It is not affiliated with or endorsed by Liara.

Abroo lets AI assistants deploy, inspect, and manage your Liara infrastructure through natural language, and **diagnose broken apps** by turning logs, metrics, releases, and config into structured, evidence-backed findings.

## Features

- **Diagnose** — one read-only tool that checks an app's status, resources, logs, deployments, and config, and returns findings with evidence and suggested next steps ([details](#diagnose))
- **Apps** — create, deploy, start, stop, restart, resize, and delete apps across 14 platforms
- **Environment variables** — set, read, and delete variables (single or bulk)
- **Deployment** — upload sources, deploy releases, list releases, roll back
- **Databases** — lifecycle management, connection info, resize, and backup/restore for 8 database types
- **Object storage** — S3-compatible buckets, credentials, and objects
- **DNS and domains** — zones, records, and app domains
- **Disks** — create, resize, and manage FTP access
- **Mail servers** — lifecycle management and sending email
- **Virtual machines (IaaS)** — VM lifecycle, snapshots, and network attachment
- **Networks** — create and manage networks for VMs
- **Observability** — app metrics and logs
- **Plans and user** — browse resource plans and account info

**Platforms:** Node.js, Next.js, Laravel, PHP, Django, Flask, .NET, Static, React, Angular, Vue, Docker, Python, Go

**Databases:** MariaDB, MySQL, PostgreSQL, MSSQL, MongoDB, Redis, Elasticsearch, RabbitMQ

## Diagnose

`liara_diagnose_app` collects everything it needs once (app info, plan, metrics, recent logs, releases, env var keys) and runs a set of rule-based analyzers over it. The assistant then explains the findings in plain language instead of guessing from raw logs.

| Check | What it looks for |
| --- | --- |
| `status` | App stopped/failed, read-only mode |
| `resources` | CPU and memory pressure (warning at 85%, critical at 95% of plan limits) |
| `logs` | Known failure patterns: out-of-memory, missing modules, port conflicts, DB auth failures, connection refused, DNS failures, disk full, timeouts, crashes, probable restart loops |
| `deployment` | Failed latest release, and error spikes in a window containing a recent release |
| `config` | Important env vars that are empty, or values that still look like placeholders |

**Parameters**

| Name | Required | Description |
| --- | --- | --- |
| `appName` | yes | Name of the app |
| `checks` | no | Subset of checks to run (default: all) |
| `since` | no | Look-back window such as `30m`, `1h`, `6h`, `1d` (default `1h`, max `7d`) |
| `redact` | no | Mask secrets in the output (default `true`) |

**Design principles**

- **Read-only.** Diagnose never changes anything. Suggested tools (e.g. `liara_rollback_release`) are suggestions only, and the assistant should get your confirmation before running them.
- **Evidence, not verdicts.** Every finding carries redacted evidence, and is marked `observed` (seen directly in the data) or `hypothesis` (a guess about the cause that should be confirmed first).
- **Secrets stay out.** Logs are masked by pattern (private keys, JWTs, bearer tokens, credentials in URLs, `password=`/`token=`-style values). Environment variable *values* are only inspected locally and never appear in findings.
- **Honest about gaps.** The overall status is `critical`, `degraded`, `healthy`, or `unknown`. If a dataset could not be collected or an analyzer failed, the result is never reported as `healthy`, and the report says what was missing.
- **Sampling is disclosed.** Logs are sampled (up to 500 lines), and the report flags when the window was probably truncated. A clean result does not prove the app is healthy, since checks only cover known patterns.
- **Extensible.** Add a new analyzer by creating a file in `src/diagnose/analyzers/` and registering it in `src/diagnose/registry.ts`.

Diagnose is available in both tool modes.

## Installation

```bash
npm install -g abroo
```

Or run it directly with `npx` (no installation required).

## Configuration

Abroo is configured through environment variables.

| Variable | Required | Description |
| --- | --- | --- |
| `LIARA_API_TOKEN` | yes | Your Liara API token |
| `LIARA_TEAM_ID` | no | Team ID, when working with a team account |
| `LIARA_API_BASE_URL` | no | API base URL (default `https://api.iran.liara.ir`) |
| `LIARA_MCP_CONSOLIDATED` | no | Set to `true` to enable [consolidated tool mode](#tool-modes) |

You can set them in your MCP client configuration (recommended), or in a `.env` file for local development:

```bash
cp .env.example .env
```

```
LIARA_API_TOKEN=your_api_token_here
LIARA_TEAM_ID=optional_team_id
LIARA_API_BASE_URL=https://api.iran.liara.ir
```

### Getting your API token

1. Open the [API section](https://console.liara.ir/API) of the Liara Console.
2. Choose an expiration (1 hour, 1 day, 7 days, 1 month, 6 months, or 1 year).
3. Click "Create new key" (ساخت کلید جدید).
4. Copy the token right away. It is only shown once.

If you work with a team account, the Team ID is shown in the API section when viewing your team.

## Usage

### Claude Desktop / Cursor / VS Code

Add Abroo to your MCP configuration file:

- **Claude Desktop:** `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows)
- **Cursor:** `.cursor/mcp.json`

```json
{
  "mcpServers": {
    "abroo": {
      "command": "npx",
      "args": ["-y", "abroo"],
      "env": {
        "LIARA_API_TOKEN": "your_api_token_here"
      }
    }
  }
}
```

### nvm / fnm users

Many editors start MCP servers without your shell's PATH, which causes errors like:

```
Error: failed to create mcp stdio client: exec: "npx": executable file not found in $PATH
spawn npx ENOENT
```

If you manage Node.js with nvm or fnm, wrap the command in a shell that loads your environment first.

**nvm:**

```json
{
  "mcpServers": {
    "abroo": {
      "command": "/bin/zsh",
      "args": ["-c", "source ~/.nvm/nvm.sh && npx -y abroo"],
      "env": {
        "LIARA_API_TOKEN": "your_api_token_here"
      }
    }
  }
}
```

**fnm:**

```json
{
  "mcpServers": {
    "abroo": {
      "command": "/bin/zsh",
      "args": ["-c", "eval \"$(fnm env --use-on-cd --shell zsh)\" && npx -y abroo"],
      "env": {
        "LIARA_API_TOKEN": "your_api_token_here"
      }
    }
  }
}
```

For bash, replace `/bin/zsh` with `/bin/bash`. If you installed Node.js with a system package manager or the official installer, the basic configuration is enough.

## Tool modes

Abroo exposes its tools in one of two modes.

### Individual mode (default)

109 granular tools, one per operation, for maximum control. See [Available tools](#available-tools).

### Consolidated mode

Set `LIARA_MCP_CONSOLIDATED=true` to get 9 tools instead. Each one takes an `action` parameter, which means fewer tools for the model to choose from and fewer calls for multi-step work.

| Tool | Actions |
| --- | --- |
| `liara_manage_app` | `list`, `get`, `create`, `delete`, `start`, `stop`, `restart`, `resize` |
| `liara_manage_env_vars` | `list`, `set`, `set_multiple`, `delete`, `delete_multiple` |
| `liara_manage_databases` | `list`, `get`, `get_connection`, `create`, `delete`, `start`, `stop`, `restart`, `resize`, `update` |
| `liara_manage_database_backups` | `create`, `list`, `get_download_url`, `restore`, `delete` |
| `liara_manage_buckets` | `list`, `get`, `create`, `delete`, `get_credentials` |
| `liara_manage_bucket_objects` | `list`, `upload`, `get_download_url`, `delete` |
| `liara_manage_deployment` | `list_releases`, `list_sources` |
| `liara_get_infrastructure_overview` | Overview of all resources |
| `liara_diagnose_app` | See [Diagnose](#diagnose) |

Consolidated mode covers apps, env vars, databases, backups, buckets, deployment listing, and diagnosis. For everything else (DNS, domains, disks, mail, VMs, networks, and so on), use individual mode.

## Available tools

These are the tools in individual mode.

**Diagnose**
`liara_diagnose_app`

**Apps**
`liara_list_apps`, `liara_get_app`, `liara_create_app`, `liara_delete_app`, `liara_start_app`, `liara_stop_app`, `liara_restart_app`, `liara_resize_app`

**Environment variables**
`liara_get_env_vars`, `liara_set_env_var`, `liara_set_env_vars`, `liara_delete_env_var`, `liara_delete_env_vars`

**App settings**
`liara_set_zero_downtime`, `liara_set_default_subdomain`, `liara_set_fixed_ip`, `liara_set_read_only`

**Deployment**
`liara_upload_source`, `liara_deploy_release`, `liara_list_releases`, `liara_get_release`, `liara_rollback_release`, `liara_list_sources`, `liara_delete_source`

**Databases**
`liara_list_databases`, `liara_get_database`, `liara_get_database_connection`, `liara_create_database`, `liara_update_database`, `liara_resize_database`, `liara_delete_database`, `liara_start_database`, `liara_stop_database`, `liara_restart_database`, `liara_create_backup`, `liara_list_backups`, `liara_get_backup_download_url`, `liara_restore_backup`, `liara_delete_backup`

**Object storage**
`liara_list_buckets`, `liara_get_bucket`, `liara_create_bucket`, `liara_delete_bucket`, `liara_get_bucket_credentials`, `liara_list_objects`, `liara_upload_object`, `liara_get_object_download_url`, `liara_delete_object`

**Disks**
`liara_list_disks`, `liara_get_disk`, `liara_create_disk`, `liara_resize_disk`, `liara_delete_disk`, `liara_create_ftp_access`, `liara_list_ftp_accesses`, `liara_delete_ftp_access`

**DNS**
`liara_list_zones`, `liara_get_zone`, `liara_create_zone`, `liara_delete_zone`, `liara_list_dns_records`, `liara_get_dns_record`, `liara_create_dns_record`, `liara_update_dns_record`, `liara_delete_dns_record`

**Domains**
`liara_list_domains`, `liara_get_domain`, `liara_add_domain`, `liara_remove_domain`

**Mail servers**
`liara_list_mail_servers`, `liara_get_mail_server`, `liara_create_mail_server`, `liara_delete_mail_server`, `liara_start_mail_server`, `liara_stop_mail_server`, `liara_restart_mail_server`, `liara_send_email`

**Virtual machines (IaaS)**
`liara_list_vms`, `liara_get_vm`, `liara_create_vm`, `liara_start_vm`, `liara_stop_vm`, `liara_restart_vm`, `liara_resize_vm`, `liara_delete_vm`, `liara_create_snapshot`, `liara_list_snapshots`, `liara_restore_snapshot`, `liara_delete_snapshot`, `liara_attach_network`, `liara_detach_network`

**Networks**
`liara_list_networks`, `liara_get_network`, `liara_create_network`, `liara_delete_network`

**Observability**
`liara_get_metrics`, `liara_get_logs`

**Plans and user**
`liara_list_plans`, `liara_get_plan`, `liara_get_user`

## Examples

**Find out why an app is broken**

```
User: My app "my-api" keeps crashing. What's going on?
Assistant: [liara_diagnose_app]
  → critical: Out-of-memory errors (14×), first seen on release v7
  → warning: Probable restart loop (hypothesis, confirm first)
  Suggests resizing the plan, and asks before changing anything.
```

**Create and start an app**

```
User: Create a Node.js app called "my-api" on the basic plan
Assistant: [liara_create_app]

User: Set NODE_ENV to production
Assistant: [liara_set_env_var]

User: Start it
Assistant: [liara_start_app]
```

**Databases and backups**

```
User: Create a PostgreSQL database called "my-db" on the starter plan
Assistant: [liara_create_database]

User: Back it up, then give me the connection info
Assistant: [liara_create_backup, liara_get_database_connection]
```

**Storage**

```
User: Create a bucket called "my-files" and show me its S3 credentials
Assistant: [liara_create_bucket, liara_get_bucket_credentials]
```

## Safety notes

- Many tools are destructive (delete, resize, restore, rollback). Review what your assistant is about to run, and prefer clients that ask for confirmation on tool calls.
- Use the shortest token expiration that works for you, and keep tokens out of version control.
- Diagnose output is redacted by default. Only turn `redact` off when you need the raw text and trust where the output is going.

## Error handling

Errors come back as structured JSON with a code, a message, and, where possible, suggestions for fixing the problem. The client retries on rate limiting (429) and server errors (5xx) with exponential backoff. Typical cases include an invalid API token, missing or invalid parameters (such as app names and env var keys), resources that don't exist, and network failures.

## Development

```bash
npm run dev          # watch mode
npm run type-check   # type checking
npm run build        # build
npm run clean        # remove build artifacts
```

### Project structure

```
src/
├── index.ts               # MCP server entry point
├── api/
│   ├── client.ts          # Liara API client (auth, retries, errors)
│   └── types.ts           # API types
├── tools/                 # Tool definitions (individual + consolidated)
├── handlers/              # Tool call handlers
├── services/              # One module per Liara service
│   └── apps, databases, deployment, disks, dns, domains, environment,
│       iaas, mail, network, observability, plans, settings, storage, user
├── diagnose/              # Rule-based diagnosis engine
│   ├── analyzers/         # status, resources, logs, deployment, config
│   ├── collector.ts       # Gathers all data once for every analyzer
│   ├── registry.ts        # Registers analyzers
│   ├── runner.ts          # Runs analyzers, builds the report
│   ├── redact.ts          # Secret masking
│   └── types.ts
└── utils/
    └── errors.ts          # Error handling and validation
```

## Requirements

- Node.js >= 18
- A Liara API token

## Resources

- [Liara documentation](https://docs.liara.ir)
- [Liara API reference](https://openapi.liara.ir)
- [Liara Console](https://console.liara.ir)
- [Model Context Protocol](https://modelcontextprotocol.io)

## Disclaimer

Abroo is an **unofficial** implementation. It is not affiliated with, endorsed by, or supported by Liara, and is provided as-is without warranty. For official Liara support, contact [Liara Support](https://liara.ir).

## Contributing

Issues and pull requests are welcome.

## License

MIT
