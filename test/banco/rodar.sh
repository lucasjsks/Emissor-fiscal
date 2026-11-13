#!/usr/bin/env bash
# Testa supabase/schema.sql num Postgres local que imita o Supabase (precisa de psql e de um servidor Postgres).
# Uso: PGHOST=/tmp/pg PGPORT=5499 PGUSER=postgres bash test/banco/rodar.sh
set -e
cd "$(dirname "$0")/../.."
psql -q -c "drop database if exists emissor_teste" -c "create database emissor_teste"
psql -q -d emissor_teste -f test/banco/prelude.sql
psql -q -d emissor_teste -v ON_ERROR_STOP=1 -f supabase/schema.sql
psql -q -d emissor_teste -v ON_ERROR_STOP=1 -f supabase/schema.sql   # idempotente
psql -q -d emissor_teste -f test/banco/estoque.sql
