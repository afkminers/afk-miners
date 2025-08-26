# Guia: Como adicionar monstros (sprites + YAML) ao projeto

Resumo rápido
- Entregar: PNG com alpha (spritesheet) + PSD (fonte) + preview PNG.
- Estrutura esperada:
  - sprites/monsters/<key>.png
  - data/sprites/monsters/<key>.yml
  - assets/source/<key>.psd
- YAML mínimo (exemplo):
  key: goblin
  image: "sprites/monsters/goblin.png"
  frame:
    width: 64
    height: 64
  grid:
    cols: 8
    rows: 4
  directions: [ south, west, east, north ]
  anims:
    walk:
      fps: 10
      frames: 8
      rowByDir: { south: 0, west: 1, east: 2, north: 3 }
      startCol: 0
  anchor:
    x: 0.5
    y: 0.9

Passo-a-passo para integrar
1. Recebe PNG/PSD do artista.
2. Coloque PNG em sprites/monsters/<key>.png.
3. Crie data/sprites/monsters/<key>.yml com os valores corretos (cols, rows, frame size, anims).
4. Verifique dimensões: width == frame.width * cols e height == frame.height * rows.
5. Reinicie servidor/limpe cache estático.
6. Teste animações no cliente e ajuste anchor/startCol se necessário.

Validação rápida (PowerShell)
- Testar se o PNG existe:
  Test-Path .\sprites\monsters\goblin.png
- Verificar dimensões com imagem externa (se instalar imagem-size etc.)

Observações
- VFX separado: sprites/vfx/<key>.png + data/sprites/vfx/<key>.yml
- Se artista entregar só PSD, peça layers/frames numerados para montar o spritesheet.