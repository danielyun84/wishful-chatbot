// =============================================
// 위시풀스테이 AI 직원 챗봇 - Vercel 서버리스
// 2단계 RAG: 제목 라우팅 → 관련 문서만 로드
// =============================================
const Anthropic = require('@anthropic-ai/sdk');
const { Client: NotionClient } = require('@notionhq/client');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

function extractBlockText(block) {
  const type = block.type;
  if (!block[type]) return '';
  const richText = block[type].rich_text || [];
  const text = richText.map(rt => rt.plain_text).join('');
  switch (type) {
    case 'heading_1': return `\n# ${text}\n`;
    case 'heading_2': return `\n## ${text}\n`;
    case 'heading_3': return `\n### ${text}\n`;
    case 'bulleted_list_item': return `- ${text}\n`;
    case 'numbered_list_item': return `1. ${text}\n`;
    case 'quote': return `> ${text}\n`;
    case 'divider': return `---\n`;
    case 'paragraph': return text ? `${text}\n` : '\n';
    default: return text ? `${text}\n` : '';
  }
}

async function getPagesList(notion) {
  const dbResponse = await notion.databases.query({
    database_id: process.env.NOTION_DATABASE_ID
  });
  return dbResponse.results.map(page => ({
    id: page.id,
    title: page.properties['문서명']?.title?.[0]?.plain_text || '제목 없음'
  }));
}

async function getPageContent(notion, pageId) {
  let content = '';
  let hasMore = true;
  let cursor = undefined;
  while (hasMore) {
    const res = await notion.blocks.children.list({ block_id: pageId, start_cursor: cursor });
    for (const block of res.results) content += extractBlockText(block);
    hasMore = res.has_more;
    cursor = res.next_cursor;
  }
  return content;
}

async function getRelevantPages(anthropic, question, pagesList) {
  if (pagesList.length <= 1) return pagesList;

  const titlesText = pagesList.map((p, i) => `${i + 1}. ${p.title}`).join('\n');

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 80,
    system: '문서 목록 중 질문과 관련된 문서 번호를 JSON 배열로만 답하세요. 예: [1,3] / 관련 없으면: []',
    messages: [{ role: 'user', content: `질문: ${question}\n\n문서 목록:\n${titlesText}` }]
  });

  try {
    const raw = response.content[0].text.trim();
    const indices = JSON.parse(raw.match(/\[.*?\]/)[0]);
    const relevant = indices.map(i => pagesList[i - 1]).filter(Boolean);
    return relevant.length > 0 ? relevant : pagesList;
  } catch {
    return pagesList;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { message, password, history } = req.body;

  if (password !== process.env.CHAT_PASSWORD) {
    return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
  }
  if (!message || message.trim() === '') {
    return res.status(400).json({ error: '메시지를 입력해주세요.' });
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const notion = new NotionClient({ auth: process.env.NOTION_API_KEY });

    // 1단계: 문서 목록
    const pagesList = await getPagesList(notion);

    // 2단계: 관련 문서 선별
    const relevantPages = await getRelevantPages(anthropic, message.trim(), pagesList);

    // 3단계: 관련 문서 내용 로드
    let notionContent = '';
    for (const page of relevantPages) {
      const content = await getPageContent(notion, page.id);
      notionContent += `\n\n=== 📄 ${page.title} ===\n${content}`;
    }

    const systemPrompt = `당신은 (주)위시풀스테이 실장입니다.
아래에 제공된 운영 매뉴얼 및 지침 문서를 기반으로만 답변하세요.

[답변 규칙]
- 핵심 내용만 3줄 이내로 간결하게 답변하세요.
- 단계별 설명이 필요한 경우에만 번호를 붙여서 설명하세요.
- ##, **, --, --- 같은 마크다운 기호는 절대 사용하지 마세요.
- 문서에 없는 내용은 "해당 내용은 매뉴얼 업데이트가 필요합니다."라고 답변하세요.
- 추측하거나 임의로 내용을 만들지 마세요.
- 항상 자연스러운 한국어로 답변하세요.

=== 참조 문서 ===
${notionContent || '관련 문서를 찾을 수 없습니다.'}`;

    const messages = [
      ...(Array.isArray(history) ? history.slice(-10) : []),
      { role: 'user', content: message.trim() }
    ];

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });

    res.json({ reply: response.content[0].text });
  } catch (err) {
    console.error('[오류]', err.message);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
};
