// ============================================================
// Tasklyn AI — Function do servidor que analisa documentos de verdade
// Lê o arquivo (PDF/Word/Excel), manda pra IA resumir/categorizar/
// achar vencimento, e salva o resultado no banco.
//
// Precisa de DUAS variáveis de ambiente no Vercel:
// - ANTHROPIC_API_KEY   (já configurada antes, pro chat)
// - SUPABASE_SERVICE_ROLE_KEY  (NOVA — pegue em Supabase > Settings > API,
//   campo "service_role secret". NUNCA coloque essa chave no site,
//   só aqui, como variável de ambiente do servidor.)
// ============================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://pzzxmpdwtyhsmjwtapln.supabase.co';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { documentId, filePath, fileType } = req.body || {};
  if (!documentId || !filePath) {
    return res.status(400).json({ error: 'documentId ou filePath ausente' });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY ausente no servidor.' });
  }
  if (!anthropicKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY ausente no servidor.' });
  }

  const supabase = createClient(SUPABASE_URL, serviceKey);

  try {
    // 1) Baixa o arquivo do Storage
    const { data: signedUrlData, error: signError } = await supabase
      .storage.from('documents').createSignedUrl(filePath, 120);
    if (signError) throw signError;
    const fileResponse = await fetch(signedUrlData.signedUrl);
    if (!fileResponse.ok) throw new Error('Falha ao baixar arquivo do storage: ' + fileResponse.status);
    const buffer = Buffer.from(await fileResponse.arrayBuffer());

    // 2) Extrai o texto conforme o tipo de arquivo
    let text = '';
    const lowerPath = filePath.toLowerCase();

    if ((fileType && fileType.includes('pdf')) || lowerPath.endsWith('.pdf')) {
      const { default: pdfParse } = await import('pdf-parse');
      const parsed = await pdfParse(buffer);
      text = parsed.text;
    } else if ((fileType && fileType.includes('word')) || lowerPath.endsWith('.docx')) {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else if ((fileType && (fileType.includes('sheet') || fileType.includes('excel'))) || lowerPath.endsWith('.xlsx') || lowerPath.endsWith('.xls')) {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      text = workbook.SheetNames.map(name => XLSX.utils.sheet_to_csv(workbook.Sheets[name])).join('\n');
    }
    // imagens: sem extração de texto por enquanto (precisaria de OCR)

    text = text.trim().slice(0, 12000); // limita o tamanho enviado à IA

    let summary = null;
    let category = 'Outros';
    let due_date = null;

    if (text) {
      const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 400,
          system: 'Você analisa documentos administrativos de empresas brasileiras (contratos, planilhas, e-mails, fichas). Responda APENAS com um JSON válido, sem markdown e sem texto fora do JSON, no formato exato: {"summary": "resumo objetivo em até 2 frases, em português", "category": "uma destas: Contratos, Financeiro, Clientes, Outros", "due_date": "AAAA-MM-DD se houver uma data de vencimento clara no texto, ou null se não houver"}',
          messages: [{ role: 'user', content: `Analise este documento e responda no formato pedido:\n\n${text}` }]
        })
      });

      if (aiResponse.ok) {
        const data = await aiResponse.json();
        const raw = data.content?.[0]?.text || '{}';
        try {
          const cleaned = raw.replace(/```json|```/g, '').trim();
          const parsed = JSON.parse(cleaned);
          summary = parsed.summary || null;
          category = parsed.category || 'Outros';
          due_date = (parsed.due_date && parsed.due_date !== 'null') ? parsed.due_date : null;
        } catch (parseErr) {
          summary = raw.slice(0, 300);
        }
      } else {
        const errText = await aiResponse.text();
        summary = `Erro da IA (${aiResponse.status}): ${errText.slice(0, 200)}`;
      }
    } else {
      summary = 'Não foi possível extrair texto deste arquivo automaticamente (formato de imagem ou não suportado ainda).';
    }

    // 3) Salva o resultado no banco
    const { error: updateError } = await supabase
      .from('documents')
      .update({ summary, category, due_date, status: 'processed' })
      .eq('id', documentId);
    if (updateError) throw updateError;

    return res.status(200).json({ summary, category, due_date });
  } catch (err) {
    try {
      await supabase.from('documents').update({ status: 'needs_review' }).eq('id', documentId);
    } catch (e) { /* ignora erro secundário */ }
    return res.status(500).json({ error: err.message });
  }
}
