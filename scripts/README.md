# Dev scripts

## Audit DB vs files

Lista itens no banco sem YAML em `data/items` e monstros no banco sem YAML em `data/sprites/monsters`.

```bash
node scripts/audit-db-vs-files.js | jq .
```

Saída esperada:

```json
{
  "counts": { "itemsDB": 0, "itemFiles": 0, "monstersDB": 0, "monsterFiles": 0 },
  "itemsMissingFiles": ["rusty_sword"],
  "monstersMissingYaml": ["dragonkin"]
}
```

## Gerar stubs de itens

Gera arquivos YAML para keys informadas, para você completar conforme o compêndio.

```bash
node scripts/generate-item-yaml-stubs.js ./data/items rusty_sword carrion_club
```