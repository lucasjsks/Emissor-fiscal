\set ON_ERROR_STOP 0
create or replace function pg_temp.como(uid text, em text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', uid, false); perform set_config('request.jwt.claim.email', em, false); end $$;
select pg_temp.como('11111111-1111-1111-1111-111111111111','dono@x.com');
set role authenticated;
select public.criar_empresa('{"razao":"LOJA","cnpj":"11222333000181"}') as e \gset
\echo empresa :e
select public.criar_empresa('{"razao":"OUTRA"}');  -- deve falhar
insert into docs(path,col,empresa_id,data) values ('empresas/'||:'e'||'/produtos/P1','empresas/'||:'e'||'/produtos',:'e','{"descricao":"REFRI LATA","estoque":999,"preco":5}');
select data->>'estoque' as estoque_inserido_tem_que_ser_nulo from docs where path='empresas/'||:'e'||'/produtos/P1';
select public.lancar_compra(:'e', '{"chave":"2226","numero":"10","fornecedor_cnpj":"11444777000161","itens":[{"produto_id":"P1","xProd":"REFRI CX12","cProd":"A1","uCom":"CX","fator":12,"qtd_estoque":24,"custo_unit":2.5,"vinc_chave":"11444777000161_A1"}]}') as c1 \gset
select public.lancar_compra(:'e', '{"chave":"2226","numero":"10","itens":[{"produto_id":"P1","qtd_estoque":1,"custo_unit":1}]}');  -- duplicada: falha
select public.lancar_compra(:'e', '{"numero":"11","itens":[{"produto_id":"P1","qtd_estoque":12,"custo_unit":3.1}]}');
select data->>'estoque' estoque, data->>'custo' custo, data->>'custo_medio' cm from docs where path='empresas/'||:'e'||'/produtos/P1';
update docs set data = data || '{"estoque":5000,"preco":6}' where path='empresas/'||:'e'||'/produtos/P1';
select data->>'estoque' estoque_preservado, data->>'preco' preco_novo from docs where path='empresas/'||:'e'||'/produtos/P1';
select count(*) vinculos from docs where col='empresas/'||:'e'||'/vinculos';
insert into docs(path,col,empresa_id,data) values ('empresas/'||:'e'||'/movimentos/fake','empresas/'||:'e'||'/movimentos',:'e','{}'); -- deve falhar (RLS)
insert into docs(path,col,empresa_id,data) values ('empresas/'||:'e'||'/compras_xml/'||:'c1','empresas/'||:'e'||'/compras_xml',:'e','{"xml":"<nfe/>"}');
select count(*) xml_guardado_pelo_dono from docs where col='empresas/'||:'e'||'/compras_xml';
select public.convidar(:'e','op@x.com','operador'); -- deve falhar: convites desativados
reset role;
insert into membros(empresa_id,user_id,papel) values (:'e','22222222-2222-2222-2222-222222222222','operador'); -- operador antigo (simulado)
reset role;
select pg_temp.como('22222222-2222-2222-2222-222222222222','op@x.com'); set role authenticated;
select public.lancar_compra(:'e', '{"numero":"12","itens":[{"produto_id":"P1","qtd_estoque":1,"custo_unit":1}]}'); -- operador: falha
update docs set data = data || '{"preco":1}' where path='empresas/'||:'e'||'/produtos/P1' returning data->>'preco' as operador_muda_preco_1; -- funcionário edita produto
select count(*) movimentos_visiveis_operador from docs where col='empresas/'||:'e'||'/movimentos';
insert into docs(path,col,empresa_id,data) values ('empresas/'||:'e'||'/compras_xml/x2','empresas/'||:'e'||'/compras_xml',:'e','{}'); -- operador: falha (RLS)
reset role; set role service_role;
insert into docs(path,col,empresa_id,data) values ('empresas/'||:'e'||'/notas/N1','empresas/'||:'e'||'/notas',:'e','{"modelo":"65","numero":7,"itens":[{"pid":"P1","q":2},{"d":"sem pid","q":1}]}');
select public.aplicar_estoque_nota(:'e','N1',false); select public.aplicar_estoque_nota(:'e','N1',false);
select data->>'estoque' apos_venda_34 from docs where path='empresas/'||:'e'||'/produtos/P1';
select public.aplicar_estoque_nota(:'e','N1',true);
select data->>'estoque' apos_cancel_36 from docs where path='empresas/'||:'e'||'/produtos/P1';
reset role;
select pg_temp.como('11111111-1111-1111-1111-111111111111','dono@x.com'); set role authenticated;
select public.ajustar_estoque(:'e','P1',30,'inventário') as ajustado;
select public.estornar_compra(:'e', :'c1', 'erro de lançamento');
select public.estornar_compra(:'e', :'c1', 'de novo'); -- falha
select data->>'estoque' final_6 from docs where path='empresas/'||:'e'||'/produtos/P1';
select data->>'tipo' tipo, data->>'qtd' qtd, data->>'saldo' saldo from docs where col='empresas/'||:'e'||'/movimentos' order by atualizado_em, data->>'em';
delete from docs where path='empresas/'||:'e'; -- tem nota: nao apaga
select count(*) empresa_continua from docs where path='empresas/'||:'e';
-- CNPJ repetido em outra conta: recusa ao criar e ao trocar o CNPJ
reset role; select pg_temp.como('22222222-2222-2222-2222-222222222222','outro@x.com'); set role authenticated;
select public.criar_empresa('{"razao":"COPIA","cnpj":"11.222.333/0001-81"}');  -- deve falhar: CNPJ já existe
select public.criar_empresa('{"razao":"OUTRA LOJA","cnpj":"11444777000161"}') as e2 \gset
update docs set data = data || '{"cnpj":"11222333000181"}' where path='empresas/'||:'e2';  -- deve falhar
update docs set data = data || '{"razao":"OUTRA LOJA LTDA"}' where path='empresas/'||:'e2' returning data->>'razao' as salvou_sem_trocar_cnpj;
-- financeiro: dono grava e apaga contas
reset role; select pg_temp.como('11111111-1111-1111-1111-111111111111','dono@x.com'); set role authenticated;
insert into docs(path,col,empresa_id,data) values ('empresas/'||:'e'||'/financeiro/f1','empresas/'||:'e'||'/financeiro',:'e','{"tipo":"pagar","valor":100}') returning data->>'valor' as fin_gravou;
delete from docs where path='empresas/'||:'e'||'/financeiro/f1' returning 'fin_apagou';
-- caixas: limite do plano (2), a tela não muda o limite; o suporte libera mais
reset role; select pg_temp.como('11111111-1111-1111-1111-111111111111','dono@x.com'); set role authenticated;
update docs set data = data || '{"pdvs":[{"id":"a","nome":"Caixa 01"},{"id":"b","nome":"Caixa 02"}]}' where path='empresas/'||:'e' returning jsonb_array_length(data->'pdvs') as dois_caixas_ok;
update docs set data = data || '{"pdvs":[{"id":"a"},{"id":"b"},{"id":"c"}]}' where path='empresas/'||:'e'; -- deve falhar: limite 2
update docs set data = data || '{"limite_caixas":10}' where path='empresas/'||:'e' returning data->>'limite_caixas' as limite_ignorado_nulo;
select public.definir_limite_caixas('11222333000181', 3); -- dono comum: falha
reset role;
select public.definir_limite_caixas('11.222.333/0001-81', 3);
select pg_temp.como('11111111-1111-1111-1111-111111111111','dono@x.com'); set role authenticated;
update docs set data = data || '{"pdvs":[{"id":"a"},{"id":"b"},{"id":"c"}]}' where path='empresas/'||:'e' returning jsonb_array_length(data->'pdvs') as tres_caixas_ok, data->>'limite_caixas' as limite_3;
reset role;
-- mensalidade: só o servidor grava empresa.assinatura; a tela não consegue marcar como paga
reset role;
select public.gravar_campo_empresa(:'e', '{assinatura}', '{"id":"sub_1","situacao":"atrasada"}');
select pg_temp.como('11111111-1111-1111-1111-111111111111','dono@x.com'); set role authenticated;
update docs set data = data || '{"assinatura":{"id":"sub_1","situacao":"em_dia"}}' where path='empresas/'||:'e' returning data->'assinatura'->>'situacao' as assinatura_continua_atrasada;
update docs set data = data - 'assinatura' where path='empresas/'||:'e' returning data->'assinatura'->>'id' as assinatura_nao_some_sub_1;
reset role;
-- plano: só o servidor grava (api/plano.js)
select public.gravar_campo_empresa(:'e', '{plano}', '{"id":"1caixa","valor":89.99}');
select pg_temp.como('11111111-1111-1111-1111-111111111111','dono@x.com'); set role authenticated;
update docs set data = data || '{"plano":{"id":"2caixas","valor":1}}' where path='empresas/'||:'e' returning data->'plano'->>'id' as plano_continua_1caixa;
reset role;
-- ramo de atividade: a tela não muda (empresa sem ramo fica comércio); o suporte muda com definir_ramo
select pg_temp.como('11111111-1111-1111-1111-111111111111','dono@x.com'); set role authenticated;
update docs set data = data || '{"modulo":"servico","servico":"academia"}' where path='empresas/'||:'e' returning data->>'modulo' as ramo_continua_comercio, data->>'servico' as servico_vazio;
reset role;
select public.definir_ramo((select public.doc_empresa(data) from docs where path='empresas/'||:'e'), 'academia') as suporte_muda_ramo;
select data->>'modulo' as modulo_servico, data->>'servico' as servico_academia from docs where path='empresas/'||:'e';
select pg_temp.como('11111111-1111-1111-1111-111111111111','dono@x.com'); set role authenticated;
update docs set data = (data || '{"modulo":"comercio"}'::jsonb) - 'servico' where path='empresas/'||:'e' returning data->>'servico' as continua_academia;
reset role;
select public.definir_ramo((select public.doc_empresa(data) from docs where path='empresas/'||:'e'), 'comercio') as volta_comercio;
-- sem mensalidade: só o suporte marca; a tela não consegue se marcar para escapar da cobrança
select pg_temp.como('11111111-1111-1111-1111-111111111111','dono@x.com'); set role authenticated;
update docs set data = data || '{"sem_mensalidade":true}' where path='empresas/'||:'e' returning data->>'sem_mensalidade' as tela_nao_marca_vazio;
reset role;
select public.definir_sem_mensalidade((select public.doc_empresa(data) from docs where path='empresas/'||:'e'), true) as suporte_marca;
select data->>'sem_mensalidade' as sem_mensalidade_true from docs where path='empresas/'||:'e';
select public.definir_sem_mensalidade((select public.doc_empresa(data) from docs where path='empresas/'||:'e'), false) as suporte_desmarca;

-- funcionário (operador): edita e cadastra produto, mas não mexe no custo nem apaga
reset role; select pg_temp.como('22222222-2222-2222-2222-222222222222','op@x.com'); set role authenticated;
update docs set data = data || '{"preco":7,"custo":0.01,"custo_medio":0.01}' where path='empresas/'||:'e'||'/produtos/P1' returning data->>'preco' as preco_7, data->>'custo_medio' as custo_medio_nao_mudou;
insert into docs(path,col,empresa_id,data) values ('empresas/'||:'e'||'/produtos/P9','empresas/'||:'e'||'/produtos',:'e','{"descricao":"CAPINHA","preco":20,"custo":3}') returning data->>'custo' as custo_novo_nulo;
delete from docs where path='empresas/'||:'e'||'/produtos/P9' returning 'operador_apagou_NAO_DEVIA';
reset role;
-- empresa cadastrada com CPF: CPF único e numeração própria das vendas sem nota
insert into auth.users values ('33333333-3333-3333-3333-333333333333','cpf@x.com'),('44444444-4444-4444-4444-444444444444','cpf2@x.com') on conflict do nothing;
select pg_temp.como('33333333-3333-3333-3333-333333333333','cpf@x.com'); set role authenticated;
select public.criar_empresa('{"razao":"ZE","doc_tipo":"cpf","cpf":"529.982.247-25"}') as ecpf \gset
reset role; select pg_temp.como('44444444-4444-4444-4444-444444444444','cpf2@x.com'); set role authenticated;
select public.criar_empresa('{"razao":"OUTRO ZE","doc_tipo":"cpf","cpf":"52998224725"}'); -- deve falhar: CPF já cadastrado
reset role; set role service_role;
select public.proximo_numero(:'ecpf', 'prox_venda') as venda_1, public.proximo_numero(:'ecpf', 'prox_venda') as venda_2;
reset role;
-- limite de funcionários: a tela não muda; o suporte libera
select pg_temp.como('11111111-1111-1111-1111-111111111111','dono@x.com'); set role authenticated;
update docs set data = data || '{"limite_funcionarios":10}' where path='empresas/'||:'e' returning data->>'limite_funcionarios' as limite_func_ignorado_nulo;
reset role;
select public.definir_limite_funcionarios('11.222.333/0001-81', 3);
select data->>'limite_funcionarios' as limite_func_3 from docs where path='empresas/'||:'e';
-- senha do gerente: a coleção segredos só o servidor lê/grava; a tela não marca senha_gerente nem muda a lista de funcionários
reset role; set role service_role;
insert into docs(path,col,empresa_id,data) values ('empresas/'||:'e'||'/segredos/gerente','empresas/'||:'e'||'/segredos',:'e','{"hash":"x"}');
reset role; select pg_temp.como('11111111-1111-1111-1111-111111111111','dono@x.com'); set role authenticated;
select count(*) as segredo_visivel_0 from docs where col='empresas/'||:'e'||'/segredos';
insert into docs(path,col,empresa_id,data) values ('empresas/'||:'e'||'/segredos/g2','empresas/'||:'e'||'/segredos',:'e','{}'); -- deve falhar (RLS)
update docs set data = data || '{"senha_gerente":true,"funcionarios":[{"email":"x"}]}' where path='empresas/'||:'e' returning data->>'senha_gerente' as senha_ger_nulo, data->>'funcionarios' as func_nulo;
reset role;
-- preço de compra informado no cadastro: só gerente/dono; vira custo e custo médio
reset role; select pg_temp.como('22222222-2222-2222-2222-222222222222','op@x.com'); set role authenticated;
select public.definir_custo(:'e', 'P1', 1.5); -- funcionário: deve falhar
reset role; select pg_temp.como('11111111-1111-1111-1111-111111111111','dono@x.com'); set role authenticated;
select public.definir_custo(:'e', 'P1', 4.25);
select data->>'custo' as custo_425, data->>'custo_medio' as cm_425 from docs where path='empresas/'||:'e'||'/produtos/P1';
reset role;

-- módulo Academia: funcionário grava aluno; plano da academia só gerente/dono
select pg_temp.como('11111111-1111-1111-1111-111111111111','dono@x.com');
select public.pode_gravar('empresas/'||:'e'||'/ac_planos', :'e') as dono_grava_plano_academia_t;
reset role;

