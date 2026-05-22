---
name: docker
description: Inspect, build, and manage local containers and images with Docker CLI
metadata:
  agentos:
    emoji: "🐳"
    requires:
      bins: ["docker"]
---

# Docker Skill

Use Docker CLI for container and image workflows.

- List containers: `docker ps -a`
- Inspect a container: `docker inspect <container>`
- Follow logs: `docker logs -f <container>`
- Build image: `docker build -t <name> .`

When debugging runtime issues, collect logs, exit code, and mount/network settings.
