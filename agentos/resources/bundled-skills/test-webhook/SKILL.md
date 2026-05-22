---
name: test-webhook
description: Test how an automation job processes a webhook event by enqueuing a sample payload through the real queue pipeline
metadata:
  agentos:
    emoji: "🪝"
---

# Test Webhook Skill

Use the `test_webhook` MCP tool (via `agentos-thread`) to enqueue a sample payload for a webhook-triggered automation job and observe how the agent processes it.

Steps:
1. Identify the automation job ID you want to test (must have `trigger.kind === 'webhook'`)
2. Construct a sample payload matching the expected source format (GitHub push event, Stripe webhook, Slack event, etc.)
3. Call `test_webhook` with `job_id` and `payload`
4. The event is written to disk and DB with status `pending`, then processed asynchronously
5. Monitor the resulting agent thread — the payload appears as `[Webhook payload: ...]` context before the job instructions

The test event flows through the identical pipeline as a real inbound webhook, so behavior in the test thread mirrors production exactly.
