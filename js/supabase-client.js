// =====================================================================
// CONFIGURAÇÃO DO SUPABASE
// Gregório | Meu Lar Imobiliária
// =====================================================================
// A chave abaixo é a "publishable key" (pública) — é segura para expor
// no navegador, pois o banco está protegido por RLS (Row Level Security).
// NUNCA coloque aqui a "secret key" / service_role key.
//
// Carregado como <script> clássico (não-module) para funcionar em
// qualquer navegador de celular, inclusive os que não suportam
// módulos ES. A biblioteca do Supabase é carregada antes deste
// arquivo via <script src=".../supabase-js@2/dist/umd/supabase.js">,
// que expõe window.supabase.createClient(...).
// =====================================================================

const SUPABASE_URL = 'https://yiyhspddvrypifxfzzdm.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_JQK9ls0HmQDrGGOW8ClvDA_ehiFAUJd';

// IMPORTANTE: a lib UMD carregada acima já cria uma variável global
// "supabase" (o namespace da biblioteca). Aqui reaproveitamos esse
// mesmo global (sem "const"/"let", só atribuição) para virar o
// cliente conectado — assim não há conflito de redeclaração entre
// os dois <script> tags, e o resto do código continua usando
// "supabase.from(...)", "supabase.auth...", etc.
supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Número de WhatsApp da imobiliária (formato internacional, só números)
// TODO: trocar pelo número real antes de publicar o site
const WHATSAPP_NUMBER = '554195476193';
const WHATSAPP_MESSAGE = 'Olá! Vim pelo site da Gregório | Meu Lar e gostaria de mais informações.';
