FROM quay.io/crowdstrike/falcon-mcp:latest

COPY falcon_mcp/docker-entrypoint.sh /tmp/docker-entrypoint-secrets.sh

ENTRYPOINT ["/bin/sh", "/tmp/docker-entrypoint-secrets.sh"]
