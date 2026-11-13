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
select public.convidar(:'e','op@x.com','operador');
reset role;
select pg_temp.como('22222222-2222-2222-2222-222222222222','op@x.com'); set role authenticated;
select public.lancar_compra(:'e', '{"numero":"12","itens":[{"produto_id":"P1","qtd_estoque":1,"custo_unit":1}]}'); -- operador: falha
update docs set data = data || '{"preco":1}' where path='empresas/'||:'e'||'/produtos/P1'; -- operador: 0 linhas
select count(*) movimentos_visiveis_operador from docs where col='empresas/'||:'e'||'/movimentos';
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
