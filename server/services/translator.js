// server/services/translator.js
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function translatePostToEn(postPt) {
  // se não tiver API key, só replica o conteúdo e pronto
  if (!process.env.OPENAI_API_KEY) {
    return {
      ...postPt,
      locale: 'en',
    };
  }

  const payload = {
    title: postPt.title || '',
    summary: postPt.summary || '',
    body_html: postPt.body_html || '',
    link_label: postPt.link_label || '',
  };

  const system = `
Você é um tradutor profissional pt-BR -> inglês nativo.
Traduza os campos de um JSON de post de jogo.
Regras:
- Deixe o estilo gamer / casual, mas claro.
- NÃO invente conteúdo novo.
- Em "body_html", preserve a estrutura HTML (tags, links, etc), só traduzindo o texto.
- Responda APENAS um JSON válido, no formato:
{"title": "...", "summary": "...", "body_html": "...", "link_label": "..."}
`;

  const user = `Traduza do português para inglês nativo:\n${JSON.stringify(payload)}`;

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system.trim() },
      { role: 'user', content: user },
    ],
    temperature: 0.4,
  });

  const raw = completion.choices[0]?.message?.content ?? '';
  let translated;
  try {
    translated = JSON.parse(raw);
  } catch (err) {
    console.error('[translatePostToEn] JSON parse failed, using original pt content', err, raw);
    return {
      ...postPt,
      locale: 'en',
    };
  }

  return {
    ...postPt,
    locale: 'en',
    title: translated.title || postPt.title,
    summary: translated.summary || postPt.summary,
    body_html: translated.body_html || postPt.body_html,
    link_label: translated.link_label || postPt.link_label,
  };
}
