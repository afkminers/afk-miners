import { initInlineAdmin } from '../admin-inline.js';

const config = {
  page: 'overview',
  prefixes: ['overview.'],
  groups: [
    {
      title: { en: 'Hero banner', 'pt-BR': 'Banner principal' },
      fields: [
        { key: 'overview.heroTitle', label: { en: 'Title', 'pt-BR': 'Título' }, multiline: false },
        { key: 'overview.heroCopy', label: { en: 'Subtitle', 'pt-BR': 'Subtítulo' }, multiline: true },
        { key: 'overview.cta', label: { en: 'CTA button', 'pt-BR': 'Botão CTA' }, multiline: false },
      ],
    },
    {
      title: { en: 'Intro section', 'pt-BR': 'Seção introdutória' },
      fields: [
        { key: 'overview.whatIs', label: { en: 'Section title', 'pt-BR': 'Título da seção' }, multiline: false },
        { key: 'overview.whatIsCopy', label: { en: 'Paragraph', 'pt-BR': 'Parágrafo' }, multiline: true },
      ],
    },
    {
      title: { en: 'How to play', 'pt-BR': 'Como jogar' },
      fields: [
        { key: 'overview.howTo', label: { en: 'Section title', 'pt-BR': 'Título da seção' }, multiline: false },
        { key: 'overview.howToSummon', label: { en: 'Step 1', 'pt-BR': 'Passo 1' }, multiline: true },
        { key: 'overview.howToAssign', label: { en: 'Step 2', 'pt-BR': 'Passo 2' }, multiline: true },
        { key: 'overview.howToCollect', label: { en: 'Step 3', 'pt-BR': 'Passo 3' }, multiline: true },
        { key: 'overview.howToOptimize', label: { en: 'Step 4', 'pt-BR': 'Passo 4' }, multiline: true },
      ],
    },
    {
      title: { en: 'Heroes & rarities', 'pt-BR': 'Heróis e raridades' },
      fields: [
        { key: 'overview.heroes', label: { en: 'Section title', 'pt-BR': 'Título da seção' }, multiline: false },
        { key: 'overview.heroesCommonTitle', label: { en: 'Common/Rare title', 'pt-BR': 'Título Comum/Raro' }, multiline: false },
        { key: 'overview.heroesCommonBody', label: { en: 'Common/Rare body', 'pt-BR': 'Texto Comum/Raro' }, multiline: true },
        { key: 'overview.heroesEpicTitle', label: { en: 'Epic/Legendary title', 'pt-BR': 'Título Épico/Lendário' }, multiline: false },
        { key: 'overview.heroesEpicBody', label: { en: 'Epic/Legendary body', 'pt-BR': 'Texto Épico/Lendário' }, multiline: true },
        { key: 'overview.heroesMythicTitle', label: { en: 'Mythic title', 'pt-BR': 'Título Mítico' }, multiline: false },
        { key: 'overview.heroesMythicBody', label: { en: 'Mythic body', 'pt-BR': 'Texto Mítico' }, multiline: true },
      ],
    },
    {
      title: { en: 'Economy', 'pt-BR': 'Economia' },
      fields: [
        { key: 'overview.economy', label: { en: 'Section title', 'pt-BR': 'Título da seção' }, multiline: false },
        { key: 'overview.economyCopy', label: { en: 'Paragraph', 'pt-BR': 'Parágrafo' }, multiline: true },
      ],
    },
    {
      title: { en: 'Game modes', 'pt-BR': 'Modos de jogo' },
      fields: [
        { key: 'overview.modes', label: { en: 'Section title', 'pt-BR': 'Título da seção' }, multiline: false },
        { key: 'overview.modesTreasureTitle', label: { en: 'Treasure title', 'pt-BR': 'Título Tesouro' }, multiline: false },
        { key: 'overview.modesTreasureBody', label: { en: 'Treasure description', 'pt-BR': 'Descrição Tesouro' }, multiline: true },
        { key: 'overview.modesTrainingTitle', label: { en: 'Training title', 'pt-BR': 'Título Treinamento' }, multiline: false },
        { key: 'overview.modesTrainingBody', label: { en: 'Training description', 'pt-BR': 'Descrição Treinamento' }, multiline: true },
        { key: 'overview.modesDungeonTitle', label: { en: 'Dungeon title', 'pt-BR': 'Título Masmorra' }, multiline: false },
        { key: 'overview.modesDungeonBody', label: { en: 'Dungeon description', 'pt-BR': 'Descrição Masmorra' }, multiline: true },
        { key: 'overview.modesPvpTitle', label: { en: 'PvP title', 'pt-BR': 'Título PvP' }, multiline: false },
        { key: 'overview.modesPvpBody', label: { en: 'PvP description', 'pt-BR': 'Descrição PvP' }, multiline: true },
      ],
    },
    {
      title: { en: 'Art direction', 'pt-BR': 'Direção de arte' },
      fields: [
        { key: 'overview.art', label: { en: 'Section title', 'pt-BR': 'Título da seção' }, multiline: false },
        { key: 'overview.artCopy', label: { en: 'Paragraph', 'pt-BR': 'Parágrafo' }, multiline: true },
      ],
    },
    {
      title: { en: 'Updates highlight', 'pt-BR': 'Atualizações' },
      fields: [
        { key: 'overview.updatesTitle', label: { en: 'Section title', 'pt-BR': 'Título da seção' }, multiline: false },
      ],
    },
    {
      title: { en: 'Join CTA', 'pt-BR': 'Chamada para ação' },
      fields: [
        { key: 'overview.join', label: { en: 'Section title', 'pt-BR': 'Título da seção' }, multiline: false },
        { key: 'overview.joinCopy', label: { en: 'Paragraph', 'pt-BR': 'Parágrafo' }, multiline: true },
        { key: 'overview.joinCta', label: { en: 'Button label', 'pt-BR': 'Texto do botão' }, multiline: false },
      ],
    },
  ],
  posts: {
    enabled: true,
    page: 'overview',
    defaultSort: 250,
  },
};

initInlineAdmin(config);
