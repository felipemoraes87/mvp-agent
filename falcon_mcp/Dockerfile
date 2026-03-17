FROM quay.io/crowdstrike/falcon-mcp:latest

COPY --chmod=755 falcon_mcp/docker-entrypoint.sh /usr/local/bin/docker-entrypoint-secrets.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint-secrets.sh"]
