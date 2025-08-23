AFK Miners — Release Context Pack
--------------------------------
Pasta: docs/releases/2025-08-22_231259-auto

Como usar em uma conversa nova:
1) Informe: Commit curto (git rev-parse --short HEAD) e Tag (se houver).
2) Cole as 10–30 primeiras linhas de context-pack.txt (ou anexe o arquivo).
3) Se mudar data/, cite data-summary.json.

Arquivos principais neste pacote:
 - context-pack.txt            → estrutura, rotas, inventário, maiores arquivos, HTML/YAML/JSON
 - symbol-index.json           → símbolos por arquivo (funções/classes exportadas e nomeadas)
 - data-summary.json           → chaves/top-keys dos YAML/JSON do repo
 - deps.txt                    → arestas de import entre arquivos JS/TS
 - changes-since.txt           → diff do último tag até HEAD (se existir tag)
 - function-signatures.json    → (v3) assinaturas estáticas (nome, params, local)
 - env-usage.json              → (v3) variáveis process.env usadas + defaults inferidos
 - endpoints-contracts.json    → (v3) contrato inferido de params/query/body por endpoint
 - error-map.json              → (v3) status/mensagens/throws por endpoint
 - db-schema.sql / db-tables.txt / db-counts.txt (se SQLite disponível)
 - .gitattributes / .gitignore / package.json (root)

Gerado por: scripts/make-context-pack.ps1
