/* =====================================================================
   NotaOne — MÓDULO SERVIÇO › ACADEMIA
   Tudo o que é só da academia fica neste arquivo. Mudança pedida "só na
   academia" é feita aqui e não altera o comércio nem outros serviços.
   Usa as funções do núcleo (index.html): S, put, del, esc, brl, num, r2,
   isoNow, diaMais, dataBR, fld, sel, openModal, closeModal, mhead, toast,
   safe, val, $, uid, caixaAberto, PAGAMENTOS, PAG_NOME, pode, render.
   Coleções próprias (empresas/<id>/...): ac_alunos, ac_planos,
   ac_mensalidades, ac_checkins.
   ===================================================================== */
(window.NOTAONE_MODULOS = window.NOTAONE_MODULOS || []).push(() => {
  const hojeISO = () => isoNow().slice(0, 10);
  // soma meses a uma data AAAA-MM-DD (31/01 + 1 mês = 28 ou 29/02)
  const maisMeses = (iso, n) => {
    const [y, m, d] = iso.split('-').map(Number), alvo = new Date(Date.UTC(y, m - 1 + n, 1));
    const ult = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
    alvo.setUTCDate(Math.min(d, ult)); return alvo.toISOString().slice(0, 10);
  };
  const dias = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
  const alunos = () => S.ac_alunos || [], planosAc = () => (S.ac_planos || []).slice().sort((a, b) => num(a.meses) - num(b.meses) || num(a.valor) - num(b.valor));
  const planoAc = id => planosAc().find(p => p.id === id) || null;
  // check-in excluído (selecionou o aluno errado) fica marcado e não conta em lugar nenhum
  const checkins = () => (S.ac_checkins || []).filter(c => !c.excluido);
  const mensais = () => (S.ac_mensalidades || []).filter(m => !m.estornada);
  // valor da mensalidade: cada aluno tem o seu (cadastro do aluno); vem preenchido com o valor do plano escolhido
  const MAX_PLANOS = 4; // pedido do Lucas: a academia cria até 4 planos (descrição + valor), em Empresa → Mensalidade da academia
  const mensalDoAluno = a => num(a && a.valor_mensal) || 0;
  // valor a cobrar por período: mensalidade do aluno × meses do plano; sem valor no aluno, vale o preço do plano
  const valorCobrar = (a, p) => { const m = mensalDoAluno(a); return m ? r2(m * (num((p || {}).meses) || 1)) : num((p || {}).valor); };
  const mensalEquivA = a => { const m = mensalDoAluno(a); if (m) return m; const p = planoAc(a.plano_id); return p ? r2(num(p.valor) / (num(p.meses) || 1)) : 0; };
  const fone = t => { const d = dig(t); return d.length >= 10 ? (d.startsWith('55') ? d : '55' + d) : ''; };

  // situação do aluno pela data "pago até"
  function situacao(a){
    if (a.inativo) return { k:'inativo', txt:'inativo', cls:'' };
    if (!a.valido_ate) return { k:'atrasado', txt:'sem pagamento', cls:'b', dias:0 };
    const d = dias(hojeISO(), a.valido_ate);
    if (d < 0) return { k:'atrasado', txt:`atrasado ${-d} dia${d === -1 ? '' : 's'}`, cls:'b', dias:-d };
    if (d <= 7) return { k:'vencendo', txt:d === 0 ? 'vence hoje' : `vence em ${d} dia${d === 1 ? '' : 's'}`, cls:'w', dias:d };
    return { k:'emdia', txt:'em dia', cls:'g', dias:d };
  }
  const tagSit = a => { const s = situacao(a); return `<span class="tag ${s.cls}">${s.txt}</span>`; };

  /* ---------------- Alunos ---------------- */
  function vAlunos(){
    const f = S.acFiltro || 'ativos', q = (S.acBusca || '').trim().toLowerCase(), L = alunos();
    const cont = { ativos:L.filter(a => !a.inativo).length, atrasados:L.filter(a => situacao(a).k === 'atrasado').length, vencendo:L.filter(a => situacao(a).k === 'vencendo').length, inativos:L.filter(a => a.inativo).length, todos:L.length };
    const lista = L.filter(a => f === 'todos' || (f === 'ativos' && !a.inativo) || (f === 'inativos' && a.inativo) || situacao(a).k === f.replace(/s$/, ''))
      .filter(a => !q || (a.nome || '').toLowerCase().includes(q) || dig(a.cpf).includes(dig(q) || '§') || dig(a.telefone).includes(dig(q) || '§'))
      .sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
    return `<div class="row" style="align-items:center"><h2 style="flex:1">Alunos</h2><button class="btn pri" data-act="acNovoAluno" style="flex:0 0 auto">+ Novo aluno</button></div>
    <div class="card"><input id="acBusca" placeholder="Buscar por nome, CPF ou telefone…" value="${esc(S.acBusca || '')}" autocomplete="off">
      <div class="seg" style="margin-top:8px;flex-wrap:wrap">${[['ativos','Ativos'],['atrasados','Atrasados'],['vencendo','Vencendo'],['inativos','Inativos'],['todos','Todos']].map(([k, l]) => `<button data-act="acFiltro" data-f="${k}" class="${f === k ? 'on' : ''}">${l} (${cont[k]})</button>`).join('')}</div></div>
    <div class="card">${lista.length ? `<div class="fin-lista">${lista.map(a => { const p = planoAc(a.plano_id), s = situacao(a); return `
      <div class="fin-l nt-l ${s.k === 'atrasado' ? 'vencido' : s.k === 'vencendo' ? 'hoje' : ''}" data-act="acVerAluno" data-id="${esc(a.id)}">
        <div class="fin-v">${a.valido_ate ? a.valido_ate.slice(8, 10) + '/' + a.valido_ate.slice(5, 7) : '—'}<small>pago até</small></div>
        <div class="fin-d"><b>${esc(a.nome)}</b><span>${esc(p ? p.nome : 'sem plano')}${a.telefone ? ' · ' + esc(a.telefone) : ''}${a.ultimo_checkin ? ' · último treino ' + dataBR(a.ultimo_checkin) : ''}</span></div>
        <div class="fin-r">${tagSit(a)}${!a.inativo && pode('caixa') ? `<button class="btn sm pri" data-act="acReceber" data-id="${esc(a.id)}">Receber</button>` : ''}</div></div>`; }).join('')}</div>`
      : `<p class="empty">${L.length ? 'Nenhum aluno neste filtro.' : 'Nenhum aluno cadastrado ainda. Toque em <b>+ Novo aluno</b>.'}</p>`}</div>`;
  }
  function formAluno(a){
    a = a || { inicio:hojeISO(), valido_ate:hojeISO() };
    const P = planosAc();
    openModal(`${mhead(a.id ? 'Editar aluno' : 'Novo aluno')}
      <div class="row">${fld('acNome', 'Nome completo *', a.nome)}${fld('acCpf', 'CPF', a.cpf ? fmtDoc(a.cpf) : '', 'inputmode="numeric" autocomplete="off"')}</div>
      <div class="row">${fld('acFone', 'WhatsApp', a.telefone, 'inputmode="tel" placeholder="(86) 99999-9999"')}${fld('acNasc', 'Nascimento', a.nascimento, 'type="date"')}</div>
      <div class="row">${sel('acPlano', 'Plano *', a.plano_id || (P[0] || {}).id || '', P.length ? P.map(p => [p.id, `${p.nome} — ${brl(p.valor)}`]) : [['', 'Crie os planos em Empresa → Mensalidade da academia']])}${fld('acValor', 'Valor da mensalidade *', a.valor_mensal ? brl(a.valor_mensal) : P.length ? brl((planoAc(a.plano_id) || P[0]).valor) : '', 'data-rs inputmode="decimal"')}</div>
      <div class="row">${fld('acVenc', a.id ? 'Pago até' : 'Primeiro vencimento', a.valido_ate || hojeISO(), 'type="date"')}<div></div></div>
      ${fld('acObs', 'Observações (saúde, objetivo, restrições)', a.obs)}
      ${a.id ? `<label class="chk"><input type="checkbox" id="acInativo" ${a.inativo ? 'checked' : ''}> Aluno inativo (parou de treinar)</label>` : `<label class="chk"><input type="checkbox" id="acPagarJa" checked> Receber a primeira mensalidade agora</label>`}
      <div id="errM"></div>
      <div class="actions">${a.id && pode('empresa') ? `<button class="btn bad" data-act="acDelAluno" data-id="${esc(a.id)}">Excluir</button>` : ''}<button class="btn pri" data-act="acSalvarAluno" data-id="${esc(a.id || '')}">Salvar</button></div>`);
  }
  async function salvarAluno(id){
    const antigo = id ? alunos().find(x => x.id === id) : null;
    const a = { ...(antigo || {}), id:id || undefined, nome:val('acNome'), cpf:dig(val('acCpf')), telefone:val('acFone'), nascimento:val('acNasc'), plano_id:val('acPlano'), valor_mensal:r2(numIn(val('acValor'))), valido_ate:val('acVenc'), obs:val('acObs') };
    if ($('#acInativo')) a.inativo = $('#acInativo').checked;
    if (!antigo) a.inicio = hojeISO();
    const e = [];
    if (a.nome.length < 3) e.push('Informe o nome do aluno.');
    if (!a.plano_id) e.push('Crie os planos em Empresa → Mensalidade da academia e escolha um.');
    if (!(a.valor_mensal > 0)) e.push('Informe o valor da mensalidade do aluno.');
    if (a.cpf && a.cpf.length !== 11) e.push('CPF incompleto.');
    if (a.cpf && alunos().some(x => x.id !== id && x.cpf === a.cpf)) e.push('Já existe um aluno com este CPF.');
    if (e.length) return $('#errM').innerHTML = `<div class="msg err">${e.join('<br>')}</div>`;
    const pagarJa = !antigo && $('#acPagarJa') && $('#acPagarJa').checked;
    let salvo; if (!await safe(async () => { salvo = await put('ac_alunos', a); }, 'Aluno salvo.')) return;
    if (pagarJa) formReceber(salvo.id, salvo); else closeModal();
  }
  function verAluno(id){
    const a = alunos().find(x => x.id === id); if (!a) return;
    const p = planoAc(a.plano_id), M = mensais().filter(m => m.aluno_id === id).sort((x, y) => String(y.pago_em).localeCompare(String(x.pago_em)));
    const C = checkins().filter(c => c.aluno_id === id).sort((x, y) => String(y.em).localeCompare(String(x.em)));
    const s = situacao(a), tel = fone(a.telefone), msg = encodeURIComponent(msgAviso(a));
    openModal(`${mhead(esc(a.nome))}
      <p>${tagSit(a)} · mensalidade <b>${brl(mensalEquivA(a))}</b>${p ? ` · plano <b>${esc(p.nome)}</b>${num(p.meses) > 1 ? ` (${brl(valorCobrar(a, p))} a cada ${p.meses} meses)` : ''}` : ''} · pago até <b>${a.valido_ate ? dataBR(a.valido_ate) : '—'}</b></p>
      <p class="small">${a.cpf ? 'CPF ' + fmtDoc(a.cpf) + ' · ' : ''}${a.telefone ? 'WhatsApp ' + esc(a.telefone) + ' · ' : ''}aluno desde ${dataBR(a.inicio)}${a.nascimento ? ' · nascimento ' + dataBR(a.nascimento) : ''}</p>
      ${a.obs ? `<div class="msg info">${esc(a.obs)}</div>` : ''}
      <div class="actions" style="justify-content:flex-start">${pode('caixa') && !a.inativo ? `<button class="btn pri" data-act="acReceber" data-id="${esc(a.id)}">Receber mensalidade</button>` : ''}
        ${tel ? `<a class="btn" target="_blank" rel="noopener" href="https://wa.me/${tel}?text=${msg}">${s.k === 'atrasado' ? 'Cobrar' : 'Avisar'} no WhatsApp</a>` : ''}
        <button class="btn" data-act="acEditAluno" data-id="${esc(a.id)}">Editar</button></div>
      <h3>Pagamentos</h3>${M.length ? M.slice(0, 12).map(m => `<div class="total"><span>${dataBR(m.pago_em)} · ${esc(PAG_NOME[m.forma] || 'Outros')} · ${dataBR(m.de)} a ${dataBR(m.ate)}</span><span class="num">${brl(m.valor)}${pode('empresa') ? ` <button class="btn sm" data-act="acEstornar" data-id="${esc(m.id)}" title="Desfazer este pagamento">desfazer</button>` : ''}</span></div>`).join('') : '<p class="small">Nenhum pagamento registrado.</p>'}
      <h3>Últimos treinos</h3>${C.length ? `<p class="small">${C.slice(0, 10).map(c => dataBR(c.em) + ' ' + c.em.slice(11, 16)).join(' · ')}</p><p class="small">${C.filter(c => c.em.slice(0, 7) === hojeISO().slice(0, 7)).length} treino(s) este mês.</p>` : '<p class="small">Nenhum check-in ainda.</p>'}`);
  }

  // aviso de vencimento / cobrança pelo WhatsApp (abre a conversa com a mensagem pronta)
  function msgAviso(a){
    const s = situacao(a), nome = (a.nome || '').split(' ')[0], loja = (emp() || {}).fantasia || 'academia';
    return `Olá ${nome}! Aqui é da ${loja}. ${s.k === 'atrasado' ? `Sua mensalidade está em atraso desde ${dataBR(a.valido_ate)}.` : s.dias === 0 ? 'Sua mensalidade vence hoje.' : `Sua mensalidade vence em ${dataBR(a.valido_ate)}.`} Qualquer dúvida estamos à disposição. 💪`;
  }
  const linkZap = (a, cls = '') => { const t = fone(a.telefone); return t ? `<a class="btn ${cls}" target="_blank" rel="noopener" href="https://wa.me/${t}?text=${encodeURIComponent(msgAviso(a))}" title="Abrir o WhatsApp com a mensagem pronta" onclick="event.stopPropagation()">${situacao(a).k === 'atrasado' ? 'Cobrar' : 'Avisar'}</a>` : ''; };

  /* ---------------- Receber mensalidade ---------------- */
  function formReceber(id, aNovo){
    const a = aNovo || alunos().find(x => x.id === id); if (!a) return;
    const P = planosAc(); if (!P.length) return toast('Crie os planos da academia em Empresa → Mensalidade da academia.');
    const p = planoAc(a.plano_id) || P[0], hoje = hojeISO();
    // renova a partir do "pago até" se ainda estiver em dia; atrasado renova a partir do vencimento (mantém o dia)
    const de = a.valido_ate || hoje;
    S.acRec = { aluno:a, de };
    openModal(`${mhead('Receber mensalidade')}
      <p><b>${esc(a.nome)}</b> · ${tagSit(a)}</p>
      <div class="row">${sel('acRPlano', 'Plano', p.id, P.map(x => [x.id, `${x.nome} — ${brl(x.valor)}`]))}${sel('acRMeses', 'Pagando quantos meses', String(num(p.meses) || 1), [['1','1 mês'],['2','2 meses'],['3','3 meses'],['6','6 meses'],['12','12 meses']])}</div>
      ${fld('acRValor', 'Valor recebido', brl(valorCobrar(a, p)), 'data-rs inputmode="decimal"')}
      <div class="row">${sel('acRForma', 'Forma de pagamento', '17', PAGAMENTOS.filter(([c]) => ['01','17','04','03','99'].includes(c)))}${fld('acRDe', 'Período começa em', de, 'type="date"')}</div>
      <div id="acRAte" class="msg info"></div><div id="errM"></div>
      ${caixaAberto() ? '' : '<p class="small">O caixa está fechado: o pagamento fica registrado, mas não entra na conferência do caixa.</p>'}
      <div class="actions"><button class="btn pri" data-act="acSalvarReceb">Confirmar recebimento</button></div>`);
    atualizarAte();
  }
  function atualizarAte(){
    const n = +val('acRMeses') || 1, de = val('acRDe'), el = $('#acRAte'); if (!de || !el) return;
    el.innerHTML = `Pago até <b>${dataBR(maisMeses(de, n))}</b> (${n} ${n > 1 ? 'meses' : 'mês'}).`;
  }
  async function salvarReceb(){
    const r = S.acRec || {}, a = alunos().find(x => x.id === r.aluno.id) || r.aluno, p = planoAc(val('acRPlano')), de = val('acRDe'), valor = numIn(val('acRValor'));
    if (!p) return $('#errM').innerHTML = '<div class="msg err">Escolha o plano.</div>';
    if (!(valor > 0)) return $('#errM').innerHTML = '<div class="msg err">Informe o valor recebido.</div>';
    if (!de) return $('#errM').innerHTML = '<div class="msg err">Informe a data de início do período.</div>';
    const meses = +val('acRMeses') || 1, ate = maisMeses(de, meses), cx = caixaAberto();
    const m = { id:uid(), aluno_id:a.id, aluno_nome:a.nome, plano_id:p.id, plano_nome:p.nome, meses, de, ate, valor:r2(valor), forma:val('acRForma'), pago_em:isoNow(), recebido_por:S.meuId || null, caixa:cx ? cx.id : null, ate_anterior:a.valido_ate || null };
    const ok = await safe(async () => { await put('ac_mensalidades', m); await put('ac_alunos', { ...a, plano_id:p.id, valido_ate:ate, inativo:false }); }, `Recebido! ${a.nome.split(' ')[0]} pago até ${dataBR(ate)}.`);
    if (ok){ closeModal(); S.acRec = null; }
  }
  async function estornar(id){
    const m = (S.ac_mensalidades || []).find(x => x.id === id); if (!m) return;
    if (!confirm(`Desfazer o pagamento de ${brl(m.valor)} de ${m.aluno_nome} (${dataBR(m.pago_em)})?`)) return;
    const a = alunos().find(x => x.id === m.aluno_id);
    await safe(async () => {
      await put('ac_mensalidades', { ...m, estornada:true, estornada_em:isoNow() });
      if (a && a.valido_ate === m.ate) await put('ac_alunos', { ...a, valido_ate:m.ate_anterior || m.de });
    }, 'Pagamento desfeito.');
    closeModal();
  }

  /* ---------------- Check-in (entrada do aluno) ---------------- */
  function vCheckin(){
    const q = (S.acCk || '').trim().toLowerCase(), hoje = hojeISO();
    const res = q ? alunos().filter(a => !a.inativo && ((a.nome || '').toLowerCase().includes(q) || (dig(q) && dig(a.cpf).startsWith(dig(q))))).slice(0, 8) : [];
    const hj = checkins().filter(c => (c.em || '').slice(0, 10) === hoje).sort((a, b) => b.em.localeCompare(a.em));
    const u = S.acUltimo, ua = u && alunos().find(a => a.id === u.aluno_id);
    return `<h2>Check-in</h2>
    ${ua && !u.excluido ? (() => { const s = situacao(ua); const ok = s.k !== 'atrasado'; return `<div class="card" style="border:2px solid ${ok ? 'var(--ok)' : 'var(--bad)'};background:${ok ? '#effaf3' : '#fff1f1'}">
      <div style="font-size:13px;color:#5b6478;display:flex;align-items:center;gap:8px">${u.em.slice(11, 16)} · entrada registrada <button class="btn sm" data-act="acDelCheck" data-id="${esc(u.id)}" style="margin-left:auto">Aluno errado? Excluir</button></div>
      <div style="font-family:'Space Grotesk',sans-serif;font-size:26px;font-weight:700">${ok ? '✓' : '!'} ${esc(ua.nome)}</div>
      <div style="font-size:16px">${ok ? `Liberado · pago até <b>${dataBR(ua.valido_ate)}</b>${s.k === 'vencendo' ? ' · <b>' + s.txt + '</b>' : ''}` : `<b>${s.dias ? `Mensalidade atrasada há ${s.dias} dia${s.dias === 1 ? '' : 's'}` : 'Sem mensalidade paga'}</b> — peça para passar na recepção`}</div>
      ${!ok && pode('caixa') ? `<div class="actions" style="justify-content:flex-start"><button class="btn pri" data-act="acReceber" data-id="${esc(ua.id)}">Receber agora</button></div>` : ''}</div>`; })() : ''}
    <div class="card"><label for="acCkBusca">Nome ou CPF do aluno</label>
      <input id="acCkBusca" placeholder="Digite e toque no aluno…" value="${esc(S.acCk || '')}" autocomplete="off" style="font-size:18px">
      <div class="results">${res.map(a => `<div class="res" data-act="acCheck" data-id="${esc(a.id)}"><span>${esc(a.nome)} <span class="small">${a.cpf ? fmtDoc(a.cpf) : ''}</span></span>${tagSit(a)}</div>`).join('') || (q ? '<div class="small" style="padding:8px">Nenhum aluno ativo encontrado.</div>' : '')}</div></div>
    <div class="card"><h3 style="margin-top:0">Hoje: ${hj.length} entrada${hj.length === 1 ? '' : 's'}</h3>
      ${hj.length ? hj.slice(0, 40).map(c => `<div class="total"><span>${c.em.slice(11, 16)} · ${esc(c.nome)}</span><span>${c.atrasado ? '<span class="tag b">atrasado</span>' : '<span class="tag g">ok</span>'} <button class="btn sm" data-act="acDelCheck" data-id="${esc(c.id)}" title="Excluir este check-in">excluir</button></span></div>`).join('') : '<p class="small">Ninguém treinou ainda hoje.</p>'}</div>`;
  }
  // excluir check-in feito no aluno errado (qualquer usuário da recepção; fica marcado como excluído)
  async function excluirCheckin(id){
    const c = (S.ac_checkins || []).find(x => x.id === id); if (!c || c.excluido) return;
    if (!confirm(`Excluir o check-in de ${c.nome} às ${c.em.slice(11, 16)}?`)) return;
    const a = alunos().find(x => x.id === c.aluno_id);
    const ok = await safe(async () => {
      await put('ac_checkins', { ...c, excluido:true, excluido_em:isoNow(), excluido_por:S.meuId || null });
      if (a && a.ultimo_checkin === c.em){ // volta o "último treino" para o check-in anterior
        const ant = checkins().filter(x => x.aluno_id === a.id && x.id !== c.id).sort((x, y) => String(y.em).localeCompare(String(x.em)))[0];
        await put('ac_alunos', { ...a, ultimo_checkin:ant ? ant.em : null });
      }
    }, 'Check-in excluído.');
    if (ok && S.acUltimo && S.acUltimo.id === id) S.acUltimo = null;
    if (ok) render();
  }
  async function checkin(id){
    const a = alunos().find(x => x.id === id); if (!a) return;
    const em = isoNow(), atrasado = situacao(a).k === 'atrasado';
    const c = { id:uid(), aluno_id:a.id, nome:a.nome, em, atrasado };
    if (await safe(async () => { await put('ac_checkins', c); await put('ac_alunos', { ...a, ultimo_checkin:em }); })){ S.acUltimo = c; S.acCk = ''; render(); setTimeout(() => { const el = $('#acCkBusca'); if (el) el.focus(); }, 50); }
  }

  /* ---------------- Mensalidades (recebidas, a receber, planos) ---------------- */
  function vMensal(){
    const mes = S.acMes || hojeISO().slice(0, 7), M = mensais().filter(m => (m.pago_em || '').slice(0, 7) === mes).sort((a, b) => b.pago_em.localeCompare(a.pago_em));
    const tot = r2(M.reduce((s, m) => s + num(m.valor), 0));
    const pend = alunos().filter(a => ['atrasado','vencendo'].includes(situacao(a).k)).sort((a, b) => String(a.valido_ate).localeCompare(String(b.valido_ate)));
    const prev = pend.reduce((s, a) => s + valorCobrar(a, planoAc(a.plano_id)), 0);
    const meses = [...new Set([hojeISO().slice(0, 7), ...mensais().map(m => (m.pago_em || '').slice(0, 7))])].sort().reverse();
    return `<h2>Mensalidades</h2>
    <div class="card"><div class="stats"><div><b>${brl(tot)}</b>recebido no mês</div><div><b>${M.length}</b>pagamentos</div><div><b>${pend.length}</b>a receber (${brl(prev)})</div></div></div>
    <div class="grid2"><div class="card"><h3 style="margin-top:0">A receber — atrasados e vencendo em 7 dias</h3>${pend.length ? `<div class="fin-lista">${pend.map(a => `
        <div class="fin-l nt-l ${situacao(a).k === 'atrasado' ? 'vencido' : 'hoje'}" data-act="acVerAluno" data-id="${esc(a.id)}"><div class="fin-v">${a.valido_ate ? a.valido_ate.slice(8, 10) + '/' + a.valido_ate.slice(5, 7) : '—'}<small>venc.</small></div>
          <div class="fin-d"><b>${esc(a.nome)}</b><span>${esc((planoAc(a.plano_id) || {}).nome || 'sem plano')} · ${brl(valorCobrar(a, planoAc(a.plano_id)))}</span></div>
          <div class="fin-r">${tagSit(a)}${linkZap(a, 'sm')}${pode('caixa') ? `<button class="btn sm pri" data-act="acReceber" data-id="${esc(a.id)}">Receber</button>` : ''}</div></div>`).join('')}</div>` : '<p class="small">Ninguém atrasado nem vencendo. 🎉</p>'}</div>
      <div><div class="card"><div class="row" style="align-items:center"><h3 style="margin:0;flex:1">Recebidas</h3><select id="acMesSel" style="flex:0 0 auto;width:auto">${meses.map(m => `<option value="${m}" ${m === mes ? 'selected' : ''}>${m.slice(5)}/${m.slice(0, 4)}</option>`).join('')}</select></div>
        ${M.length ? `<div class="fin-lista">${M.map(m => `<div class="fin-l pago"><div class="fin-v">${m.pago_em.slice(8, 10)}/${m.pago_em.slice(5, 7)}<small>${m.pago_em.slice(11, 16)}</small></div>
          <div class="fin-d" data-act="acVerAluno" data-id="${esc(m.aluno_id)}"><b>${esc(m.aluno_nome)}</b><span>${esc(m.plano_nome || '')} · ${esc(PAG_NOME[m.forma] || 'Outros')} · até ${dataBR(m.ate)}</span></div>
          <div class="fin-r"><b class="num">${brl(m.valor)}</b></div></div>`).join('')}</div>` : '<p class="small">Nenhum pagamento neste mês.</p>'}</div>
    </div></div>`;
  }
  function formPlano(p){
    p = p || {};
    openModal(`${mhead(p.id ? 'Editar plano' : 'Criar plano')}
      ${fld('acPNome', 'Descrição do plano *', p.nome, 'placeholder="Ex.: Musculação, Musculação + Funcional, Plano família"')}
      ${fld('acPValor', 'Valor da mensalidade *', p.valor ? brl(p.valor) : '', 'data-rs inputmode="decimal" placeholder="R$ 0,00"')}<div id="errM"></div>
      <div class="actions">${p.id ? `<button class="btn bad" data-act="acDelPlano" data-id="${esc(p.id)}">Excluir</button>` : ''}<button class="btn pri" data-act="acSalvarPlano" data-id="${esc(p.id || '')}">Salvar plano</button></div>`);
    setTimeout(() => { const el = $('#acPNome'); if (el) el.focus(); }, 50);
  }
  async function salvarPlano(id){
    const antigo = id ? planoAc(id) : null;
    if (!antigo && planosAc().length >= MAX_PLANOS) return $('#errM').innerHTML = `<div class="msg err">A academia pode ter até ${MAX_PLANOS} planos. Edite ou exclua um plano antes de criar outro.</div>`;
    const p = { ...(antigo || {}), id:id || undefined, nome:val('acPNome'), meses:num((antigo || {}).meses) || 1, valor:r2(numIn(val('acPValor'))) };
    if (p.nome.length < 2 || !(p.valor > 0)) return $('#errM').innerHTML = '<div class="msg err">Informe a descrição e o valor do plano.</div>';
    if (await safe(() => put('ac_planos', p), 'Plano salvo.')) closeModal();
  }

  /* ---------------- quadro na aba Empresa: planos da academia (até 4) ---------------- */
  function empresaHtml(){
    if (!pode('empresa')) return '';
    const P = planosAc();
    return `<div class="card"><div class="row" style="align-items:center"><h3 style="margin:0;flex:1">Mensalidade da academia</h3>${P.length < MAX_PLANOS ? '<button class="btn pri" data-act="acNovoPlano" style="flex:0 0 auto">+ Criar plano</button>' : ''}</div>
      <p class="small">Crie até ${MAX_PLANOS} planos com a descrição e o valor da mensalidade. No cadastro do aluno você escolhe o plano e o valor já vem preenchido (dá para mudar por aluno).</p>
      ${P.length ? P.map(p => `<div class="total"><span><b>${esc(p.nome)}</b> <span class="small">${num(p.meses) > 1 ? p.meses + ' meses · ' : ''}${alunos().filter(a => a.plano_id === p.id && !a.inativo).length} aluno(s)</span></span><span class="num">${brl(p.valor)} <button class="btn sm" data-act="acEditPlano" data-id="${esc(p.id)}">editar</button></span></div>`).join('')
        : '<p class="small"><b>Nenhum plano ainda.</b> Toque em <b>+ Criar plano</b>.</p>'}
      ${P.length >= MAX_PLANOS ? `<p class="small">Limite de ${MAX_PLANOS} planos atingido.</p>` : ''}</div>`;
  }

  /* ---------------- quadro no Início ---------------- */
  function inicioHtml(){
    const L = alunos(), at = L.filter(a => situacao(a).k === 'atrasado'), ve = L.filter(a => situacao(a).k === 'vencendo'), ativos = L.filter(a => !a.inativo).length;
    const hoje = hojeISO(), ck = checkins().filter(c => (c.em || '').slice(0, 10) === hoje).length;
    const mes = r2(mensais().filter(m => (m.pago_em || '').slice(0, 7) === hoje.slice(0, 7)).reduce((s, m) => s + num(m.valor), 0));
    // pedido do Lucas: aniversariantes do dia e mensalidades que vencem hoje
    const venceHoje = L.filter(a => !a.inativo && a.valido_ate === hoje), valHoje = r2(venceHoje.reduce((s, a) => s + valorCobrar(a, planoAc(a.plano_id)), 0));
    const aniv = L.filter(a => !a.inativo && (a.nascimento || '').slice(5, 10) === hoje.slice(5, 10));
    const loja = (emp() || {}).fantasia || 'academia';
    const parabens = a => { const t = fone(a.telefone); return t ? `<a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/${t}?text=${encodeURIComponent(`Feliz aniversário, ${a.nome.split(' ')[0]}! 🎉 A equipe da ${loja} deseja muita saúde e ótimos treinos! 💪`)}">Parabenizar</a>` : ''; };
    return `<div class="card"><div class="row" style="align-items:center"><h3 style="margin:0;flex:1">Academia</h3><button class="btn pri" data-tab="ac_checkin" style="flex:0 0 auto">Check-in</button></div>
      <div class="stats"><div><b>${ativos}</b>alunos ativos</div><div><b>${ck}</b>treinos hoje</div><div style="cursor:pointer" data-tab="ac_mensal"><b style="${venceHoje.length ? 'color:var(--warn)' : ''}">${venceHoje.length}</b>vence${venceHoje.length === 1 ? '' : 'm'} hoje${venceHoje.length ? ' · ' + brl(valHoje) : ''}</div><div><b>${aniv.length}</b>aniversariante${aniv.length === 1 ? '' : 's'} hoje</div><div><b>${brl(mes)}</b>mensalidades no mês</div></div>
      ${venceHoje.length ? `<h3>Vencem hoje</h3>${venceHoje.map(a => `<div class="total"><span style="cursor:pointer" data-act="acVerAluno" data-id="${esc(a.id)}"><b>${esc(a.nome)}</b> <span class="small">${esc((planoAc(a.plano_id) || {}).nome || '')}</span></span><span class="num">${brl(valorCobrar(a, planoAc(a.plano_id)))} ${linkZap(a, 'sm')}${pode('caixa') ? ` <button class="btn sm pri" data-act="acReceber" data-id="${esc(a.id)}">Receber</button>` : ''}</span></div>`).join('')}` : ''}
      ${aniv.length ? `<h3>🎂 Aniversariantes de hoje</h3>${aniv.map(a => `<div class="total"><span style="cursor:pointer" data-act="acVerAluno" data-id="${esc(a.id)}"><b>${esc(a.nome)}</b> <span class="small">${(() => { const id = +hoje.slice(0, 4) - +a.nascimento.slice(0, 4); return id > 0 && id < 120 ? id + ' anos' : ''; })()}</span></span><span>${parabens(a)}</span></div>`).join('')}` : ''}
      ${at.length ? `<div class="msg err" style="cursor:pointer" data-act="acFiltro" data-f="atrasados" data-ir="1"><b>${at.length}</b> aluno(s) com mensalidade atrasada — toque para ver</div>` : ''}
      ${ve.length ? `<div class="msg info" style="cursor:pointer" data-act="acFiltro" data-f="vencendo" data-ir="1"><b>${ve.length}</b> mensalidade(s) vencendo nos próximos 7 dias</div>` : ''}
      ${!planosAc().length && pode('empresa') ? '<div class="msg info" style="cursor:pointer" data-tab="empresa">Primeiro passo: crie os planos da academia em <b>Empresa → Mensalidade da academia</b>.</div>' : ''}</div>`;
  }

  /* ---------------- Relatórios de serviço (no lugar dos relatórios de venda) ----------------
     Usam o modelo dos relatórios do núcleo: { titulo, sub, kpis, secoes } → tela, imprimir/PDF e planilha. */
  const RAB_AC = [['receb', 'Recebimentos'], ['inad', 'Inadimplência'], ['alunos', 'Alunos e frequência'], ['fin', 'Financeiro']];
  const noPer = (d, ini, fim) => { d = String(d || '').slice(0, 10); return d >= ini && d <= fim; };
  const DSEM = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  function relModelo(){
    const aba = S.acRelAba || 'receb', [ini, fim] = relPeriodo(), sub = aba === 'inad' ? `Situação em ${dataBR(hojeISO())}` : `Período: ${dataBR(ini)} a ${dataBR(fim)}`;
    const M = mensais().filter(m => noPer(m.pago_em, ini, fim)), P = planosAc(), L = alunos(), hoje = hojeISO();
    if (aba === 'receb'){
      const tot = r2(M.reduce((s, m) => s + num(m.valor), 0)), porF = {}, porP = {}, porD = {};
      M.forEach(m => { const v = num(m.valor), f = PAG_NOME[m.forma] || 'Outros', pl = m.plano_nome || 'Sem plano', d = m.pago_em.slice(0, 10);
        porF[f] = porF[f] || [0, 0]; porF[f][0]++; porF[f][1] = r2(porF[f][1] + v);
        porP[pl] = porP[pl] || [0, 0]; porP[pl][0]++; porP[pl][1] = r2(porP[pl][1] + v);
        porD[d] = porD[d] || [0, 0]; porD[d][0]++; porD[d][1] = r2(porD[d][1] + v); });
      return { titulo:'Recebimentos de mensalidades', sub,
        kpis:[[brl(tot), 'recebido'], [M.length, 'pagamentos'], [brl(M.length ? r2(tot / M.length) : 0), 'ticket médio'], [new Set(M.map(m => m.aluno_id)).size, 'alunos que pagaram']],
        secoes:[
          { tit:'Por forma de pagamento', cols:[{ t:'Forma' }, { t:'Pagamentos', f:'qtd' }, { t:'Valor', f:'brl' }, { t:'%', f:'pct' }], linhas:Object.entries(porF).sort((a, b) => b[1][1] - a[1][1]).map(([k, [q, v]]) => [k, q, v, tot ? v / tot * 100 : 0]) },
          { tit:'Por plano', cols:[{ t:'Plano' }, { t:'Pagamentos', f:'qtd' }, { t:'Valor', f:'brl' }], linhas:Object.entries(porP).sort((a, b) => b[1][1] - a[1][1]).map(([k, [q, v]]) => [k, q, v]) },
          { tit:'Por dia', cols:[{ t:'Data', f:'data' }, { t:'Pagamentos', f:'qtd' }, { t:'Valor', f:'brl' }], linhas:Object.entries(porD).sort().map(([k, [q, v]]) => [k, q, v]) },
          { tit:'Pagamentos', cols:[{ t:'Data', f:'data' }, { t:'Aluno' }, { t:'Plano' }, { t:'Forma' }, { t:'Pago até', f:'data' }, { t:'Valor', f:'brl' }], linhas:M.slice().sort((a, b) => a.pago_em.localeCompare(b.pago_em)).map(m => [m.pago_em, m.aluno_nome, m.plano_nome || '', PAG_NOME[m.forma] || 'Outros', m.ate, num(m.valor)]) }] };
    }
    if (aba === 'inad'){
      const ativos = L.filter(a => !a.inativo), at = ativos.filter(a => situacao(a).k === 'atrasado');
      const devido = a => { const p = planoAc(a.plano_id), d = situacao(a).dias || 0; return r2(valorCobrar(a, p) * Math.max(1, Math.ceil(d / (30 * (num((p || {}).meses) || 1))))); };
      const totAt = r2(at.reduce((s, a) => s + devido(a), 0)), em15 = diaMais(hoje, 15);
      const ven = ativos.filter(a => a.valido_ate && a.valido_ate >= hoje && a.valido_ate <= em15).sort((a, b) => a.valido_ate.localeCompare(b.valido_ate));
      return { titulo:'Inadimplência e vencimentos', sub,
        kpis:[[at.length, 'alunos atrasados', at.length ? 'var(--bad)' : ''], [brl(totAt), 'em atraso (estimado)'], [ativos.length ? String(Math.round(at.length / ativos.length * 1000) / 10).replace('.', ',') + '%' : '0%', 'dos alunos ativos'], [ven.length, 'vencem em 15 dias']],
        secoes:[
          { tit:'Atrasados', nota:'Valor estimado = valor do plano × períodos em atraso.', cols:[{ t:'Aluno' }, { t:'WhatsApp' }, { t:'Plano' }, { t:'Venceu em', f:'data' }, { t:'Dias', f:'qtd' }, { t:'Valor', f:'brl' }],
            linhas:at.sort((a, b) => String(a.valido_ate).localeCompare(String(b.valido_ate))).map(a => [a.nome, a.telefone || '', (planoAc(a.plano_id) || {}).nome || '', a.valido_ate || '', situacao(a).dias || 0, devido(a)]) },
          { tit:'Vencem nos próximos 15 dias', cols:[{ t:'Aluno' }, { t:'WhatsApp' }, { t:'Plano' }, { t:'Vence em', f:'data' }, { t:'Valor', f:'brl' }],
            linhas:ven.map(a => [a.nome, a.telefone || '', (planoAc(a.plano_id) || {}).nome || '', a.valido_ate, valorCobrar(a, planoAc(a.plano_id))]) }] };
    }
    if (aba === 'alunos'){
      const ativos = L.filter(a => !a.inativo), novos = L.filter(a => noPer(a.inicio, ini, fim)), C = checkins().filter(c => noPer(c.em, ini, fim));
      const freq = {}, dsem = [0, 0, 0, 0, 0, 0, 0], hora = {};
      C.forEach(c => { freq[c.aluno_id] = (freq[c.aluno_id] || 0) + 1; dsem[new Date(c.em.slice(0, 10) + 'T12:00:00').getDay()]++; const h = c.em.slice(11, 13); hora[h] = (hora[h] || 0) + 1; });
      const sumidos = ativos.filter(a => situacao(a).k !== 'atrasado' && (!a.ultimo_checkin || dias(a.ultimo_checkin.slice(0, 10), hoje) >= 15)).sort((a, b) => String(a.ultimo_checkin || '').localeCompare(String(b.ultimo_checkin || '')));
      const mesAtual = hoje.slice(5, 7), aniv = ativos.filter(a => (a.nascimento || '').slice(5, 7) === mesAtual).sort((a, b) => a.nascimento.slice(8).localeCompare(b.nascimento.slice(8)));
      const mrr = r2(ativos.filter(a => situacao(a).k !== 'atrasado').reduce((s, a) => s + mensalEquivA(a), 0));
      return { titulo:'Alunos e frequência', sub,
        kpis:[[ativos.length, 'alunos ativos'], [novos.length, 'novos no período'], [L.filter(a => a.inativo).length, 'inativos'], [C.length, 'treinos no período'], [brl(mrr), 'receita mensal recorrente']],
        secoes:[
          { tit:'Alunos por plano', nota:'Receita mensal = soma das mensalidades dos alunos em dia.', cols:[{ t:'Plano' }, { t:'Ativos', f:'qtd' }, { t:'Receita mensal', f:'brl' }],
            linhas:P.map(p => { const at = ativos.filter(a => a.plano_id === p.id); return [p.nome, at.length, r2(at.filter(a => situacao(a).k !== 'atrasado').reduce((s, a) => s + mensalEquivA(a), 0))]; }) },
          { tit:'Novos alunos no período', cols:[{ t:'Aluno' }, { t:'Início', f:'data' }, { t:'Plano' }], linhas:novos.sort((a, b) => String(a.inicio).localeCompare(String(b.inicio))).map(a => [a.nome, a.inicio, (planoAc(a.plano_id) || {}).nome || '']) },
          { tit:'Sem treinar há 15 dias ou mais (em dia com a mensalidade)', nota:'Bom para chamar de volta antes de o aluno desistir.', cols:[{ t:'Aluno' }, { t:'WhatsApp' }, { t:'Último treino', f:'data' }, { t:'Dias', f:'qtd' }],
            linhas:sumidos.map(a => [a.nome, a.telefone || '', a.ultimo_checkin ? a.ultimo_checkin.slice(0, 10) : 'nunca', a.ultimo_checkin ? dias(a.ultimo_checkin.slice(0, 10), hoje) : '']) },
          { tit:'Mais frequentes no período', cols:[{ t:'Aluno' }, { t:'Treinos', f:'qtd' }], linhas:Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([id, q]) => [(L.find(a => a.id === id) || {}).nome || '—', q]) },
          { tit:'Treinos por dia da semana', cols:[{ t:'Dia' }, { t:'Treinos', f:'qtd' }], linhas:dsem.map((q, i) => [DSEM[i], q]) },
          { tit:'Horários de maior movimento', cols:[{ t:'Hora' }, { t:'Treinos', f:'qtd' }], linhas:Object.entries(hora).sort().map(([h, q]) => [h + 'h', q]) },
          { tit:'Aniversariantes do mês', cols:[{ t:'Aluno' }, { t:'Dia' }, { t:'WhatsApp' }], linhas:aniv.map(a => [a.nome, a.nascimento.slice(8, 10) + '/' + mesAtual, a.telefone || '']) }] };
    }
    // financeiro da academia: o que entrou e saiu no período e a previsão dos próximos 30 dias
    const T = titulosFin_nucleo(), outrasRec = T.filter(t => t.tipo === 'receber' && t.auto !== 'academia' && t.pago_em && noPer(t.pago_em, ini, fim));
    const pagas = T.filter(t => t.tipo === 'pagar' && t.pago_em && noPer(t.pago_em, ini, fim));
    const recM = r2(M.reduce((s, m) => s + num(m.valor), 0)), recO = r2(outrasRec.reduce((s, t) => s + num(t.valor_pago ?? t.valor), 0));
    const porCat = {}; pagas.forEach(t => { const c = t.categoria || 'Outras despesas'; porCat[c] = r2((porCat[c] || 0) + num(t.valor_pago ?? t.valor)); });
    const desp = r2(Object.values(porCat).reduce((s, v) => s + v, 0)), ent = r2(recM + recO), res = r2(ent - desp);
    const em30 = diaMais(hoje, 30), prevRec = L.filter(a => !a.inativo && a.valido_ate && a.valido_ate <= em30).reduce((s, a) => s + valorCobrar(a, planoAc(a.plano_id)), 0);
    const prevPag = T.filter(t => t.tipo === 'pagar' && !t.pago_em && t.venc <= em30).reduce((s, t) => s + num(t.valor), 0);
    return { titulo:'Financeiro da academia', sub,
      kpis:[[brl(ent), 'entrou'], [brl(desp), 'saiu'], [brl(res), 'resultado', res < 0 ? 'var(--bad)' : 'var(--ok)'], [brl(r2(prevRec - prevPag)), 'saldo previsto em 30 dias']],
      secoes:[
        { tit:'Resultado do período', cols:[{ t:'Conta' }, { t:'Valor', f:'brl' }, { t:'% das entradas', f:'pct' }],
          linhas:[['Mensalidades recebidas', recM, ent ? recM / ent * 100 : 0], ['Outras receitas recebidas', recO, ent ? recO / ent * 100 : 0], ['= Total de entradas', ent, 100],
            ...Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => ['(−) ' + c, -v, ent ? v / ent * 100 : 0]), ['= Resultado', res, ent ? res / ent * 100 : 0]] },
        { tit:'Previsão dos próximos 30 dias', nota:'A receber = mensalidades de alunos ativos que vencem (ou já venceram) até daqui a 30 dias. A pagar = contas lançadas no Financeiro.', cols:[{ t:'Item' }, { t:'Valor', f:'brl' }],
          linhas:[['Mensalidades a receber', r2(prevRec)], ['Contas a pagar', -r2(prevPag)], ['Saldo previsto', r2(prevRec - prevPag)]] },
        { tit:'Despesas pagas por categoria', cols:[{ t:'Categoria' }, { t:'Valor', f:'brl' }], linhas:Object.entries(porCat).sort((a, b) => b[1] - a[1]) }] };
  }
  /* ---------------- Painel dos relatórios (visual) — pedido do Lucas: mais moderno, fácil de ler ----------------
     Os números saem dos mesmos cálculos do relModelo (que continua servindo imprimir/PDF e planilha). */
  // contas do Financeiro do núcleo (o nome titulosFin aqui dentro é o gancho do módulo)
  const titulosFin_nucleo = () => (typeof window.titulosFin === 'function' ? window.titulosFin() : []);
  const COR = ['#257de0', '#f47230', '#00b894', '#f2a600', '#6a4ce2', '#ee7fac']; // cores fixas por ordem (forma, plano)
  function estiloDash(){
    if (document.getElementById('acDashCss')) return;
    const st = document.createElement('style'); st.id = 'acDashCss';
    st.textContent = `.acd-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(170px,100%),1fr));gap:10px;margin-bottom:12px}
.acd-kpi{background:#fff;border:1px solid #e3e8f0;border-radius:18px;padding:16px 18px;position:relative;overflow:hidden}
.acd-kpi::before{content:'';position:absolute;left:0;top:0;bottom:0;width:5px;background:var(--acc,#0A1630)}
.acd-kpi small{display:block;color:#5b6478;font-size:12.5px;font-weight:600;text-transform:uppercase;letter-spacing:.4px}
.acd-kpi b{display:block;font-family:'Space Grotesk',sans-serif;font-size:28px;line-height:1.15;margin:6px 0 2px;color:#0A1630}
.acd-kpi span{font-size:12.5px;color:#5b6478}.acd-kpi .up{color:#13804a;font-weight:700}.acd-kpi .down{color:#c2362f;font-weight:700}
.acd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(340px,100%),1fr));gap:12px}
.acd-card{background:#fff;border:1px solid #e3e8f0;border-radius:18px;padding:16px 18px;margin-bottom:12px}
.acd-card h3{margin:0 0 2px;font-size:15px}.acd-card .sub{font-size:12.5px;color:#5b6478;margin-bottom:12px}
.acd-vbars{display:flex;align-items:flex-end;gap:4px;height:170px;padding-top:18px;border-bottom:1px solid #d5dbe6}
.acd-vbars .c{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:0;position:relative;cursor:default}
.acd-vbars .c i{display:block;width:100%;max-width:34px;background:#0A1630;border-radius:4px 4px 0 0;min-height:2px}
.acd-vbars .c:hover i{background:#257de0}.acd-vbars .c.zero i{background:#d5dbe6}
.acd-vbars .c em{position:absolute;top:-2px;font-style:normal;font-size:11px;font-weight:700;color:#0A1630;opacity:0;transform:translateY(-100%)}.acd-vbars .c:hover em,.acd-vbars .c.top em{opacity:1}
.acd-xl{display:flex;gap:4px;margin-top:4px}.acd-xl span{flex:1;text-align:center;font-size:10.5px;color:#5b6478;min-width:0;overflow:hidden;white-space:nowrap}
.acd-h{margin:8px 0}.acd-h .l{display:flex;justify-content:space-between;font-size:13.5px;margin-bottom:4px;gap:8px}.acd-h .l b{font-variant-numeric:tabular-nums}
.acd-h .t{height:10px;background:#eef1f6;border-radius:99px;overflow:hidden}.acd-h .t i{display:block;height:100%;border-radius:99px}
.acd-stack{display:flex;height:22px;border-radius:99px;overflow:hidden;gap:2px;background:#fff;margin:6px 0 10px}.acd-stack i{display:block;height:100%}
.acd-leg{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:13px}.acd-leg span{display:inline-flex;align-items:center;gap:6px}.acd-leg i{width:10px;height:10px;border-radius:3px;display:inline-block}
.acd-hero{display:flex;align-items:center;gap:22px;flex-wrap:wrap}
.acd-ring{width:150px;height:150px;border-radius:50%;display:grid;place-items:center;flex:0 0 auto}
.acd-ring div{width:112px;height:112px;border-radius:50%;background:#fff;display:grid;place-items:center;text-align:center}
.acd-ring b{font-family:'Space Grotesk',sans-serif;font-size:28px;line-height:1}.acd-ring small{font-size:11.5px;color:#5b6478}
.acd-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #eef1f6}.acd-row:last-child{border-bottom:0}
.acd-row .n{flex:1;min-width:0}.acd-row .n b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.acd-row .n span{font-size:12px;color:#5b6478}
.acd-heat{display:grid;grid-template-columns:repeat(auto-fill,minmax(38px,1fr));gap:4px}.acd-heat div{border-radius:8px;padding:6px 2px;text-align:center;font-size:11px}.acd-heat div b{display:block;font-size:13px}
.acd-big{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px}.acd-big div{border-radius:14px;padding:12px 14px;background:#f5f7fb}.acd-big small{font-size:12px;color:#5b6478}.acd-big b{display:block;font-family:'Space Grotesk',sans-serif;font-size:22px}
details.acd-det summary{cursor:pointer;font-weight:600;color:#0A1630;padding:6px 0}`;
    document.head.appendChild(st);
  }
  const kpi = (rot, valor, sub = '', acc = '#0A1630', corValor = '') => `<div class="acd-kpi" style="--acc:${acc}"><small>${rot}</small><b${corValor ? ` style="color:${corValor}"` : ''}>${valor}</b><span>${sub}</span></div>`;
  const variacaoTxt = (atual, ant) => { if (!ant) return atual ? '<span class="up">novo</span> vs período anterior' : 'sem dados no período anterior'; const p = Math.round((atual - ant) / ant * 100); return `<span class="${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}%</span> vs período anterior`; };
  function barrasV(itens, fmt = v => brl(v)){ // [{rot, v, dica}]
    const max = Math.max(1, ...itens.map(x => x.v)), iMax = itens.findIndex(x => x.v === max && x.v > 0), passo = Math.ceil(itens.length / 12);
    return `<div class="acd-vbars">${itens.map((x, i) => `<div class="c ${x.v ? '' : 'zero'} ${i === iMax ? 'top' : ''}" title="${esc(x.dica || x.rot)}: ${esc(fmt(x.v))}"><em>${esc(fmt(x.v))}</em><i style="height:${Math.max(1.5, x.v / max * 100)}%"></i></div>`).join('')}</div>
      <div class="acd-xl">${itens.map((x, i) => `<span>${i % passo === 0 ? esc(x.rot) : ''}</span>`).join('')}</div>`;
  }
  const barrasH = (itens, fmt = v => brl(v)) => { const max = Math.max(1, ...itens.map(x => x.v)); return itens.map((x, i) => `<div class="acd-h"><div class="l"><span>${x.cor !== false ? `<i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${x.cor || COR[i % COR.length]};margin-right:6px"></i>` : ''}${esc(x.rot)}</span><b>${esc(fmt(x.v))}${x.extra ? ` <span class="small" style="font-weight:400">${esc(x.extra)}</span>` : ''}</b></div><div class="t"><i style="width:${Math.max(1, x.v / max * 100)}%;background:${x.cor || COR[i % COR.length]}"></i></div></div>`).join(''); };
  const vazio = txt => `<p class="small" style="padding:18px 0;text-align:center">${txt}</p>`;
  function periodoAnterior(ini, fim){ const n = dias(ini, fim) + 1; return [diaMais(ini, -n), diaMais(ini, -1)]; }
  function serieDias(ini, fim, lista, campoData, campoValor){
    const n = Math.min(dias(ini, fim) + 1, 62), base = n === dias(ini, fim) + 1 ? ini : diaMais(fim, -61), soma = {};
    lista.forEach(x => { const d = String(x[campoData] || '').slice(0, 10); soma[d] = r2((soma[d] || 0) + (campoValor ? num(x[campoValor]) : 1)); });
    return Array.from({ length:n }, (_, k) => { const d = diaMais(base, k); return { rot:d.slice(8, 10) + '/' + d.slice(5, 7), v:soma[d] || 0, dica:dataBR(d) }; });
  }

  function dashReceb(ini, fim){
    const M = mensais().filter(m => noPer(m.pago_em, ini, fim)), [pi, pf] = periodoAnterior(ini, fim), MA = mensais().filter(m => noPer(m.pago_em, pi, pf));
    const tot = r2(M.reduce((s, m) => s + num(m.valor), 0)), totA = r2(MA.reduce((s, m) => s + num(m.valor), 0));
    const porF = {}, porP = {}; M.forEach(m => { const f = PAG_NOME[m.forma] || 'Outros', p = m.plano_nome || 'Sem plano'; porF[f] = r2((porF[f] || 0) + num(m.valor)); porP[p] = r2((porP[p] || 0) + num(m.valor)); });
    const formas = Object.entries(porF).sort((a, b) => b[1] - a[1]), planos = Object.entries(porP).sort((a, b) => b[1] - a[1]);
    return `<div class="acd-kpis">${kpi('Recebido', brl(tot), variacaoTxt(tot, totA), '#13804a')}${kpi('Pagamentos', M.length, `${MA.length} no período anterior`)}${kpi('Ticket médio', brl(M.length ? r2(tot / M.length) : 0), 'por pagamento', '#257de0')}${kpi('Alunos que pagaram', new Set(M.map(m => m.aluno_id)).size, `de ${alunos().filter(a => !a.inativo).length} ativos`, '#f2a600')}</div>
    <div class="acd-card"><h3>Recebimentos por dia</h3><div class="sub">Passe o mouse (ou toque) nas barras para ver o valor de cada dia.</div>${M.length ? barrasV(serieDias(ini, fim, M, 'pago_em', 'valor')) : vazio('Nenhuma mensalidade recebida no período.')}</div>
    <div class="acd-grid"><div class="acd-card"><h3>Formas de pagamento</h3><div class="sub">Como os alunos pagaram</div>${formas.length ? `<div class="acd-stack">${formas.map(([, v], i) => `<i style="flex:${v};background:${COR[i % COR.length]}" title="${brl(v)}"></i>`).join('')}</div>${barrasH(formas.map(([k, v]) => ({ rot:k, v, extra:tot ? Math.round(v / tot * 100) + '%' : '' })))}` : vazio('—')}</div>
      <div class="acd-card"><h3>Por plano</h3><div class="sub">Quanto cada plano trouxe</div>${planos.length ? barrasH(planos.map(([k, v]) => ({ rot:k, v }))) : vazio('—')}</div></div>`;
  }
  function dashInad(){
    const hoje = hojeISO(), A = alunos().filter(a => !a.inativo), sit = a => situacao(a).k;
    const em = A.filter(a => sit(a) === 'emdia'), ve = A.filter(a => sit(a) === 'vencendo'), at = A.filter(a => sit(a) === 'atrasado');
    const n = A.length || 1, pEm = Math.round(em.length / n * 100), pVe = Math.round(ve.length / n * 100), pAt = 100 - pEm - pVe;
    const devido = a => { const p = planoAc(a.plano_id), d = situacao(a).dias || 0; return r2(valorCobrar(a, p) * Math.max(1, Math.ceil(d / (30 * (num((p || {}).meses) || 1))))); };
    const totAt = r2(at.reduce((s, a) => s + devido(a), 0));
    const faixas = [['1 a 15 dias', 1, 15], ['16 a 30 dias', 16, 30], ['31 a 60 dias', 31, 60], ['mais de 60', 61, 1e9]].map(([rot, a, b]) => { const L = at.filter(x => (situacao(x).dias || 0) >= a && (situacao(x).dias || 0) <= b); return { rot, v:L.length, extra:brl(r2(L.reduce((s, x) => s + devido(x), 0))), cor:'var(--bad)' }; });
    const em15 = diaMais(hoje, 15), prox = A.filter(a => a.valido_ate && a.valido_ate >= hoje && a.valido_ate <= em15).sort((a, b) => a.valido_ate.localeCompare(b.valido_ate));
    return `<div class="acd-kpis">${kpi('Alunos atrasados', at.length, `${pAt}% dos ativos`, 'var(--bad)')}${kpi('Valor em atraso', brl(totAt), 'estimado', 'var(--bad)')}${kpi('Vencem em 7 dias', ve.length, brl(r2(ve.reduce((s, a) => s + valorCobrar(a, planoAc(a.plano_id)), 0))), 'var(--warn)')}${kpi('Em dia', em.length, `${pEm}% dos ativos`, 'var(--ok)')}</div>
    <div class="acd-grid"><div class="acd-card"><h3>Saúde das mensalidades</h3><div class="sub">Situação dos ${A.length} alunos ativos hoje</div>
      <div class="acd-hero"><div class="acd-ring" style="background:${A.length ? `conic-gradient(#13804a 0% ${pEm}%, #d97706 ${pEm}% ${pEm + pVe}%, #c2362f ${pEm + pVe}% 100%)` : '#eef1f6'}"><div><span><b>${pEm}%</b><br><small>em dia</small></span></div></div>
        <div class="acd-leg" style="flex-direction:column;gap:8px"><span><i style="background:#13804a"></i>✓ Em dia: <b>${em.length}</b></span><span><i style="background:#d97706"></i>▲ Vencendo (7 dias): <b>${ve.length}</b></span><span><i style="background:#c2362f"></i>● Atrasados: <b>${at.length}</b></span></div></div></div>
      <div class="acd-card"><h3>Há quanto tempo estão atrasados</h3><div class="sub">Quanto mais antigo, mais difícil de receber</div>${at.length ? barrasH(faixas, v => v + ' aluno' + (v === 1 ? '' : 's')) : vazio('Ninguém atrasado. 🎉')}</div></div>
    <div class="acd-grid"><div class="acd-card"><h3>Cobrar agora</h3><div class="sub">Atrasados, do mais antigo para o mais recente</div>${at.length ? at.sort((a, b) => String(a.valido_ate).localeCompare(String(b.valido_ate))).slice(0, 15).map(a => `<div class="acd-row"><div class="n" style="cursor:pointer" data-act="acVerAluno" data-id="${esc(a.id)}"><b>${esc(a.nome)}</b><span>venceu ${a.valido_ate ? dataBR(a.valido_ate) : '—'} · ${situacao(a).dias || 0} dias · ${brl(devido(a))}</span></div>${linkZap(a, 'sm')}${pode('caixa') ? `<button class="btn sm pri" data-act="acReceber" data-id="${esc(a.id)}">Receber</button>` : ''}</div>`).join('') : vazio('Ninguém atrasado.')}</div>
      <div class="acd-card"><h3>Próximos vencimentos</h3><div class="sub">Nos próximos 15 dias — avise antes de vencer</div>${prox.length ? prox.slice(0, 15).map(a => `<div class="acd-row"><div class="n" style="cursor:pointer" data-act="acVerAluno" data-id="${esc(a.id)}"><b>${esc(a.nome)}</b><span>vence ${dataBR(a.valido_ate)} · ${brl(valorCobrar(a, planoAc(a.plano_id)))}</span></div>${linkZap(a, 'sm')}</div>`).join('') : vazio('Nenhum vencimento nos próximos 15 dias.')}</div></div>`;
  }
  function dashAlunos(ini, fim){
    const L = alunos(), A = L.filter(a => !a.inativo), hoje = hojeISO(), C = checkins().filter(c => noPer(c.em, ini, fim)), [pi, pf] = periodoAnterior(ini, fim), CA = checkins().filter(c => noPer(c.em, pi, pf));
    const novos = L.filter(a => noPer(a.inicio, ini, fim)), mrr = r2(A.filter(a => situacao(a).k !== 'atrasado').reduce((s, a) => s + mensalEquivA(a), 0));
    const ds = [0, 0, 0, 0, 0, 0, 0], hr = {}; C.forEach(c => { ds[new Date(c.em.slice(0, 10) + 'T12:00:00').getDay()]++; const h = +c.em.slice(11, 13); hr[h] = (hr[h] || 0) + 1; });
    const maxH = Math.max(1, ...Object.values(hr)), horas = Array.from({ length:18 }, (_, k) => k + 5);
    const P = planosAc().map((p, i) => ({ rot:p.nome, v:A.filter(a => a.plano_id === p.id).length, cor:COR[i % COR.length] }));
    const sumidos = A.filter(a => situacao(a).k !== 'atrasado' && (!a.ultimo_checkin || dias(a.ultimo_checkin.slice(0, 10), hoje) >= 15));
    const aniv = A.filter(a => (a.nascimento || '').slice(5, 7) === hoje.slice(5, 7)).sort((a, b) => a.nascimento.slice(8).localeCompare(b.nascimento.slice(8)));
    return `<div class="acd-kpis">${kpi('Alunos ativos', A.length, `${novos.length} novo(s) no período`, '#257de0')}${kpi('Receita mensal recorrente', brl(mrr), 'mensalidades de quem está em dia', '#13804a')}${kpi('Treinos no período', C.length, variacaoTxt(C.length, CA.length), '#f47230')}${kpi('Média por aluno', A.length ? String(Math.round(C.length / A.length * 10) / 10).replace('.', ',') : '0', 'treinos no período', '#6a4ce2')}</div>
    <div class="acd-grid"><div class="acd-card"><h3>Treinos por dia da semana</h3><div class="sub">Dias de maior movimento</div>${C.length ? barrasV(DSEM.map((d, i) => ({ rot:d.slice(0, 3), v:ds[i], dica:d })), v => v + ' treino' + (v === 1 ? '' : 's')) : vazio('Nenhum check-in no período.')}</div>
      <div class="acd-card"><h3>Horários de pico</h3><div class="sub">Quanto mais escuro, mais alunos naquele horário</div>${C.length ? `<div class="acd-heat">${horas.map(h => { const v = hr[h] || 0, a = v / maxH; return `<div title="${h}h: ${v} treino(s)" style="background:${v ? `rgba(10,22,48,${0.12 + a * 0.88})` : '#f1f3f7'};color:${a > .5 ? '#fff' : '#0A1630'}"><b>${v || ''}</b>${h}h</div>`; }).join('')}</div>` : vazio('Nenhum check-in no período.')}</div></div>
    <div class="acd-grid"><div class="acd-card"><h3>Alunos por plano</h3><div class="sub">Distribuição dos ativos</div>${P.length && A.length ? `<div class="acd-stack">${P.filter(x => x.v).map(x => `<i style="flex:${x.v};background:${x.cor}" title="${esc(x.rot)}: ${x.v}"></i>`).join('')}</div>${barrasH(P, v => v + ' aluno' + (v === 1 ? '' : 's'))}` : vazio('—')}</div>
      <div class="acd-card"><h3>Chamar de volta</h3><div class="sub">Em dia, mas sem treinar há 15 dias ou mais</div>${sumidos.length ? sumidos.slice(0, 12).map(a => { const t = fone(a.telefone); return `<div class="acd-row"><div class="n" style="cursor:pointer" data-act="acVerAluno" data-id="${esc(a.id)}"><b>${esc(a.nome)}</b><span>${a.ultimo_checkin ? 'último treino ' + dataBR(a.ultimo_checkin) + ' · ' + dias(a.ultimo_checkin.slice(0, 10), hoje) + ' dias' : 'ainda não treinou'}</span></div>${t ? `<a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/${t}?text=${encodeURIComponent(`Oi ${a.nome.split(' ')[0]}! Sentimos sua falta na ${(emp() || {}).fantasia || 'academia'}. Bora voltar a treinar? 💪`)}">Chamar</a>` : ''}</div>`; }).join('') : vazio('Todo mundo treinando. 💪')}</div></div>
    ${aniv.length ? `<div class="acd-card"><h3>🎂 Aniversariantes do mês</h3><div class="acd-leg" style="margin-top:8px">${aniv.map(a => `<span><b>${a.nascimento.slice(8, 10)}/${a.nascimento.slice(5, 7)}</b> ${esc(a.nome)}</span>`).join('')}</div></div>` : ''}`;
  }
  function dashFin(ini, fim){
    const M = mensais().filter(m => noPer(m.pago_em, ini, fim)), T = titulosFin_nucleo(), hoje = hojeISO();
    const recM = r2(M.reduce((s, m) => s + num(m.valor), 0)), outras = T.filter(t => t.tipo === 'receber' && t.auto !== 'academia' && t.pago_em && noPer(t.pago_em, ini, fim));
    const recO = r2(outras.reduce((s, t) => s + num(t.valor_pago ?? t.valor), 0)), pagas = T.filter(t => t.tipo === 'pagar' && t.pago_em && noPer(t.pago_em, ini, fim));
    const porCat = {}; pagas.forEach(t => { const c = t.categoria || 'Outras despesas'; porCat[c] = r2((porCat[c] || 0) + num(t.valor_pago ?? t.valor)); });
    const ent = r2(recM + recO), sai = r2(Object.values(porCat).reduce((s, v) => s + v, 0)), res = r2(ent - sai), max = Math.max(1, ent, sai);
    const em30 = diaMais(hoje, 30), prevRec = r2(alunos().filter(a => !a.inativo && a.valido_ate && a.valido_ate <= em30).reduce((s, a) => s + valorCobrar(a, planoAc(a.plano_id)), 0));
    const prevPag = r2(T.filter(t => t.tipo === 'pagar' && !t.pago_em && t.venc <= em30).reduce((s, t) => s + num(t.valor), 0));
    const meses = Array.from({ length:6 }, (_, k) => { const d = new Date(Date.UTC(+hoje.slice(0, 4), +hoje.slice(5, 7) - 6 + k, 1)).toISOString().slice(0, 7); return { rot:['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][+d.slice(5, 7) - 1], v:r2(mensais().filter(m => (m.pago_em || '').slice(0, 7) === d).reduce((s, m) => s + num(m.valor), 0)), dica:d.slice(5) + '/' + d.slice(0, 4) }; });
    return `<div class="acd-kpis">${kpi('Entrou', brl(ent), 'mensalidades + outras receitas', '#13804a')}${kpi('Saiu', brl(sai), 'despesas pagas', '#c2362f')}${kpi('Resultado', brl(res), ent ? `margem de ${Math.round(res / ent * 100)}%` : '', res < 0 ? 'var(--bad)' : 'var(--ok)', res < 0 ? 'var(--bad)' : 'var(--ok)')}${kpi('Saldo previsto 30 dias', brl(r2(prevRec - prevPag)), `${brl(prevRec)} a receber − ${brl(prevPag)} a pagar`, '#257de0')}</div>
    <div class="acd-grid"><div class="acd-card"><h3>Entrou × saiu no período</h3><div class="sub">O que sobrou para a academia</div>
      ${barrasH([{ rot:'Entrou', v:ent, cor:'var(--ok)' }, { rot:'Saiu', v:sai, cor:'var(--bad)' }])}
      <div class="acd-big"><div><small>Mensalidades</small><b>${brl(recM)}</b></div><div><small>Outras receitas</small><b>${brl(recO)}</b></div></div></div>
      <div class="acd-card"><h3>Mensalidades nos últimos 6 meses</h3><div class="sub">Evolução do que entrou por mês</div>${barrasV(meses)}</div></div>
    <div class="acd-card"><h3>Para onde foi o dinheiro</h3><div class="sub">Despesas pagas no período, por categoria (lançadas no Financeiro)</div>${sai ? barrasH(Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ rot:k, v, extra:Math.round(v / sai * 100) + '%' }))) : vazio('Nenhuma despesa paga no período. Lance as contas da academia na aba Financeiro.')}</div>`;
  }
  function vRelAcademia(){
    if (!pode('relatorio')) return '<h2>Relatórios</h2><div class="card empty">Seu acesso não inclui relatórios.</div>';
    if (!S.acRelIni){ S.acRelIni = true; if (!S.relPer || S.relPer === 'hoje') S.relPer = 'mes'; } // academia abre no mês
    estiloDash();
    const aba = S.acRelAba || 'receb', M = relModelo(), [ini, fim] = relPeriodo();
    const corpo = aba === 'inad' ? dashInad() : aba === 'alunos' ? dashAlunos(ini, fim) : aba === 'fin' ? dashFin(ini, fim) : dashReceb(ini, fim);
    return `<div class="seg rel-abas" style="margin-bottom:12px">${RAB_AC.map(([k, l]) => `<button data-act="acRelAba" data-a="${k}" class="${aba === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="row" style="align-items:center"><div style="flex:1;min-width:240px"><h2 style="margin-bottom:0">${esc(M.titulo)}</h2><div class="small">${esc(M.sub)}</div></div>
      <div class="actions" style="margin:0"><button class="btn" data-act="relImprimir">Imprimir / PDF</button><button class="btn" data-act="relPlanilha">Exportar planilha</button></div></div>
    ${aba === 'inad' ? '' : `<div class="seg" style="margin:8px 0 12px">${[['hoje','Hoje'],['7d','7 dias'],['mes','Este mês'],['mesant','Mês passado'],['periodo','Escolher datas']].map(([k, l]) => `<button data-act="relPer" data-p="${k}" class="${S.relPer === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${S.relPer === 'periodo' ? `<div class="row" style="margin-bottom:8px"><div><label for="relIni">De</label><input id="relIni" type="date" value="${ini}"></div><div><label for="relFim">Até</label><input id="relFim" type="date" value="${fim}"></div></div>` : ''}`}
    ${corpo}
    <details class="acd-det" ${S.acTabelas ? 'open' : ''}><summary>Ver tabelas com todos os números</summary>${relTelaHtml({ ...M, sub:'', kpis:[] }).replace('<div class="card"><div class="small"></div><div class="stats rel-kpis"></div></div>', '')}</details>`;
  }

  // entradas no Financeiro (contas recebidas) e no fechamento do caixa
  const titulosFin = () => mensais().map(m => ({ id:'ac_' + m.id, tipo:'receber', auto:'academia', ref:m.id, descricao:`Mensalidade · ${m.plano_nome || ''}`, pessoa:m.aluno_nome, categoria:'Mensalidades', valor:r2(num(m.valor)), venc:(m.pago_em || '').slice(0, 10), pago_em:(m.pago_em || '').slice(0, 10), valor_pago:r2(num(m.valor)), forma:m.forma }));
  const caixaExtras = cx => mensais().filter(m => m.caixa === cx.id).map(m => ({ rot:'Mensalidades', forma:m.forma, valor:m.valor }));

  // campos digitados (busca, filtros) — redesenha só a tela da academia
  document.addEventListener('input', ev => {
    const t = ev.target; if (!modServ() || modServ().id !== 'academia') return;
    if (t.id === 'acBusca'){ S.acBusca = t.value; render(); }
    else if (t.id === 'acCkBusca'){ S.acCk = t.value; render(); }
    else if (t.id === 'acRDe') atualizarAte();
  });
  document.addEventListener('toggle', ev => { if (ev.target.classList && ev.target.classList.contains('acd-det')) S.acTabelas = ev.target.open; }, true);
  document.addEventListener('change', ev => {
    const t = ev.target; if (!modServ() || modServ().id !== 'academia') return;
    if (t.id === 'acPlano'){ const p = planoAc(t.value); if (p && $('#acValor')) $('#acValor').value = brl(p.valor); }
    else if (t.id === 'acRPlano' || t.id === 'acRMeses'){ // valor = mensalidade (do aluno, ou do plano escolhido se trocou de plano) × meses
      const p = planoAc(val('acRPlano')), r = S.acRec || {}, a = alunos().find(x => x.id === (r.aluno || {}).id) || r.aluno || {};
      const mensal = p && p.id === a.plano_id && mensalDoAluno(a) ? mensalDoAluno(a) : num((p || {}).valor);
      if ($('#acRValor')) $('#acRValor').value = brl(r2(mensal * (+val('acRMeses') || 1))); atualizarAte(); }
    else if (t.id === 'acMesSel'){ S.acMes = t.value; render(); }
  });

  async function acoes(a, t, id){
    switch (a){
      case 'acNovoAluno': formAluno(); return true;
      case 'acEditAluno': formAluno({ ...alunos().find(x => x.id === id) }); return true;
      case 'acSalvarAluno': await salvarAluno(id); return true;
      case 'acVerAluno': verAluno(id); return true;
      case 'acDelAluno': if (confirm('Excluir este aluno? Os pagamentos e treinos dele continuam registrados.')){ if (await safe(() => del('ac_alunos', id), 'Aluno excluído.')) closeModal(); } return true;
      case 'acRelAba': S.acRelAba = t.dataset.a; S.relAba = 'ac_' + t.dataset.a; S.relTudo = false; render(); return true;
      case 'acFiltro': S.acFiltro = t.dataset.f; if (t.dataset.ir) S.tab = 'ac_alunos'; render(); return true;
      case 'acReceber': formReceber(id); return true;
      case 'acSalvarReceb': await salvarReceb(); return true;
      case 'acEstornar': await estornar(id); return true;
      case 'acCheck': await checkin(id); return true;
      case 'acDelCheck': await excluirCheckin(id); return true;
      case 'acNovoPlano': formPlano(); return true;
      case 'acEditPlano': formPlano({ ...planoAc(id) }); return true;
      case 'acSalvarPlano': await salvarPlano(id); return true;
      case 'acDelPlano':
        if (alunos().some(x => x.plano_id === id && !x.inativo)) { toast('Há alunos ativos neste plano: mude o plano deles antes de excluir.'); return true; }
        if (confirm('Excluir este plano?') && await safe(() => del('ac_planos', id), 'Plano excluído.')) closeModal(); return true;
    }
    return false;
  }

  return {
    id:'academia', nome:'Academia',
    cols:['ac_alunos', 'ac_planos', 'ac_mensalidades', 'ac_checkins'],
    // [chave, rótulo, funcionário vê?]
    abas:[['ac_checkin', 'Check-in', true], ['ac_alunos', 'Alunos', true], ['ac_mensal', 'Mensalidades', true]],
    // academia não vende produtos (pedido do Lucas): sem NF-e, Clientes, Vender/Cupom, Vendas/Notas, Compras e Produtos
    esconder:['nfe', 'clientes', 'venda', 'notas', 'compras', 'produtos'],
    views:{ ac_checkin:vCheckin, ac_alunos:vAlunos, ac_mensal:vMensal, relatorios:vRelAcademia }, // Relatórios: os de serviço, no lugar dos de venda
    icones:{
      ac_checkin:'<path d="M4 12l5 5L20 6"/>',
      ac_alunos:'<circle cx="9" cy="8" r="3.5"/><path d="M2 21c.8-3.6 3.5-5.5 7-5.5s6.2 1.9 7 5.5"/><path d="M16 4.5a3.5 3.5 0 010 7M19 15.8c1.6.9 2.6 2.6 3 5.2"/>',
      ac_mensal:'<path d="M6 4h12v16l-3-2-3 2-3-2-3 2z"/><path d="M9 9h6M9 13h4"/>'
    },
    // permissões: funcionário cadastra aluno, faz check-in e recebe; planos, exclusões e desfazer pagamento só gerente/dono
    perm:{ acNovoAluno:'cliente', acEditAluno:'cliente', acSalvarAluno:'cliente', acReceber:'caixa', acSalvarReceb:'caixa', acCheck:'caixa', acDelCheck:'caixa',
      acRelAba:'relatorio', acDelAluno:'empresa', acEstornar:'empresa', acNovoPlano:'empresa', acEditPlano:'empresa', acSalvarPlano:'empresa', acDelPlano:'empresa' },
    acoes, inicioHtml, empresaHtml, titulosFin, caixaExtras, relModelo,
    _teste:{ maisMeses, situacao } // usado pelos testes automáticos
  };
});
