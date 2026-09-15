// ============================================================
// Tasklyn AI — Function do servidor (Vercel) que fala com a IA
// A chave da Anthropic fica só aqui, nunca no site (client-side).
// Configure ANTHROPIC_API_KEY em: Vercel > Settings > Environment Variables
// ============================================================

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, documents } = req.body || {};

  if (!message) {
    return res.status(400).json({ error: 'Empty message' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: 'AI key is not configured on the server (ANTHROPIC_API_KEY missing).'
    });
  }

  try {
    const anthropicResponse = await fetch(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },

        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 500,

          system: `
You are Tasklyn AI, an AI assistant that helps businesses organize and manage administrative documents such as contracts, spreadsheets, emails, invoices, and other business files.

IMPORTANT LANGUAGE RULE:
You MUST respond exclusively in English.
Never respond in Portuguese.
Never mix Portuguese and English.
All user-facing text, explanations, summaries, warnings, and answers must be written in English.

Be direct, professional, helpful, and concise.

You have access to the following real documents currently registered by the company:

${documents || 'No documents are currently available.'}

Answer questions using the available documents whenever possible.

If the user's question cannot be answered using the available documents, clearly say that the information is not available in the provided documents.

Never invent information.
`,

          messages: [
            {
              role: 'user',
              content: message
            }
          ]
        })
      }
    );

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();

      return res.status(502).json({
        error: 'AI error: ' + errText
      });
    }

    const data = await anthropicResponse.json();

    const reply =
      data.content?.[0]?.text ||
      'I could not generate a response.';

    return res.status(200).json({
      reply
    });

  } catch (err) {
    return res.status(500).json({
      error: err.message
    });
  }
}
