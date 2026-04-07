// =============================================
// 위시풀스테이 AI 직원 챗봇 - 로컬 개발 서버
// =============================================
require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { Client: NotionClient } = require('@notionhq/client');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── 클라이언트 초기화 ──────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const notion = new NotionClient({ auth: process.env.NOTION_API_KEY });

const DATABASE_ID = process.env.NOTION_DATABASE_ID;
const CHAT_PASSWORD = process.env.CHAT_PASSWORD;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

// ── 노션 캐시 (5분) ───────────────────────────
let notionCache = null;
let cacheTimestamp = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

// 블록 텍스트 추출
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

// 노션 전체 문서 내용 로드
async function loadNotionDocuments() {
  if (notionCache && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return notionCache;
  }

  console.log('[Notion] 문서 불러오는 중...');
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

  notionCache = allContent;
  cacheTimestamp = Date.now();
  console.log(`[Notion] ${dbResponse.results.length}개 문서 로드 완료`);
  return allContent;
}

// ── API 라우트 ─────────────────────────────────

// 챗 엔드포인트
app.post('/api/chat', async (req, res) => {
  const { message, password, history } = req.body;

  // 비밀번호 검사
  if (!CHAT_PASSWORD || password !== CHAT_PASSWORD) {
    return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
  }

  if (!message || message.trim() === '') {
    return res.status(400).json({ error: '메시지를 입력해주세요.' });
  }

  try {
    const notionContent = await loadNotionDocuments();

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
    res.status(500).json({ error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' });
  }
});

// 캐시 새로고침 (수동)
app.post('/api/refresh', async (req, res) => {
  const { password } = req.body;
  if (password !== CHAT_PASSWORD) {
    return res.status(401).json({ error: '권한 없음' });
  }
  notionCache = null;
  cacheTimestamp = null;
  try {
    await loadNotionDocuments();
    res.json({ message: '노션 문서 캐시가 새로고침 되었습니다.' });
  } catch (err) {
    res.status(500).json({ error: '캐시 새로고침 실패: ' + err.message });
  }
});

// ── 서버 시작 ──────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`\n🏨 위시풀스테이 AI 직원 챗봇`);
  console.log(`📡 서버 주소: http://localhost:${PORT}`);
  console.log(`🤖 모델: ${MODEL}`);
  // 시작 시 노션 문서 미리 로드
  try {
    await loadNotionDocuments();
  } catch (err) {
    console.error('[경고] 노션 문서 로드 실패:', err.message);
  }
});
