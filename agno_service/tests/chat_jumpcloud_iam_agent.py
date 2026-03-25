"""
Chat interativo com o JumpCloud IAM Agent (modo debug / leitura).

Uso:
    python tests/chat_jumpcloud_iam_agent.py
    python tests/chat_jumpcloud_iam_agent.py "Quantos usuarios temos no JumpCloud?"

Requer as variaveis de ambiente do JumpCloud configuradas (ou secrets montados).
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from connectors import build_jumpcloud_skills_from_env
from connectors.jumpcloud_mcp import build_jumpcloud_mcp_config_from_env, build_jumpcloud_mcp_tools
from model_factory import build_agent_instance
from models import AdvancedOptions


AGENT_INSTRUCTIONS = [
    "Atue como especialista em JumpCloud IAM no modo somente leitura.",
    "Use apenas as ferramentas de leitura do JumpCloud: listagem de usuarios, grupos, dispositivos, aplicacoes e Directory Insights.",
    "Nunca execute operacoes de escrita, suspensao, reset de MFA ou alteracao de dados.",
    "Apresente dados factuais observados diretamente da API JumpCloud.",
    "Diferencie claramente: fatos observados, inferencias e lacunas de informacao.",
    "Nao mantenha contexto entre sessoes; trate cada chamada de forma independente.",
    "Para cada consulta, indique a fonte (endpoint ou ferramenta utilizada).",
]

ADVANCED = AdvancedOptions(
    reasoning=False,
    showToolCalls=True,
    addHistoryToContext=False,
    markdown=True,
)


async def _run_with_agent(message: str, stream: bool = True) -> None:
    mcp_config = build_jumpcloud_mcp_config_from_env()
    mcp_tools = build_jumpcloud_mcp_tools(mcp_config) if mcp_config.enabled else None

    skills = build_jumpcloud_skills_from_env()
    base_tools = skills.agno_tools() if skills else []

    if mcp_tools:
        print("[MCP] Usando JumpCloud MCP Server\n")
        async with mcp_tools:
            agent = build_agent_instance(
                name="JumpCloud IAM Agent",
                instructions=AGENT_INSTRUCTIONS,
                advanced=ADVANCED,
                tools=base_tools + [mcp_tools],
            )
            await agent.aprint_response(message, stream=stream)
    else:
        print("[SKILL] JumpCloud MCP indisponivel — usando skill layer\n")
        agent = build_agent_instance(
            name="JumpCloud IAM Agent",
            instructions=AGENT_INSTRUCTIONS,
            advanced=ADVANCED,
            tools=base_tools,
        )
        await agent.aprint_response(message, stream=stream)


async def chat_once(message: str) -> None:
    print(f"\n>>> {message}\n")
    await _run_with_agent(message)


async def chat_loop() -> None:
    print("JumpCloud IAM Agent — modo chat (somente leitura). Digite 'sair' para encerrar.\n")
    while True:
        try:
            message = (await asyncio.to_thread(input, ">>> ")).strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not message:
            continue
        if message.lower() in ("sair", "exit", "quit"):
            break
        await _run_with_agent(message)
        print()


if __name__ == "__main__":
    if len(sys.argv) > 1:
        asyncio.run(chat_once(" ".join(sys.argv[1:])))
    else:
        asyncio.run(chat_loop())
