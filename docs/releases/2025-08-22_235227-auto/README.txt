AFK Miners — Release Context Pack
--------------------------------
Pasta: docs/releases/2025-08-22_235227-auto

Como usar em uma conversa nova:
1) Informe: Commit curto (git rev-parse --short HEAD) e Tag (se houver).
2) Cole as 10–30 primeiras linhas de context-pack.txt (ou anexe o arquivo).
3) Se mudar data/, cite data-summary.json.

Arquivos principais neste pacote:
 - API.md                  → documentação legível (payloads, erros, env)
 - context-pack.txt        → estrutura, rotas, inventário, maiores arquivos, HTML/YAML/JSON
 - endpoints-contracts.json→ rotas com exemplos de params/query/body
 - error-map.json          → mapa de status/mensagens por rota
 - env-usage.json          → todas as process.env + defaults detectados
 - function-signatures.json→ assinaturas (nome/params/arquivo/linha)
 - symbol-index.json       → símbolos (se CTX_SYMBOLS=1)
 - deps.txt                → import graph (se CTX_IMPORTS=1)
 - data-summary.json       → resumo YAML/JSON
 - changes-since.txt       → diff desde a última tag (se houver)
 - db-schema.sql / db-tables.txt / db-counts.txt (se SQLite disponível)
 - .gitattributes / .gitignore / package.json (root)

Gerado por: scripts/make-context-pack.ps1
