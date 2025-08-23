npm run deploy  -- rodar sempre após subir uma atualização pro site
npm start -- ligar server local
$env:CONTENT_PIPELINE="shadow"; npm run dev
npm run ctx:zip
save
registra snapshot



Assim o monstro fica registrado na base, com atributos, loot, etc. O client continua usando a mesma sprite.

PNG da sprite

client/sprites/monsters/slime.png (32×32 recomendado).

Crie o YAML do monstro
Arquivo: data/monsters/slime.yaml

key: slime
name: Slime
xp: 35
healthMax: 60
speed: 55
elements: { }          # se não usar agora, pode deixar vazio
flags: { }             # ex.: aggressive: true
attacks: []            # depois você define seus golpes
defenses: []           # e defesas
loot: []               # tabela de drop
look:
  sprite: client/sprites/monsters/slime.png
  w: 32
  h: 32
  anchor:
    x: 0.5
    y: 0.9


Rodar o pipeline

Inicie o servidor com o pipeline ligado:

Windows PowerShell:

$env:CONTENT_PIPELINE="shadow"; npm run dev


(ou on no lugar de shadow se já quiser aplicar direto)

Ao subir, ele deve logar algo como:

[content] monsters: [ { key: 'slime', ... }, ... ]


Se quiser forçar reload sem reiniciar, hoje temos rota de reload de mapa; para monstros/itens o pipeline recarrega no boot. (Se quiser, depois implementamos uma rota /api/admin/content/reload-assets para monsters/items/sprites.)

Usar no Tiled

Em spawn -> monsterKey: slime, count, etc., como no modo rápido.

Testar

house_debug.html para conferir start/spawns

house.html para jogar e ver os mobs.

✅ Então, para adicionar um novo monstro (orc, por exemplo):

Criar data/monsters/orc.yml com as stats do orc.

Editar data/monsters/index.yml e adicionar:

monsters:
  balor: "./balor.yml"
  goblin: "./goblin.yml"
  orc: "./orc.yml"


Colocar a sprite em:

client/sprites/monsters/orc.png


No mapa (Tiled), criar um objeto na layer spawn com:

monsterKey: orc
count: 2
respawnSec: 30


Salvar/exportar mapa + reiniciar pipeline (CONTENT_PIPELINE="shadow" npm run dev).

⚠️ Se tu esquecer de registrar no index.yml, o loader simplesmente não vai enxergar o novo monstro (mesmo que o .yml exista).


tiled:
 monsterKey = goblin
   count = 3
   respawnSec = 20
   
   Use these types:

monsterKey → string (ex.: goblin)

count → int (ex.: 3)

respawnSec → int (ex.: 20)

Passo-a-passo rápido no Tiled:

Selecione o retângulo do spawn (na layer spawn).

Em Properties clique no + para cada propriedade:

escolha string, nomeie monsterKey, valor goblin;

escolha int, nomeie count, valor 3;

escolha int, nomeie respawnSec, valor 20.

Garanta que o objeto é Rectangle com Width/Height > 0.

Salve o .tmx, Export para house.json e clique Recarregar do servidor na tela de debug.

Pronto.


Listar mapas: http://localhost:3000/api/admin/content/maps

JSON do mapa: http://localhost:3000/api/admin/content/map/house/data

Objetos (layer → start/spawn): http://localhost:3000/api/admin/content/map/house/objects

Spawns já normalizados (BD): http://localhost:3000/api/admin/content/map/house/spawns

Debug visual: http://localhost:3000/house_debug.html

Cena jogável: http://localhost:3000/house.html

E para recarregar do servidor após salvar o house.json no disco:

POST http://localhost:3000/api/admin/content/reload-map?map=house
(o house_debug.html já tem o botão “Recarregar do servidor” que faz esse POST com CSRF).

boa! pelas suas prints agora está tudo encaixado:

/api/admin/content/maps lista o house.

/api/admin/content/map/house/data traz o JSON do Tiled com tileset embedado (client/sprites/tiles/kenney_map.png).

/api/admin/content/map/house/objects devolve start + um spawn.

/api/admin/content/map/house/spawns devolve o spawn já “flatenado”.

house_debug.html mostra o start e o spawn.

house.html (play) renderiza o ground, a câmera segue e os 3 mobs (bolinhas vermelhas) aparecem e andam dentro do retângulo do spawn. ✅

Se quiser guardar, estes são os links de teste prontos (GET), todos funcionando no seu ambiente:

Listar mapas: http://localhost:3000/api/admin/content/maps

JSON do mapa: http://localhost:3000/api/admin/content/map/house/data

Objetos (layer → start/spawn): http://localhost:3000/api/admin/content/map/house/objects

Spawns já normalizados (BD): http://localhost:3000/api/admin/content/map/house/spawns

Debug visual: http://localhost:3000/house_debug.html

Cena jogável: http://localhost:3000/house.html

E para recarregar do servidor após salvar o house.json no disco:

POST http://localhost:3000/api/admin/content/reload-map?map=house
(o house_debug.html já tem o botão “Recarregar do servidor” que faz esse POST com CSRF).

O que estava pegando (e já foi corrigido)

O loader aceitava apenas layer “spawns” (plural). Agora lê a layer “spawn” (singular), que é como está no seu .tmx/.json.

Normalização do caminho do tileset (client/...) para servir em /sprites/tiles/....

drawImage não quebra mais com imagem “broken state” (a gente chama decode() e valida com naturalWidth).

A play scene tem câmera com follow e desenha só o que está no viewport.

Checklist rápido para criar outro monstro + spawn

Arquivo YAML do monstro em data/monsters/<seu>.yml (ex.: balor.yml).

Adicionar no index: data/monsters/index.yml

monsters:
  balor: "./balor.yml"
  goblin: "./goblin.yml"


(Opcional) Sprite PNG do monstro em:
client/sprites/monsters/<monsterKey>.png

Se não existir, no jogo cai no círculo vermelho como placeholder.

No Tiled, layer spawn (objectgroup), objeto type/class = spawn e properties:

monsterKey (string) = balor

count (int)

respawnSec (int)

width/height do retângulo onde pode nascer

Exportar o mapa para data/maps/house.json (com Embed Tileset).

Clicar “Recarregar do servidor” no debug (ou POST na rota).
Verifique em /api/admin/content/map/house/spawns.

Se algo “sumir”/não renderizar

O ground não aparece? confira no JSON que tilesets[0].image está preenchido e que a layer ground é tilelayer.

Mobs não aparecem? verifique:

/api/admin/content/map/house/spawns retorna pelo menos 1 item;

objeto no Tiled tem type/class = spawn e count > 0;

monsterKey bate com o nome do YAML (ex.: goblin, balor);

o retângulo do spawn tem width/height > 0 (ou a gente trata como 1 tile).