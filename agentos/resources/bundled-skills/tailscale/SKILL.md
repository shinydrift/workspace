---
name: tailscale
description: Use Tailscale networking, serve, and funnel inside AgentOS sandbox containers
metadata:
  agentos:
    emoji: "🔗"
    requires:
      bins: ["tailscale"]
---

# Tailscale Skill

Tailscale is pre-installed in the AgentOS sandbox. Use `$TS_SOCKET` for all `tailscale` CLI calls.

## Environment

- `TS_SOCKET` – path to the tailscaled socket (always set by the sandbox)
- Tailscale auto-starts at container boot when `TS_AUTHKEY` env var is present

## Starting tailscaled manually

Only needed if `TS_AUTHKEY` was not set at container start:

```bash
mkdir -p /tmp/tailscale-state /tmp/tailscale-run
tailscaled --tun=userspace-networking \
  --statedir=/tmp/tailscale-state \
  --socket=/tmp/tailscale-run/tailscaled.sock \
  >/tmp/tailscale.log 2>&1 &

# Wait for socket (up to 5s)
for i in $(seq 1 10); do [ -S "$TS_SOCKET" ] && break; sleep 0.5; done
```

## Authentication

```bash
tailscale --socket="$TS_SOCKET" up --authkey="$TS_AUTHKEY" --hostname=agentos-agent
```

## Serve and Funnel

**Always wrap `serve --bg` and `funnel --bg` with `timeout` — they can hang indefinitely if Tailscale is not fully ready:**

```bash
# Expose a local port over Tailscale network (private)
timeout 15 tailscale --socket="$TS_SOCKET" serve --bg http://localhost:8080

# Expose publicly over HTTPS via Tailscale Funnel
timeout 15 tailscale --socket="$TS_SOCKET" funnel --bg 8080
```

Get the public URL after enabling funnel:

```bash
tailscale --socket="$TS_SOCKET" status --json \
  | python3 -c "import json,sys; s=json.load(sys.stdin); print('https://'+s['Self']['DNSName'].rstrip('.'))"
```
