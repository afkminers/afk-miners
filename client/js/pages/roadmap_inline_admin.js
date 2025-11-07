import { initInlineAdmin } from '../admin-inline.js';

const config = {
  page: 'roadmap',
  prefixes: ['roadmap.'],
  groups: [
    {
      title: { en: 'Hero banner', 'pt-BR': 'Banner principal' },
      fields: [
        { key: 'roadmap.heroTitle', label: { en: 'Title', 'pt-BR': 'Título' }, multiline: false },
        { key: 'roadmap.heroCopy', label: { en: 'Subtitle', 'pt-BR': 'Subtítulo' }, multiline: true },
      ],
    },
    {
      title: { en: 'Milestones', 'pt-BR': 'Marcos' },
      fields: [
        { key: 'roadmap.milestones', label: { en: 'Section title', 'pt-BR': 'Título da seção' }, multiline: false },
        { key: 'roadmap.done', label: { en: 'Badge “Done”', 'pt-BR': 'Badge “Concluído”' }, multiline: false },
        { key: 'roadmap.wip', label: { en: 'Badge “In progress”', 'pt-BR': 'Badge “Em andamento”' }, multiline: false },
        { key: 'roadmap.next', label: { en: 'Badge “Next”', 'pt-BR': 'Badge “Próximo”' }, multiline: false },
        { key: 'roadmap.phase1Title', label: { en: 'Phase 1 title', 'pt-BR': 'Título fase 1' }, multiline: false },
        { key: 'roadmap.phase1Copy', label: { en: 'Phase 1 description', 'pt-BR': 'Descrição fase 1' }, multiline: true },
        { key: 'roadmap.phase2Title', label: { en: 'Phase 2 title', 'pt-BR': 'Título fase 2' }, multiline: false },
        { key: 'roadmap.phase2Copy', label: { en: 'Phase 2 description', 'pt-BR': 'Descrição fase 2' }, multiline: true },
        { key: 'roadmap.phase3Title', label: { en: 'Phase 3 title', 'pt-BR': 'Título fase 3' }, multiline: false },
        { key: 'roadmap.phase3Copy', label: { en: 'Phase 3 description', 'pt-BR': 'Descrição fase 3' }, multiline: true },
        { key: 'roadmap.phase4Title', label: { en: 'Phase 4 title', 'pt-BR': 'Título fase 4' }, multiline: false },
        { key: 'roadmap.phase4Copy', label: { en: 'Phase 4 description', 'pt-BR': 'Descrição fase 4' }, multiline: true },
      ],
    },
    {
      title: { en: 'Newsletter signup', 'pt-BR': 'Cadastro de novidades' },
      fields: [
        { key: 'roadmap.subscribeTitle', label: { en: 'Section title', 'pt-BR': 'Título da seção' }, multiline: false },
        { key: 'roadmap.subscribeCopy', label: { en: 'Description', 'pt-BR': 'Descrição' }, multiline: true },
        { key: 'roadmap.subscribe', label: { en: 'Button label', 'pt-BR': 'Texto do botão' }, multiline: false },
        { key: 'roadmap.subscribeInvalid', label: { en: 'Error message', 'pt-BR': 'Mensagem de erro' }, multiline: false },
        { key: 'roadmap.subscribeSuccess', label: { en: 'Success message', 'pt-BR': 'Mensagem de sucesso' }, multiline: false },
      ],
    },
    {
      title: { en: 'Updates highlight', 'pt-BR': 'Atualizações' },
      fields: [
        { key: 'roadmap.updatesTitle', label: { en: 'Section title', 'pt-BR': 'Título da seção' }, multiline: false },
      ],
    },
  ],
  posts: {
    enabled: true,
    page: 'roadmap',
    defaultSort: 200,
  },
};

initInlineAdmin(config);
