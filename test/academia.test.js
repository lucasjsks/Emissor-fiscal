// Módulo Academia (modulos/servico/academia.js): datas de vencimento e situação do aluno
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = { window:{}, document:{ addEventListener(){} }, isoNow:() => '2026-11-25T10:00:00-03:00',
  num:v => Number(String(v ?? '').replace(',', '.')) || 0, r2:v => Math.round((Number(v) + Number.EPSILON) * 100) / 100 };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../modulos/servico/academia.js', import.meta.url), 'utf8'), ctx);
const mod = ctx.window.NOTAONE_MODULOS[0]();
const { maisMeses, situacao } = mod._teste;

test('academia: soma de meses respeita o fim do mês', () => {
  assert.equal(maisMeses('2026-01-31', 1), '2026-02-28');
  assert.equal(maisMeses('2028-01-31', 1), '2028-02-29');
  assert.equal(maisMeses('2026-11-25', 3), '2027-02-25');
  assert.equal(maisMeses('2026-12-10', 12), '2027-12-10');
});
test('academia: situação do aluno pelo "pago até"', () => {
  assert.equal(situacao({ valido_ate:'2026-11-10' }).k, 'atrasado');
  assert.equal(situacao({ valido_ate:'2026-11-10' }).dias, 15);
  assert.equal(situacao({ valido_ate:'2026-11-25' }).txt, 'vence hoje');
  assert.equal(situacao({ valido_ate:'2026-11-30' }).k, 'vencendo');
  assert.equal(situacao({ valido_ate:'2026-12-20' }).k, 'emdia');
  assert.equal(situacao({}).txt, 'sem pagamento');
  assert.equal(situacao({ inativo:true, valido_ate:'2026-01-01' }).k, 'inativo');
});
test('academia: registro do módulo', () => {
  assert.equal(mod.id, 'academia');
  assert.deepEqual([...mod.cols], ['ac_alunos', 'ac_planos', 'ac_mensalidades', 'ac_checkins']);
  assert.ok(mod.esconder.includes('nfe'));
  for (const [k] of mod.abas) assert.equal(typeof mod.views[k], 'function', 'cada aba tem sua tela: ' + k);
});

test('desconto do aluno: em R$ ou % sobre o valor do plano', () => {
  const { comDesconto } = mod._teste;
  assert.equal(comDesconto(100, null), 100);
  assert.equal(comDesconto(100, { tipo:'R$', valor:15 }), 85);
  assert.equal(comDesconto(129.9, { tipo:'%', valor:10 }), 116.91);
  assert.equal(comDesconto(100, { tipo:'R$', valor:150 }), 0, 'nunca fica negativo');
  assert.equal(comDesconto(100, { tipo:'%', valor:0 }), 100);
});
