import { initInlineAdmin } from '../admin-inline.js';

const config = {
  page: 'support',
  prefixes: ['support.'],
  groups: [
    {
      title: { en: 'Hero banner', 'pt-BR': 'Banner principal' },
      fields: [
        { key: 'support.heroTitle', label: { en: 'Title', 'pt-BR': 'Título' }, multiline: false },
        { key: 'support.heroCopy', label: { en: 'Subtitle', 'pt-BR': 'Subtítulo' }, multiline: true },
      ],
    },
    {
      title: { en: 'FAQ', 'pt-BR': 'FAQ' },
      fields: [
        { key: 'support.faqTitle', label: { en: 'Section title', 'pt-BR': 'Título da seção' }, multiline: false },
        { key: 'support.faqRecover', label: { en: 'Question: recover login', 'pt-BR': 'Pergunta: recuperar login' }, multiline: false },
        { key: 'support.faqRecoverBody', label: { en: 'Answer: recover login', 'pt-BR': 'Resposta: recuperar login' }, multiline: true },
        { key: 'support.faqProgress', label: { en: 'Question: offline progress', 'pt-BR': 'Pergunta: progresso offline' }, multiline: false },
        { key: 'support.faqProgressBody', label: { en: 'Answer: offline progress', 'pt-BR': 'Resposta: progresso offline' }, multiline: true },
        { key: 'support.faqBug', label: { en: 'Question: report bug', 'pt-BR': 'Pergunta: reportar bug' }, multiline: false },
        { key: 'support.faqBugBody', label: { en: 'Answer: report bug', 'pt-BR': 'Resposta: reportar bug' }, multiline: true },
        { key: 'support.faqIdeas', label: { en: 'Question: share ideas', 'pt-BR': 'Pergunta: enviar ideias' }, multiline: false },
        { key: 'support.faqIdeasBody', label: { en: 'Answer: share ideas', 'pt-BR': 'Resposta: enviar ideias' }, multiline: true },
      ],
    },
    {
      title: { en: 'Ticket form', 'pt-BR': 'Formulário' },
      fields: [
        { key: 'support.formTitle', label: { en: 'Section title', 'pt-BR': 'Título da seção' }, multiline: false },
        { key: 'support.name', label: { en: 'Label: name', 'pt-BR': 'Rótulo: nome' }, multiline: false },
        { key: 'support.email', label: { en: 'Label: email', 'pt-BR': 'Rótulo: e-mail' }, multiline: false },
        { key: 'support.subject', label: { en: 'Label: subject', 'pt-BR': 'Rótulo: assunto' }, multiline: false },
        { key: 'support.message', label: { en: 'Label: message', 'pt-BR': 'Rótulo: mensagem' }, multiline: true },
        { key: 'support.send', label: { en: 'Button label', 'pt-BR': 'Texto do botão' }, multiline: false },
        { key: 'support.fillAll', label: { en: 'Error: fill all', 'pt-BR': 'Erro: preencher todos' }, multiline: false },
        { key: 'support.invalidEmail', label: { en: 'Error: invalid email', 'pt-BR': 'Erro: e-mail inválido' }, multiline: false },
        { key: 'support.created', label: { en: 'Success message', 'pt-BR': 'Mensagem de sucesso' }, multiline: false },
        { key: 'support.error', label: { en: 'Generic error', 'pt-BR': 'Erro genérico' }, multiline: false },
      ],
    },
    {
      title: { en: 'Community links', 'pt-BR': 'Comunidade' },
      fields: [
        { key: 'support.communityTitle', label: { en: 'Section title', 'pt-BR': 'Título da seção' }, multiline: false },
        { key: 'support.discord', label: { en: 'Discord link text', 'pt-BR': 'Texto do link Discord' }, multiline: false },
        { key: 'support.emailLink', label: { en: 'Email link text', 'pt-BR': 'Texto do link e-mail' }, multiline: false },
      ],
    },
  ],
  posts: {
    enabled: true,
    page: 'support',
    defaultSort: 150,
  },
};

initInlineAdmin(config);
