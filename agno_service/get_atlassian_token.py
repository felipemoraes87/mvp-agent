"""
Gera um access_token OAuth 2.1 para o Atlassian Remote MCP Server.

Uso:
    python get_atlassian_token.py --client-id <ID> --client-secret <SECRET>

O script:
  1. Abre o browser na URL de autorização Atlassian
  2. Aguarda o callback em http://localhost:8080/callback
  3. Troca o code pelo access_token + refresh_token
  4. Imprime os valores para colocar no .env
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import http.server
import json
import os
import secrets
import threading
import urllib.parse
import urllib.request
import webbrowser

ATLASSIAN_AUTH_URL = "https://auth.atlassian.com/authorize"
ATLASSIAN_TOKEN_URL = "https://auth.atlassian.com/oauth/token"
REDIRECT_URI = "http://localhost:8080/callback"

# Escopos necessários para Jira + Confluence + Compass via MCP
SCOPES = " ".join([
    "read:jira-work",
    "read:jira-user",
    "write:jira-work",
    "read:confluence-content.all",
    "read:confluence-space.summary",
    "read:confluence-user",
    "read:compass-component",
    "offline_access",   # necessário para receber refresh_token
])


def _pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return verifier, challenge


def _build_auth_url(client_id: str, state: str, challenge: str) -> str:
    params = {
        "audience": "api.atlassian.com",
        "client_id": client_id,
        "scope": SCOPES,
        "redirect_uri": REDIRECT_URI,
        "state": state,
        "response_type": "code",
        "prompt": "consent",
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    return ATLASSIAN_AUTH_URL + "?" + urllib.parse.urlencode(params)


def _exchange_code(
    code: str,
    verifier: str,
    client_id: str,
    client_secret: str,
) -> dict:
    body = json.dumps({
        "grant_type": "authorization_code",
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "code_verifier": verifier,
    }).encode()
    req = urllib.request.Request(
        ATLASSIAN_TOKEN_URL,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def main() -> None:
    parser = argparse.ArgumentParser(description="Gera token OAuth 2.1 Atlassian")
    parser.add_argument("--client-id", required=True)
    parser.add_argument("--client-secret", required=True)
    args = parser.parse_args()

    state = secrets.token_urlsafe(16)
    verifier, challenge = _pkce_pair()
    auth_url = _build_auth_url(args.client_id, state, challenge)

    captured: dict = {}
    server_ready = threading.Event()
    server_done = threading.Event()

    class CallbackHandler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path == "/callback":
                params = urllib.parse.parse_qs(parsed.query)
                captured["code"] = params.get("code", [None])[0]
                captured["state"] = params.get("state", [None])[0]
                captured["error"] = params.get("error", [None])[0]
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(b"<h2>Autorizado! Pode fechar esta aba.</h2>")
                server_done.set()

    httpd = http.server.HTTPServer(("localhost", 8080), CallbackHandler)
    server_ready.set()

    def serve():
        httpd.handle_request()

    t = threading.Thread(target=serve, daemon=True)
    t.start()

    print(f"\nAbrindo browser para autorização Atlassian...\n{auth_url}\n")
    webbrowser.open(auth_url)

    server_done.wait(timeout=120)
    httpd.server_close()

    if captured.get("error"):
        print(f"Erro na autorização: {captured['error']}")
        return

    if captured.get("state") != state:
        print("Erro: state inválido (possível CSRF)")
        return

    code = captured.get("code")
    if not code:
        print("Erro: nenhum code recebido")
        return

    print("Code recebido, trocando por token...")
    try:
        tokens = _exchange_code(code, verifier, args.client_id, args.client_secret)
    except Exception as e:
        print(f"Erro ao trocar code por token: {e}")
        return

    access_token = tokens.get("access_token", "")
    refresh_token = tokens.get("refresh_token", "")
    expires_in = tokens.get("expires_in", "?")
    scope = tokens.get("scope", "")

    print("\n" + "=" * 60)
    print("TOKEN GERADO COM SUCESSO")
    print("=" * 60)
    print(f"\nExpira em: {expires_in}s (~{int(expires_in)//3600}h)")
    print(f"Escopos concedidos: {scope}\n")
    print("Adicione ao seu .env:")
    print(f"\nATLASSIAN_MCP_TOKEN={access_token}")
    if refresh_token:
        print(f"\n# Guarde o refresh_token para renovar sem browser:")
        print(f"# ATLASSIAN_REFRESH_TOKEN={refresh_token}")
    print("=" * 60)


if __name__ == "__main__":
    main()
