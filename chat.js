// ============================================================
// Tasklyn AI — Function do servidor (Vercel) que fala com a IA
// A chave da Anthropic fica só aqui, nunca no site (client-side).
// Configure ANTHROPIC_API_KEY em: Vercel > Settings > Environment Variables
// ============================================================

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { message, documents } = req.body || {};
  if (!message) {
    return res.status(400).json({ error: 'Mensagem vazia' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Chave da IA não configurada no servidor (ANTHROPIC_API_KEY ausente).' });
  }

  try {
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        system: `Você é a IA da Tasklyn, um assistente que ajuda empresas a organizar documentos administrativos (contratos, planilhas, e-mails). Responda em português, de forma direta e útil. Aqui está a lista de documentos reais da empresa no momento:\n\n${documents}\n\nSe a pergunta não puder ser respondida com base nesses documentos, diga isso claramente em vez de inventar informações.`,
        messages: [
          { role: 'user', content: message }
        ]
      })
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      return res.status(502).json({ error: 'Erro da IA: ' + errText });
    }

    const data = await anthropicResponse.json();
    const reply = data.content?.[0]?.text || 'Não consegui gerar uma resposta.';
    return res.status(200).json({ reply });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
