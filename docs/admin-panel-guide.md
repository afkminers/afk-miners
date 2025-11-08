# AFK Miners — Painel Admin (CMS)

Este guia explica como autenticar com a conta de admin (`tigasfarm141`), acessar o painel em `/admin` e utilizar os recursos de gerenciamento de conteúdo.

## 1. Pré-requisitos

1. Garanta que a variável de ambiente `ADMIN_NAMES` contenha `tigasfarm141`.
2. Inicie o servidor normalmente (`npm install` dentro de `/server` e depois `npm start`).

## 2. Mantendo a sessão na página inicial

1. Abra `https://afkminers.com/index.html#` (ou o equivalente em ambiente local).
2. Clique em **Jogar** para abrir o modal de login.
3. Informe o usuário `tigasfarm141` e a senha correspondente.
4. Ao confirmar, o site permanece na página inicial já autenticado. Você verá o cabeçalho exibindo o nome do jogador e poderá navegar normalmente sem ser redirecionado para o jogo automaticamente.
5. Sempre que quiser entrar no jogo, use o botão **Jogar** depois de logado.

### Retornando do jogo para o site

Quando estiver no cliente do jogo (`app.html`), clique no logotipo **AFK MINERS** localizado no canto superior esquerdo. Esse atalho retorna para `index.html` mantendo a mesma sessão autenticada.

## 3. Acessando o painel admin

1. Com a sessão autenticada como `tigasfarm141`, navegue até `https://afkminers.com/admin` (ou `http://localhost:3000/admin` em desenvolvimento).
2. O backend valida a sessão e permite o acesso apenas aos nomes listados em `ADMIN_NAMES`.
3. Se a sessão expirar ou o usuário não for admin, o painel exibirá uma mensagem de erro e os endpoints retornarão 401/403.

## 4. Visão geral da interface do painel

O painel possui duas abas principais: **Posts / Notícias** e **Textos (i18n overrides)**. Use os botões no topo para alternar entre elas.

### 4.1 Posts / Notícias

- **Filtros**: escolha a página de destino (`index`, `overview`, `roadmap`) e o idioma (`en`, `pt-BR`).
- **Lista**: mostra todos os posts cadastrados (inclusive os não publicados). Cada item exibe título, tag, data, status de publicação e botões:
  - **Editar**: carrega o post no formulário lateral para ajustes.
  - **Excluir**: remove definitivamente o post selecionado.
  - **Setas ↑↓**: ajustam rapidamente o `sort_index`. Também é possível usar o botão **Reordenar** para enviar a ordem manualmente (PATCH `/reorder`).
- **Formulário**: preencha ou edite os campos (título, resumo, corpo em HTML sanitizado, tag, link, data de publicação, `sort_index` e `is_published`). Clique em **Salvar** para criar ou atualizar. Os erros de validação aparecem na barra de avisos.

### 4.2 Textos (i18n overrides)

- **Filtros**: selecione o idioma e, opcionalmente, informe um prefixo (por exemplo, `overview.`) para filtrar chaves específicas.
- **Lista**: mostra todas as chaves sobrescritas com a data da última atualização. Use **Editar** para carregar o item no formulário ou **Excluir** para removê-lo.
- **Formulário**: informe `locale`, `key` (ex.: `overview.heroTitle`) e o `value` em HTML simples. O backend sanitiza as tags automaticamente.
- **Dica**: utilize a seção de ajuda com as chaves mais comuns para localizar textos rapidamente.

## 5. Testando o conteúdo nas páginas públicas

1. Após criar/editar um post publicado, recarregue a página correspondente (ex.: `index.html`) — o conteúdo dinâmico é buscado via `/api/content/posts`.
2. Overrides de texto entram em vigor assim que a página é recarregada e o i18n realiza o merge com `/api/content/i18n-overrides`.
3. Para verificar a ordem, publique mais de um post e ajuste o `sort_index`: valores maiores aparecem primeiro.

## 6. Solução de problemas

- **Mensagem “Faça login no jogo e recarregue”**: a sessão expirou; volte à página inicial, clique em **Jogar**, reautentique e acesse `/admin` novamente.
- **Erro 403 (forbidden)**: confirme se `ADMIN_NAMES` inclui exatamente o nome do jogador logado (insensível a maiúsculas/minúsculas).
- **HTML removido**: apenas as tags permitidas (como `strong`, `em`, `a`, `ul`, `ol`, `li`, etc.) são mantidas pelo sanitizador do backend.

Com isso, o fluxo de login/admin fica preservado sem quebrar a experiência existente do jogo.
