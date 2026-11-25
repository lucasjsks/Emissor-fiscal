// Entrega ao navegador só o que é público: endereço do Supabase e chave anônima (protegida pelas regras RLS).
export default function handler(req, res){
  const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return res.status(500).json({ erro:'Configure SUPABASE_URL e SUPABASE_ANON_KEY nas variáveis da Vercel.' });
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ supabaseUrl:url, supabaseAnonKey:anon, ambiente:process.env.FOCUS_AMBIENTE === 'producao' ? 'producao' : 'homologacao',
    // mensalidade pelo Asaas: só aparece na tela quando a chave estiver cadastrada na Vercel
    mensalidade:process.env.ASAAS_API_KEY ? { valor:Number(String(process.env.ASAAS_VALOR || '').replace(',', '.')) || 89.99, teste:process.env.ASAAS_AMBIENTE !== 'producao' } : null });
}
