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
  const mensais = () => (S.ac_mensalidades || []).filter(m => !m.estornada);
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
      <div class="row">${sel('acPlano', 'Plano', a.plano_id || (P[0] || {}).id || '', P.length ? P.map(p => [p.id, `${p.nome} — ${brl(p.valor)}`]) : [['', 'Cadastre os planos em Mensalidades']])}${fld('acVenc', a.id ? 'Pago até' : 'Primeiro vencimento', a.valido_ate || hojeISO(), 'type="date"')}</div>
      ${fld('acObs', 'Observações (saúde, objetivo, restrições)', a.obs)}
      ${a.id ? `<label class="chk"><input type="checkbox" id="acInativo" ${a.inativo ? 'checked' : ''}> Aluno inativo (parou de treinar)</label>` : `<label class="chk"><input type="checkbox" id="acPagarJa" checked> Receber a primeira mensalidade agora</label>`}
      <div id="errM"></div>
      <div class="actions">${a.id && pode('empresa') ? `<button class="btn bad" data-act="acDelAluno" data-id="${esc(a.id)}">Excluir</button>` : ''}<button class="btn pri" data-act="acSalvarAluno" data-id="${esc(a.id || '')}">Salvar</button></div>`);
  }
  async function salvarAluno(id){
    const antigo = id ? alunos().find(x => x.id === id) : null;
    const a = { ...(antigo || {}), id:id || undefined, nome:val('acNome'), cpf:dig(val('acCpf')), telefone:val('acFone'), nascimento:val('acNasc'), plano_id:val('acPlano'), valido_ate:val('acVenc'), obs:val('acObs') };
    if ($('#acInativo')) a.inativo = $('#acInativo').checked;
    if (!antigo) a.inicio = hojeISO();
    const e = [];
    if (a.nome.length < 3) e.push('Informe o nome do aluno.');
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
    const C = (S.ac_checkins || []).filter(c => c.aluno_id === id).sort((x, y) => String(y.em).localeCompare(String(x.em)));
    const s = situacao(a), tel = fone(a.telefone), msg = encodeURIComponent(msgAviso(a));
    openModal(`${mhead(esc(a.nome))}
      <p>${tagSit(a)} ${p ? `· plano <b>${esc(p.nome)}</b> (${brl(p.valor)})` : ''} · pago até <b>${a.valido_ate ? dataBR(a.valido_ate) : '—'}</b></p>
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
    const P = planosAc(); if (!P.length) return toast('Cadastre os planos da academia primeiro (aba Mensalidades).');
    const p = planoAc(a.plano_id) || P[0], hoje = hojeISO();
    // renova a partir do "pago até" se ainda estiver em dia; atrasado renova a partir do vencimento (mantém o dia)
    const de = a.valido_ate || hoje;
    S.acRec = { aluno:a, de };
    openModal(`${mhead('Receber mensalidade')}
      <p><b>${esc(a.nome)}</b> · ${tagSit(a)}</p>
      <div class="row">${sel('acRPlano', 'Plano', p.id, P.map(x => [x.id, `${x.nome} — ${brl(x.valor)}`]))}${fld('acRValor', 'Valor recebido', brl(p.valor).replace('R$', 'R$'), 'data-rs inputmode="decimal"')}</div>
      <div class="row">${sel('acRForma', 'Forma de pagamento', '17', PAGAMENTOS.filter(([c]) => ['01','17','04','03','99'].includes(c)))}${fld('acRDe', 'Período começa em', de, 'type="date"')}</div>
      <div id="acRAte" class="msg info"></div><div id="errM"></div>
      ${caixaAberto() ? '' : '<p class="small">O caixa está fechado: o pagamento fica registrado, mas não entra na conferência do caixa.</p>'}
      <div class="actions"><button class="btn pri" data-act="acSalvarReceb">Confirmar recebimento</button></div>`);
    atualizarAte();
  }
  function atualizarAte(){
    const p = planoAc(val('acRPlano')), de = val('acRDe'), el = $('#acRAte'); if (!p || !de || !el) return;
    el.innerHTML = `Pago até <b>${dataBR(maisMeses(de, num(p.meses) || 1))}</b> (${num(p.meses) || 1} ${num(p.meses) > 1 ? 'meses' : 'mês'}).`;
  }
  async function salvarReceb(){
    const r = S.acRec || {}, a = alunos().find(x => x.id === r.aluno.id) || r.aluno, p = planoAc(val('acRPlano')), de = val('acRDe'), valor = numIn(val('acRValor'));
    if (!p) return $('#errM').innerHTML = '<div class="msg err">Escolha o plano.</div>';
    if (!(valor > 0)) return $('#errM').innerHTML = '<div class="msg err">Informe o valor recebido.</div>';
    if (!de) return $('#errM').innerHTML = '<div class="msg err">Informe a data de início do período.</div>';
    const ate = maisMeses(de, num(p.meses) || 1), cx = caixaAberto();
    const m = { id:uid(), aluno_id:a.id, aluno_nome:a.nome, plano_id:p.id, plano_nome:p.nome, de, ate, valor:r2(valor), forma:val('acRForma'), pago_em:isoNow(), recebido_por:S.meuId || null, caixa:cx ? cx.id : null, ate_anterior:a.valido_ate || null };
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
    const hj = (S.ac_checkins || []).filter(c => (c.em || '').slice(0, 10) === hoje).sort((a, b) => b.em.localeCompare(a.em));
    const u = S.acUltimo, ua = u && alunos().find(a => a.id === u.aluno_id);
    return `<h2>Check-in</h2>
    ${ua ? (() => { const s = situacao(ua); const ok = s.k !== 'atrasado'; return `<div class="card" style="border:2px solid ${ok ? 'var(--ok)' : 'var(--bad)'};background:${ok ? '#effaf3' : '#fff1f1'}">
      <div style="font-size:13px;color:#5b6478">${u.em.slice(11, 16)} · entrada registrada</div>
      <div style="font-family:'Space Grotesk',sans-serif;font-size:26px;font-weight:700">${ok ? '✓' : '!'} ${esc(ua.nome)}</div>
      <div style="font-size:16px">${ok ? `Liberado · pago até <b>${dataBR(ua.valido_ate)}</b>${s.k === 'vencendo' ? ' · <b>' + s.txt + '</b>' : ''}` : `<b>${s.dias ? `Mensalidade atrasada há ${s.dias} dia${s.dias === 1 ? '' : 's'}` : 'Sem mensalidade paga'}</b> — peça para passar na recepção`}</div>
      ${!ok && pode('caixa') ? `<div class="actions" style="justify-content:flex-start"><button class="btn pri" data-act="acReceber" data-id="${esc(ua.id)}">Receber agora</button></div>` : ''}</div>`; })() : ''}
    <div class="card"><label for="acCkBusca">Nome ou CPF do aluno</label>
      <input id="acCkBusca" placeholder="Digite e toque no aluno…" value="${esc(S.acCk || '')}" autocomplete="off" style="font-size:18px">
      <div class="results">${res.map(a => `<div class="res" data-act="acCheck" data-id="${esc(a.id)}"><span>${esc(a.nome)} <span class="small">${a.cpf ? fmtDoc(a.cpf) : ''}</span></span>${tagSit(a)}</div>`).join('') || (q ? '<div class="small" style="padding:8px">Nenhum aluno ativo encontrado.</div>' : '')}</div></div>
    <div class="card"><h3 style="margin-top:0">Hoje: ${hj.length} entrada${hj.length === 1 ? '' : 's'}</h3>
      ${hj.length ? hj.slice(0, 40).map(c => `<div class="total"><span>${c.em.slice(11, 16)} · ${esc(c.nome)}</span><span>${c.atrasado ? '<span class="tag b">atrasado</span>' : '<span class="tag g">ok</span>'}</span></div>`).join('') : '<p class="small">Ninguém treinou ainda hoje.</p>'}</div>`;
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
    const prev = pend.reduce((s, a) => s + num((planoAc(a.plano_id) || {}).valor), 0);
    const meses = [...new Set([hojeISO().slice(0, 7), ...mensais().map(m => (m.pago_em || '').slice(0, 7))])].sort().reverse();
    const P = planosAc();
    return `<h2>Mensalidades</h2>
    <div class="card"><div class="stats"><div><b>${brl(tot)}</b>recebido no mês</div><div><b>${M.length}</b>pagamentos</div><div><b>${pend.length}</b>a receber (${brl(prev)})</div></div></div>
    <div class="grid2"><div>
      <div class="card"><h3 style="margin-top:0">A receber — atrasados e vencendo em 7 dias</h3>${pend.length ? `<div class="fin-lista">${pend.map(a => `
        <div class="fin-l nt-l ${situacao(a).k === 'atrasado' ? 'vencido' : 'hoje'}" data-act="acVerAluno" data-id="${esc(a.id)}"><div class="fin-v">${a.valido_ate ? a.valido_ate.slice(8, 10) + '/' + a.valido_ate.slice(5, 7) : '—'}<small>venc.</small></div>
          <div class="fin-d"><b>${esc(a.nome)}</b><span>${esc((planoAc(a.plano_id) || {}).nome || 'sem plano')} · ${brl((planoAc(a.plano_id) || {}).valor)}</span></div>
          <div class="fin-r">${tagSit(a)}${linkZap(a, 'sm')}${pode('caixa') ? `<button class="btn sm pri" data-act="acReceber" data-id="${esc(a.id)}">Receber</button>` : ''}</div></div>`).join('')}</div>` : '<p class="small">Ninguém atrasado nem vencendo. 🎉</p>'}</div>
      <div class="card"><div class="row" style="align-items:center"><h3 style="margin:0;flex:1">Recebidas</h3><select id="acMesSel" style="flex:0 0 auto;width:auto">${meses.map(m => `<option value="${m}" ${m === mes ? 'selected' : ''}>${m.slice(5)}/${m.slice(0, 4)}</option>`).join('')}</select></div>
        ${M.length ? `<div class="fin-lista">${M.map(m => `<div class="fin-l pago"><div class="fin-v">${m.pago_em.slice(8, 10)}/${m.pago_em.slice(5, 7)}<small>${m.pago_em.slice(11, 16)}</small></div>
          <div class="fin-d" data-act="acVerAluno" data-id="${esc(m.aluno_id)}"><b>${esc(m.aluno_nome)}</b><span>${esc(m.plano_nome || '')} · ${esc(PAG_NOME[m.forma] || 'Outros')} · até ${dataBR(m.ate)}</span></div>
          <div class="fin-r"><b class="num">${brl(m.valor)}</b></div></div>`).join('')}</div>` : '<p class="small">Nenhum pagamento neste mês.</p>'}</div>
    </div><div>
      <div class="card"><div class="row" style="align-items:center"><h3 style="margin:0;flex:1">Planos da academia</h3>${pode('empresa') ? '<button class="btn" data-act="acNovoPlano" style="flex:0 0 auto">+ Plano</button>' : ''}</div>
        ${P.length ? P.map(p => `<div class="total"><span><b>${esc(p.nome)}</b> <span class="small">${num(p.meses) || 1} ${num(p.meses) > 1 ? 'meses' : 'mês'} · ${alunos().filter(a => a.plano_id === p.id && !a.inativo).length} aluno(s)</span></span><span class="num">${brl(p.valor)}${pode('empresa') ? ` <button class="btn sm" data-act="acEditPlano" data-id="${esc(p.id)}">editar</button>` : ''}</span></div>`).join('')
          : `<p class="small">Cadastre os planos que a academia vende (ex.: Mensal R$ 90, Trimestral R$ 250).</p>${pode('empresa') ? '<button class="btn pri" data-act="acPlanosPadrao">Criar Mensal, Trimestral, Semestral e Anual</button>' : ''}`}</div>
    </div></div>`;
  }
  function formPlano(p){
    p = p || { meses:1 };
    openModal(`${mhead(p.id ? 'Editar plano' : 'Novo plano')}
      <div class="row">${fld('acPNome', 'Nome do plano *', p.nome, 'placeholder="Ex.: Mensal, Musculação + Funcional"')}${sel('acPMeses', 'Duração', String(p.meses || 1), [['1','1 mês'],['2','2 meses'],['3','3 meses (trimestral)'],['6','6 meses (semestral)'],['12','12 meses (anual)']])}</div>
      ${fld('acPValor', 'Valor *', p.valor ? brl(p.valor) : '', 'data-rs inputmode="decimal"')}<div id="errM"></div>
      <div class="actions">${p.id ? `<button class="btn bad" data-act="acDelPlano" data-id="${esc(p.id)}">Excluir</button>` : ''}<button class="btn pri" data-act="acSalvarPlano" data-id="${esc(p.id || '')}">Salvar</button></div>`);
  }
  async function salvarPlano(id){
    const p = { id:id || undefined, nome:val('acPNome'), meses:+val('acPMeses') || 1, valor:r2(numIn(val('acPValor'))) };
    if (p.nome.length < 2 || !(p.valor > 0)) return $('#errM').innerHTML = '<div class="msg err">Informe o nome e o valor do plano.</div>';
    if (await safe(() => put('ac_planos', p), 'Plano salvo.')) closeModal();
  }

  /* ---------------- quadro no Início ---------------- */
  function inicioHtml(){
    const L = alunos(), at = L.filter(a => situacao(a).k === 'atrasado'), ve = L.filter(a => situacao(a).k === 'vencendo'), ativos = L.filter(a => !a.inativo).length;
    const hoje = hojeISO(), ck = (S.ac_checkins || []).filter(c => (c.em || '').slice(0, 10) === hoje).length;
    const mes = r2(mensais().filter(m => (m.pago_em || '').slice(0, 7) === hoje.slice(0, 7)).reduce((s, m) => s + num(m.valor), 0));
    return `<div class="card"><div class="row" style="align-items:center"><h3 style="margin:0;flex:1">Academia</h3><button class="btn pri" data-tab="ac_checkin" style="flex:0 0 auto">Check-in</button></div>
      <div class="stats"><div><b>${ativos}</b>alunos ativos</div><div><b>${ck}</b>treinos hoje</div><div><b>${brl(mes)}</b>mensalidades no mês</div></div>
      ${at.length ? `<div class="msg err" style="cursor:pointer" data-act="acFiltro" data-f="atrasados" data-ir="1"><b>${at.length}</b> aluno(s) com mensalidade atrasada — toque para ver</div>` : ''}
      ${ve.length ? `<div class="msg info" style="cursor:pointer" data-act="acFiltro" data-f="vencendo" data-ir="1"><b>${ve.length}</b> mensalidade(s) vencendo nos próximos 7 dias</div>` : ''}
      ${!planosAc().length && pode('empresa') ? '<div class="msg info">Primeiro passo: cadastre os planos da academia em <b>Mensalidades</b>.</div>' : ''}</div>`;
  }

  /* ---------------- Relatórios de serviço (no lugar dos relatórios de venda) ----------------
     Usam o modelo dos relatórios do núcleo: { titulo, sub, kpis, secoes } → tela, imprimir/PDF e planilha. */
  const RAB_AC = [['receb', 'Recebimentos'], ['inad', 'Inadimplência'], ['alunos', 'Alunos e frequência'], ['fin', 'Financeiro']];
  const noPer = (d, ini, fim) => { d = String(d || '').slice(0, 10); return d >= ini && d <= fim; };
  const mensalEquiv = p => p ? r2(num(p.valor) / (num(p.meses) || 1)) : 0;
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
      const devido = a => { const p = planoAc(a.plano_id); if (!p) return 0; const d = situacao(a).dias || 0; return r2(num(p.valor) * Math.max(1, Math.ceil(d / (30 * (num(p.meses) || 1))))); };
      const totAt = r2(at.reduce((s, a) => s + devido(a), 0)), em15 = diaMais(hoje, 15);
      const ven = ativos.filter(a => a.valido_ate && a.valido_ate >= hoje && a.valido_ate <= em15).sort((a, b) => a.valido_ate.localeCompare(b.valido_ate));
      return { titulo:'Inadimplência e vencimentos', sub,
        kpis:[[at.length, 'alunos atrasados', at.length ? 'var(--bad)' : ''], [brl(totAt), 'em atraso (estimado)'], [ativos.length ? String(Math.round(at.length / ativos.length * 1000) / 10).replace('.', ',') + '%' : '0%', 'dos alunos ativos'], [ven.length, 'vencem em 15 dias']],
        secoes:[
          { tit:'Atrasados', nota:'Valor estimado = valor do plano × períodos em atraso.', cols:[{ t:'Aluno' }, { t:'WhatsApp' }, { t:'Plano' }, { t:'Venceu em', f:'data' }, { t:'Dias', f:'qtd' }, { t:'Valor', f:'brl' }],
            linhas:at.sort((a, b) => String(a.valido_ate).localeCompare(String(b.valido_ate))).map(a => [a.nome, a.telefone || '', (planoAc(a.plano_id) || {}).nome || '', a.valido_ate || '', situacao(a).dias || 0, devido(a)]) },
          { tit:'Vencem nos próximos 15 dias', cols:[{ t:'Aluno' }, { t:'WhatsApp' }, { t:'Plano' }, { t:'Vence em', f:'data' }, { t:'Valor', f:'brl' }],
            linhas:ven.map(a => [a.nome, a.telefone || '', (planoAc(a.plano_id) || {}).nome || '', a.valido_ate, num((planoAc(a.plano_id) || {}).valor)]) }] };
    }
    if (aba === 'alunos'){
      const ativos = L.filter(a => !a.inativo), novos = L.filter(a => noPer(a.inicio, ini, fim)), C = (S.ac_checkins || []).filter(c => noPer(c.em, ini, fim));
      const freq = {}, dsem = [0, 0, 0, 0, 0, 0, 0], hora = {};
      C.forEach(c => { freq[c.aluno_id] = (freq[c.aluno_id] || 0) + 1; dsem[new Date(c.em.slice(0, 10) + 'T12:00:00').getDay()]++; const h = c.em.slice(11, 13); hora[h] = (hora[h] || 0) + 1; });
      const sumidos = ativos.filter(a => situacao(a).k !== 'atrasado' && (!a.ultimo_checkin || dias(a.ultimo_checkin.slice(0, 10), hoje) >= 15)).sort((a, b) => String(a.ultimo_checkin || '').localeCompare(String(b.ultimo_checkin || '')));
      const mesAtual = hoje.slice(5, 7), aniv = ativos.filter(a => (a.nascimento || '').slice(5, 7) === mesAtual).sort((a, b) => a.nascimento.slice(8).localeCompare(b.nascimento.slice(8)));
      const mrr = r2(ativos.filter(a => situacao(a).k !== 'atrasado').reduce((s, a) => s + mensalEquiv(planoAc(a.plano_id)), 0));
      return { titulo:'Alunos e frequência', sub,
        kpis:[[ativos.length, 'alunos ativos'], [novos.length, 'novos no período'], [L.filter(a => a.inativo).length, 'inativos'], [C.length, 'treinos no período'], [brl(mrr), 'receita mensal recorrente']],
        secoes:[
          { tit:'Alunos por plano', nota:'Receita mensal = valor do plano dividido pelos meses (ex.: trimestral ÷ 3), só de quem está em dia.', cols:[{ t:'Plano' }, { t:'Ativos', f:'qtd' }, { t:'Receita mensal', f:'brl' }],
            linhas:P.map(p => { const at = ativos.filter(a => a.plano_id === p.id); return [p.nome, at.length, r2(at.filter(a => situacao(a).k !== 'atrasado').length * mensalEquiv(p))]; }) },
          { tit:'Novos alunos no período', cols:[{ t:'Aluno' }, { t:'Início', f:'data' }, { t:'Plano' }], linhas:novos.sort((a, b) => String(a.inicio).localeCompare(String(b.inicio))).map(a => [a.nome, a.inicio, (planoAc(a.plano_id) || {}).nome || '']) },
          { tit:'Sem treinar há 15 dias ou mais (em dia com a mensalidade)', nota:'Bom para chamar de volta antes de o aluno desistir.', cols:[{ t:'Aluno' }, { t:'WhatsApp' }, { t:'Último treino', f:'data' }, { t:'Dias', f:'qtd' }],
            linhas:sumidos.map(a => [a.nome, a.telefone || '', a.ultimo_checkin ? a.ultimo_checkin.slice(0, 10) : 'nunca', a.ultimo_checkin ? dias(a.ultimo_checkin.slice(0, 10), hoje) : '']) },
          { tit:'Mais frequentes no período', cols:[{ t:'Aluno' }, { t:'Treinos', f:'qtd' }], linhas:Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([id, q]) => [(L.find(a => a.id === id) || {}).nome || '—', q]) },
          { tit:'Treinos por dia da semana', cols:[{ t:'Dia' }, { t:'Treinos', f:'qtd' }], linhas:dsem.map((q, i) => [DSEM[i], q]) },
          { tit:'Horários de maior movimento', cols:[{ t:'Hora' }, { t:'Treinos', f:'qtd' }], linhas:Object.entries(hora).sort().map(([h, q]) => [h + 'h', q]) },
          { tit:'Aniversariantes do mês', cols:[{ t:'Aluno' }, { t:'Dia' }, { t:'WhatsApp' }], linhas:aniv.map(a => [a.nome, a.nascimento.slice(8, 10) + '/' + mesAtual, a.telefone || '']) }] };
    }
    // financeiro da academia: o que entrou e saiu no período e a previsão dos próximos 30 dias
    const T = titulosFin(), outrasRec = T.filter(t => t.tipo === 'receber' && t.auto !== 'academia' && t.pago_em && noPer(t.pago_em, ini, fim));
    const pagas = T.filter(t => t.tipo === 'pagar' && t.pago_em && noPer(t.pago_em, ini, fim));
    const recM = r2(M.reduce((s, m) => s + num(m.valor), 0)), recO = r2(outrasRec.reduce((s, t) => s + num(t.valor_pago ?? t.valor), 0));
    const porCat = {}; pagas.forEach(t => { const c = t.categoria || 'Outras despesas'; porCat[c] = r2((porCat[c] || 0) + num(t.valor_pago ?? t.valor)); });
    const desp = r2(Object.values(porCat).reduce((s, v) => s + v, 0)), ent = r2(recM + recO), res = r2(ent - desp);
    const em30 = diaMais(hoje, 30), prevRec = L.filter(a => !a.inativo && a.valido_ate && a.valido_ate <= em30).reduce((s, a) => s + num((planoAc(a.plano_id) || {}).valor), 0);
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
  function vRelAcademia(){
    if (!pode('relatorio')) return '<h2>Relatórios</h2><div class="card empty">Seu acesso não inclui relatórios.</div>';
    if (!S.acRelIni){ S.acRelIni = true; if (!S.relPer || S.relPer === 'hoje') S.relPer = 'mes'; } // academia abre no mês
    const aba = S.acRelAba || 'receb', M = relModelo(), [ini, fim] = relPeriodo();
    return `<div class="seg rel-abas" style="margin-bottom:12px">${RAB_AC.map(([k, l]) => `<button data-act="acRelAba" data-a="${k}" class="${aba === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="row" style="align-items:center"><h2 style="flex:1;min-width:240px">${esc(M.titulo)}</h2>
      <div class="actions" style="margin:0"><button class="btn" data-act="relImprimir">Imprimir / PDF</button><button class="btn" data-act="relPlanilha">Exportar planilha</button></div></div>
    ${aba === 'inad' ? '' : `<div class="seg" style="margin-bottom:8px">${[['hoje','Hoje'],['7d','7 dias'],['mes','Este mês'],['mesant','Mês passado'],['periodo','Escolher datas']].map(([k, l]) => `<button data-act="relPer" data-p="${k}" class="${S.relPer === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${S.relPer === 'periodo' ? `<div class="row" style="margin-bottom:8px"><div><label for="relIni">De</label><input id="relIni" type="date" value="${ini}"></div><div><label for="relFim">Até</label><input id="relFim" type="date" value="${fim}"></div></div>` : ''}`}
    ${relTelaHtml(M)}`;
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
  document.addEventListener('change', ev => {
    const t = ev.target; if (!modServ() || modServ().id !== 'academia') return;
    if (t.id === 'acRPlano'){ const p = planoAc(t.value); if (p && $('#acRValor')) $('#acRValor').value = brl(p.valor); atualizarAte(); }
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
      case 'acNovoPlano': formPlano(); return true;
      case 'acEditPlano': formPlano({ ...planoAc(id) }); return true;
      case 'acSalvarPlano': await salvarPlano(id); return true;
      case 'acDelPlano':
        if (alunos().some(x => x.plano_id === id && !x.inativo)) { toast('Há alunos ativos neste plano: mude o plano deles antes de excluir.'); return true; }
        if (confirm('Excluir este plano?') && await safe(() => del('ac_planos', id), 'Plano excluído.')) closeModal(); return true;
      case 'acPlanosPadrao':
        await safe(async () => { for (const [nome, meses, valor] of [['Mensal', 1, 90], ['Trimestral', 3, 250], ['Semestral', 6, 470], ['Anual', 12, 880]]) await put('ac_planos', { nome, meses, valor }); }, 'Planos criados: confira os valores e ajuste em "editar".');
        return true;
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
    perm:{ acNovoAluno:'cliente', acEditAluno:'cliente', acSalvarAluno:'cliente', acReceber:'caixa', acSalvarReceb:'caixa', acCheck:'caixa',
      acRelAba:'relatorio', acDelAluno:'empresa', acEstornar:'empresa', acNovoPlano:'empresa', acEditPlano:'empresa', acSalvarPlano:'empresa', acDelPlano:'empresa', acPlanosPadrao:'empresa' },
    acoes, inicioHtml, titulosFin, caixaExtras, relModelo,
    _teste:{ maisMeses, situacao } // usado pelos testes automáticos
  };
});
