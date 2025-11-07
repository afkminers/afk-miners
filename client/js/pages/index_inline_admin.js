import { initInlineAdmin } from '../admin-inline.js';

const config = {
  page: 'index',
  prefixes: ['news.'],
  groups: [
    {
      title: {
        en: 'News section',
        'pt-BR': 'Seção de notícias',
      },
      fields: [
        {
          key: 'news.sectionTitle',
          label: {
            en: 'Section title',
            'pt-BR': 'Título da seção',
          },
          multiline: false,
        },
        {
          key: 'news.sectionSubtitle',
          label: {
            en: 'Section subtitle',
            'pt-BR': 'Subtítulo da seção',
          },
          multiline: true,
        },
        {
          key: 'news.viewAll',
          label: {
            en: '“View all” link',
            'pt-BR': 'Link “Ver tudo”',
          },
          multiline: false,
        },
      ],
    },
  ],
  posts: {
    enabled: true,
    page: 'index',
    defaultSort: 300,
  },
};

initInlineAdmin(config);
