// =============================================
// 위시풀스테이 AI 직원 챗봇 - Vercel 서버리스 함수
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

async function loadNotionDocuments(notion) {
  const DATABASE_ID = process.env.NOTION_DATABASE_ID;
  const dbResponse = await notion.databases.query({ database_id: DATABASE_ID });
  let allContent = '';

  for (const page of dbResponse.results) {
    const titleProp = page.properties['문서명'];
    const title = titleProp?.title?.[0]?.plain_text || '제목 없음';
    let pageContent = `\n\n==============================\n📄 ${title}\n==============================\n`;

    let hasMore = true;
    let cursor = undefined;
    while (hasMore) {
      const blocksResponse = await notion.blocks.children.list({
        block_id: page.id,
        start_cursor: cursor,
      });
      for (const block of blocksResponse.results) {
        pageContent += extractBlockText(block);
      }
      hasMore = blocksResponse.has_more;
      cursor = blocksResponse.next_cursor;
    }
    allContent += pageContent;
  }
  return allContent;
}

module.exports = async function handler(req, res) {
  // CORS 헤더
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

    const notionContent = await loadNotionDocuments(notion);

    const systemPrompt = `당신은 위시풀스테이의 AI 직원 도우미입니다.
아래에 제공된 운영 매뉴얼 및 지침 문서를 기반으로만 답변하세요.

[중요 규칙]
- 문서에 있는 내용: 정확하게 안내하세요.
- 문서에 없는 내용: 반드시 "해당 내용은 현재 등록된 문서에 없습니다."라고 답변하세요.
- 추측하거나 임의로 내용을 만들지 마세요.
- 항상 친절하고 명확한 한국어로 답변하세요.

=== 위시풀스테이 운영 매뉴얼 ===
${notionContent}
=================================`;

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
