AFK Miners — Release Context Pack
--------------------------------
Pasta: docs/releases/2025-08-22_225234-auto

Como usar em uma conversa nova:
1) Informe: Commit curto (git rev-parse --short HEAD) e Tag (se houver).
2) Cole as 10–30 primeiras linhas de context-pack.txt (ou anexe o arquivo).
3) Se mudar data/, cite data-summary.json.

Arquivos principais neste pacote:
 - context-pack.txt        → estrutura, rotas, inventário, maiores arquivos, HTML/YAML/JSON
 - symbol-index.json       → por arquivo: exports/imports/requires, funções, classes/métodos, variáveis, process.env, TODO/FIXME
 - data-summary.json       → chaves/top-keys dos YAML/JSON do repo
 - deps.txt                → dependências por package.json (root/server/client)
 - changes-since.txt       → diff do último tag até HEAD (se existir tag)
 - db-schema.sql / db-tables.txt / db-counts.txt (se SQLite disponível)
 - .gitattributes / .gitignore / package.json (root)

Gerado por: scripts/make-context-pack.ps1
