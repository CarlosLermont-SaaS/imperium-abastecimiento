-- =====================================================================================
-- IMPERIUM · Archivo 03 · Red (pg_net), tareas programadas (pg_cron) y secretos en Vault
-- Los secretos internos se GENERAN dentro de la base de datos: nunca salen a la vista.
-- Cambie solo la URL de su proyecto y la URL pública de la app si son distintas.
-- =====================================================================================
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'secreto_webhook_interno') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'secreto_webhook_interno', 'IMPERIUM: llamadas internas base de datos → funciones');
  end if;
  if not exists (select 1 from vault.secrets where name = 'secreto_firma_aprobacion') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'secreto_firma_aprobacion', 'IMPERIUM: firma HMAC de enlaces de aprobación');
  end if;
  if not exists (select 1 from vault.secrets where name = 'secreto_ventas') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'secreto_ventas', 'IMPERIUM: clave en la URL de los webhooks de venta');
  end if;
  if not exists (select 1 from vault.secrets where name = 'url_funcion_notificar') then
    perform vault.create_secret('https://iyalcialszfmjdyueqnp.supabase.co/functions/v1/notificar-abastecimiento', 'url_funcion_notificar', 'IMPERIUM');
  end if;
  if not exists (select 1 from vault.secrets where name = 'url_app') then
    perform vault.create_secret('https://carloslermont-saas.github.io/imperium-abastecimiento/', 'url_app', 'IMPERIUM: URL pública de la app');
  end if;
end $$;

select cron.schedule('imperium_ejecutar_vencidos', '*/15 * * * *', $$ select privado.ejecutar_abastecimientos_vencidos(); $$);
select cron.schedule('imperium_reintentar_notificaciones', '*/10 * * * *', $$ select privado.reintentar_notificaciones(); $$);
select cron.schedule('imperium_vencer_suscripciones', '17 5 * * *', $$ select privado.vencer_suscripciones(); $$);
