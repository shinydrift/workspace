#!/bin/bash
set -e

# If a Tailscale auth key is provided, start tailscaled in userspace networking
# mode (no NET_ADMIN capability required) and authenticate before launching the agent.
if [ -n "$TS_AUTHKEY" ]; then
  mkdir -p /tmp/tailscale-state /tmp/tailscale-run
  tailscaled \
    --tun=userspace-networking \
    --statedir=/tmp/tailscale-state \
    --socket=/tmp/tailscale-run/tailscaled.sock \
    >/tmp/tailscale.log 2>&1 &

  # Wait for the socket to be ready (up to 5 s)
  for i in $(seq 1 10); do
    [ -S /tmp/tailscale-run/tailscaled.sock ] && break
    sleep 0.5
  done
  if [ ! -S /tmp/tailscale-run/tailscaled.sock ]; then
    echo "Warning: tailscaled socket did not appear after 5s; Tailscale may not be available" >&2
  fi

  tailscale \
    --socket=/tmp/tailscale-run/tailscaled.sock \
    up \
    --authkey="$TS_AUTHKEY" \
    --hostname="${TS_HOSTNAME:-agentos-agent}" \
    --accept-routes \
    >/tmp/tailscale-up.log 2>&1 || true

  # If a port is specified, enable Tailscale Funnel on that port and record the public URL
  if [ -n "$TS_FUNNEL_PORT" ]; then
    tailscale \
      --socket=/tmp/tailscale-run/tailscaled.sock \
      funnel \
      --bg \
      "$TS_FUNNEL_PORT" \
      >/tmp/tailscale-funnel.log 2>&1 || true

    FUNNEL_URL="https://${TS_HOSTNAME:-agentos-agent}.$(tailscale --socket=/tmp/tailscale-run/tailscaled.sock status --json 2>/dev/null | grep -o '"MagicDNSSuffix":"[^"]*"' | cut -d'"' -f4)"
    echo "$FUNNEL_URL" > /tmp/tailscale-url
    echo "Tailscale Funnel active: $FUNNEL_URL" >&2
  fi
fi

# Run the command in the background so we can trap signals and forward them.
# This ensures a graceful exit (code 0) when `docker stop` sends SIGTERM,
# rather than forcing Docker to escalate to SIGKILL (exit 137).
"$@" &
CHILD_PID=$!
trap 'kill "$CHILD_PID" 2>/dev/null; wait "$CHILD_PID" 2>/dev/null; exit 0' TERM INT
wait "$CHILD_PID"
