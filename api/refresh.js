// =============================================
// 위시풀스테이 AI 직원 챗봇 - Vercel 서버리스
// 노션 문서 목록 갱신 엔드포인트
// =============================================
const { Client: NotionClient } = require('@notionhq/client');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { password } = req.body;

  if (password !== process.env.CHAT_PASSWORD) {
    return res.status(401).json({ error: '권한 없음' });
  }

  try {
    const notion = new NotionClient({ auth: process.env.NOTION_API_KEY });
    const dbResponse = await notion.databases.query({
      database_id: process.env.NOTION_DATABASE_ID
    });
    res.json({ message: `노션 문서 목록이 갱신되었습니다. (${dbResponse.results.length}개 문서)` });
  } catch (err) {
    res.status(500).json({ error: '갱신 실패: ' + err.message });
  }
};
