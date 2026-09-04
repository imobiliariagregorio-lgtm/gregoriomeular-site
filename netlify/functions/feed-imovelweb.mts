import type { Context, Config } from "@netlify/functions";

// =====================================================================
// FEED XML — IMOVELWEB (layout oficial OpenNavent, somente classificados)
// Gera, na hora, o XML dos imóveis ativos ("disponível", publicados no
// site) que estiverem marcados para o portal Imovelweb no CRM.
// URL fixa: https://imoveisgregorio.com.br/feed/imovelweb.xml
// O Imovelweb acessa essa URL periodicamente sozinho — não precisa
// subir arquivo manualmente nunca mais.
//
// ⚠️ CRÍTICO: este caminho (/feed/imovelweb.xml) é servido por ESTA função
// dinâmica. NUNCA deve existir um arquivo estático em site/feed/imovelweb.xml
// no repositório — se existir, ele TOMA PRIORIDADE sobre esta função (Netlify
// serve arquivo estático antes de rodar a function), travando o feed real da
// Imovelweb num retrato congelado do banco. Isso já aconteceu uma vez
// (2026-09-01) e ficou dias sem ninguém perceber. Sempre confirmar, antes de
// deployar o site, que não existe esse arquivo estático na pasta local.
//
// Estrutura confirmada via XSD oficial (OpenNaventAvisoBR.xsd) + exemplos reais
// Brasil + API sandbox/produção, e ajustada continuamente com o feedback da
// Rosana (Imovelweb) desde 2026-08-13.
//
// 2026-08-25: tentamos adicionar uma seção <Lancamentos> pros lançamentos
// (empreendimentos em obras), mas a Rosana confirmou que o formato que
// construímos NÃO é o que o sistema deles realmente aceita — pra lançamentos
// de verdade é preciso contratar um plano adicional ("fichas") com o executivo
// de contas. Revertido para o formato só de classificados: imóveis com
// situacao='lancamento' só entram se cidade='Curitiba' (exceção aberta pela
// Imovelweb); lançamentos de outras cidades ficam de fora.
// =====================================================================

// Chave pública (RLS protege o acesso) — mesma usada em js/supabase-client.js
const SUPABASE_URL = "https://yiyhspddvrypifxfzzdm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_JQK9ls0HmQDrGGOW8ClvDA_ehiFAUJd";

// idLocalidade a nível BAIRRO (V1-D) — pedido da Rosana/Imovelweb pra melhorar o Quality Score.
// Curitiba com o catálogo COMPLETO dos 104 bairros (obtido via API de produção em 2026-08-26).
// Cai pro nível CIDADE (V1-C) se o bairro não constar no catálogo deles (fallback seguro).
const LOCALIDADES_IMOVELWEB: Record<string, { cidadeId: string; bairros: Record<string, string> }> = {
  "fazenda rio grande": {
    cidadeId: "V1-C-106068",
    bairros: {
      centro: "V1-D-499749", "dom bosco": "V1-D-494526", estados: "V1-D-552417",
      eucaliptos: "V1-D-552418", "gralha azul": "V1-D-552419", iguacu: "V1-D-552420",
      "iguacu ii": "V1-D-494073", "jardim canaa": "V1-D-493778", "jardim colonial": "V1-D-495024",
      "jardim eucaliptos": "V1-D-493146", "jardim imaculada conceicao": "V1-D-494525",
      "jardim ipe": "V1-D-494955", "jardim das hortencias": "V1-D-493777", nacoes: "V1-D-552421",
      palmeiras: "V1-D-492894", "parque verde": "V1-D-493352", "passo amarelo": "V1-D-495023",
      pioneiros: "V1-D-532858", "patria minha": "V1-D-493351", "santa fe": "V1-D-494524",
      "santa maria": "V1-D-494667", "santa terezinha": "V1-D-552422", santarem: "V1-D-491505",
      "sao sebastiao": "V1-D-555994", "sitio cercado": "V1-D-494523", veneza: "V1-D-552423",
      "vera cruz": "V1-D-494522", "vila carelli": "V1-D-494521", "vista alegre": "V1-D-494520",
      "area rural de fazenda rio grande": "V1-D-1557932",
    },
  },
  curitiba: {
    cidadeId: "V1-C-106015",
    bairros: {
      "abranches": "V1-D-508617", "ahu": "V1-D-508619", "alphaville": "V1-D-499051", "alto boqueirao": "V1-D-508620",
      "alto da gloria": "V1-D-508621", "alto da xv": "V1-D-508622", "atuba": "V1-D-508623", "augusta": "V1-D-508624",
      "bacacheri": "V1-D-508625", "bairro alto": "V1-D-508626", "bairro novo": "V1-D-499317", "barigui": "V1-D-499639",
      "barreirinha": "V1-D-508627", "batel": "V1-D-508628", "bigorrilho": "V1-D-508629", "boa vista": "V1-D-508630",
      "bom retiro": "V1-D-508631", "boqueirao": "V1-D-508632", "butiatuvinha": "V1-D-508633", "cic": "V1-D-499085",
      "cabral": "V1-D-508634", "cachoeira": "V1-D-508635", "cajuru": "V1-D-508636", "campina do siqueira": "V1-D-508637",
      "campo comprido": "V1-D-508638", "campo de santana": "V1-D-508639", "campo do santana": "V1-D-508639",
      "capao da imbuia": "V1-D-508640", "capao raso": "V1-D-508641", "cascatinha": "V1-D-508642",
      "centro": "V1-D-508643", "centro civico": "V1-D-508644", "champagnat": "V1-D-508645", "cidade industrial": "V1-D-508647",
      "cristo rei": "V1-D-508648", "fanny": "V1-D-508649", "fazendinha": "V1-D-508650", "ganchinho": "V1-D-508651",
      "guabirotuba": "V1-D-508652", "guaira": "V1-D-508653", "hauer": "V1-D-508654", "hugo lange": "V1-D-508655",
      "jardim botanico": "V1-D-508656", "jardim das americas": "V1-D-508657", "jardim social": "V1-D-508658",
      "juveve": "V1-D-508659", "lamenha pequena": "V1-D-508660", "lindoia": "V1-D-508661", "mercês": "V1-D-508662",
      "merces": "V1-D-508662", "mossungue": "V1-D-508663", "novo mundo": "V1-D-508664", "orleans": "V1-D-508665",
      "parolin": "V1-D-508666", "pilarzinho": "V1-D-508667", "pinheirinho": "V1-D-508668", "portao": "V1-D-508669",
      "prado velho": "V1-D-508670", "rebouças": "V1-D-508671", "reboucas": "V1-D-508671", "riviera": "V1-D-508672",
      "santa candida": "V1-D-508673", "santa felicidade": "V1-D-508674", "santa quiteria": "V1-D-508675",
      "santo inacio": "V1-D-508676", "sao braz": "V1-D-508677", "sao francisco": "V1-D-508678",
      "sao joao": "V1-D-508679", "sao lourenco": "V1-D-508680", "sao miguel": "V1-D-508681",
      "seminario": "V1-D-508682", "sitio cercado": "V1-D-508683", "taboao": "V1-D-508684",
      "tarumã": "V1-D-508685", "taruma": "V1-D-508685", "tatuquara": "V1-D-508686", "tingui": "V1-D-508687",
      "uberaba": "V1-D-508688", "umbara": "V1-D-508689", "vila izabel": "V1-D-508690", "vista alegre": "V1-D-508691",
      "xaxim": "V1-D-508692", "ecoville": "V1-D-508693", "agua verde": "V1-D-508694",
    },
  },
  quitandinha: {
    cidadeId: "V1-C-106509",
    bairros: {
      "campina de quitandinha": "V1-D-548802", centro: "V1-D-532693", "cerro verde": "V1-D-548803",
      "doce fino": "V1-D-548805", "lagoa verde": "V1-D-548800", pangare: "V1-D-493035",
      "ribeirao vermelho": "V1-D-548806", "sao joao caiva": "V1-D-495391", turvo: "V1-D-548807",
    },
  },
};
function normalizarTextoImovelweb(v: unknown): string {
  return String(v ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ");
}
function resolverIdLocalidadeImovelweb(cidade: string | null, bairro: string | null): string {
  const cidadeInfo = LOCALIDADES_IMOVELWEB[normalizarTextoImovelweb(cidade)];
  if (!cidadeInfo) return LOCALIDADES_IMOVELWEB["fazenda rio grande"].cidadeId;
  // "teresinha" é grafia comum digitada pelos corretores; o catálogo oficial usa "terezinha"
  const bairroNorm = normalizarTextoImovelweb(bairro).replace(/teresinha/g, "terezinha");
  if (bairroNorm && cidadeInfo.bairros[bairroNorm]) return cidadeInfo.bairros[bairroNorm];
  if (bairroNorm) {
    const chaveAprox = Object.keys(cidadeInfo.bairros).find((k) => bairroNorm.includes(k) || k.includes(bairroNorm));
    if (chaveAprox) return cidadeInfo.bairros[chaveAprox];
  }
  return cidadeInfo.cidadeId;
}

// Catálogo de tipos/subtipos confirmado via GET /v1/tipopropriedade e /subtipos
const MAPA_TIPO_IMOVELWEB: Record<string, { idTipo: string; tipo: string; idSubTipo: string; subTipo: string }> = {
  casa: { idTipo: "1", tipo: "Casa", idSubTipo: "5", subTipo: "Padrão" },
  apartamento: { idTipo: "2", tipo: "Apartamento", idSubTipo: "1", subTipo: "Padrão" },
  kitnet: { idTipo: "2", tipo: "Apartamento", idSubTipo: "1", subTipo: "Padrão" },
  terreno: { idTipo: "1003", tipo: "Terreno", idSubTipo: "8", subTipo: "Terreno Padrão" },
  area_urbana: { idTipo: "1003", tipo: "Terreno", idSubTipo: "8", subTipo: "Terreno Padrão" },
  sitio: { idTipo: "1004", tipo: "Rurais", idSubTipo: "11", subTipo: "Sítio" },
  fazenda: { idTipo: "1004", tipo: "Rurais", idSubTipo: "12", subTipo: "Fazenda" },
  area_rural: { idTipo: "1004", tipo: "Rurais", idSubTipo: "10", subTipo: "Chácara" },
  comercial: { idTipo: "1005", tipo: "Comercial", idSubTipo: "31", subTipo: "Ponto Comercial" },
  galpao: { idTipo: "1005", tipo: "Comercial", idSubTipo: "20", subTipo: "Galpão/Depósito/Barracão" },
  sala_comercial: { idTipo: "1005", tipo: "Comercial", idSubTipo: "16", subTipo: "Conjunto Comercial/sala" },
};

const TIPO_PUBLICACAO_IMOVELWEB: Record<string, string> = { super_destaque: "HOME", destaque: "DESTACADO", simples: "SIMPLE" };

// Dados do publicador (vindos de config_site) — codigoImobiliaria fica pendente
// até a Imovelweb liberar a integração em produção e informar o código real.
const PUBLICADOR_IMOVELWEB = {
  codigoImobiliaria: "PENDENTE_PRODUCAO",
  emailContato: "imobiliariagregorio@gmail.com",
  nomeContato: "Gregório | Meu Lar Imobiliária",
  telefoneContato: "(41) 99547-6193",
};

// Comodidades (características booleanas do catálogo Imovelweb, IDs confirmados via
// GET /v1/tipopropiedades/{id}/caracteristicas) mapeadas a partir da descrição livre.
const REGRAS_CARACTERISTICAS_EXTRAS_IMOVELWEB: [string[], string][] = [
  [["piscina"], "20140"],
  [["churrasqueira", "churraqueira"], "20048"],
  [["ar-condicionado", "ar condicionado", "climatiza"], "20012"],
  [["espaco pet", "pet place", "pet spa", "aceita pet", "permite animais", "permite pet"], "20135"],
  [["espaco gourmet", "gourmet"], "20080"],
  [["despensa"], "20065"],
  [["sistema de alarme", "alarme"], "20184"],
  [["quarto de servico"], "20062"],
  [["varanda", "sacada"], "20199"],
  [["elevador"], "20071"],
  [["sauna"], "10183"],
  [["salao de festas"], "10181"],
];
function caracteristicasExtrasImovelweb(im: Imovel): string[] {
  const texto = normalizarTextoImovelweb([im.descricao, im.pontos_fortes, (im.caracteristicas || []).join(" | ")].filter(Boolean).join(" | "));
  const ids: string[] = [];
  REGRAS_CARACTERISTICAS_EXTRAS_IMOVELWEB.forEach(([palavras, id]) => {
    if (palavras.some((p) => texto.includes(p))) ids.push(id);
  });
  if (im.aceita_permuta) ids.push("10088");
  return ids;
}

type Imovel = {
  id: string;
  codigo: string | null;
  titulo: string | null;
  tipo: string | null;
  finalidade: string | null;
  valor_venda: string | number | null;
  valor_locacao: string | number | null;
  valor_condominio: string | number | null;
  valor_iptu: string | number | null;
  endereco: string | null;
  numero: string | null;
  bairro: string | null;
  cep: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  area_total: string | number | null;
  area_construida: string | number | null;
  ano_construcao: number | null;
  complemento: string | null;
  cidade: string | null;
  quartos: number | null;
  suites: number | null;
  vagas_garagem: number | null;
  banheiros: number | null;
  caracteristicas: string[] | null;
  aceita_permuta: boolean | null;
  situacao: string | null;
  grupo_empreendimento: string | null;
  descricao: string | null;
  pontos_fortes: string | null;
  fotos: string[] | null;
  portais_destaque: Record<string, string> | null;
};

function xmlTag(tag: string, valor: unknown): string {
  const s = String(valor ?? "").replace(/\]\]>/g, "]]]]><![CDATA[>");
  return `<${tag}><![CDATA[${s}]]></${tag}>`;
}
function nivelDestaquePortal(im: Imovel, portalKey: string): string {
  return (im.portais_destaque && im.portais_destaque[portalKey]) || "simples";
}

function gerarXmlImovelweb(imoveis: Imovel[]): { xml: string; puladosPoucasFotos: string[] } {
  const blocos: string[] = [];
  const puladosPoucasFotos: string[] = [];

  imoveis.forEach((im) => {
    // 2026-08-25: Imovelweb abriu uma exceção e passou a aceitar lançamentos de Curitiba
    // como classificado normal (<Imovel>). Lançamentos de outras cidades continuam de fora
    // (regra do Gregório: só lançamento de Curitiba pode ir pro Imovelweb).
    if (im.situacao === "lancamento" && normalizarTextoImovelweb(im.cidade) !== "curitiba") return;
    const fotos = Array.isArray(im.fotos) ? im.fotos : [];
    if (fotos.length < 5) { puladosPoucasFotos.push(im.codigo || im.titulo || im.id); return; }

    const mapaTipo = MAPA_TIPO_IMOVELWEB[im.tipo ?? ""] || MAPA_TIPO_IMOVELWEB.casa;
    const nivel = nivelDestaquePortal(im, "imovelweb");

    let descricao = [im.descricao, im.pontos_fortes].filter(Boolean).join("\n\n").trim();
    if (descricao.length < 50) {
      descricao = `${descricao} Imóvel disponível através da Gregório | Meu Lar Imobiliária, em Fazenda Rio Grande - PR. Entre em contato para mais informações e agendamento de visita.`.trim();
    }
    descricao = descricao.slice(0, 10000);

    const titulo = (im.titulo || `${mapaTipo.tipo} em Fazenda Rio Grande`).slice(0, 80);
    const endereco = [im.endereco, im.numero].filter(Boolean).join(", ").slice(0, 200) || "Endereço a confirmar";

    const caracts: string[] = [];
    const addCaract = (id: string, opts: { valor?: unknown; idValor?: unknown }) =>
      caracts.push(`<caracteristica>${xmlTag("id", id)}${opts.valor !== undefined ? xmlTag("valor", opts.valor) : ""}${opts.idValor !== undefined ? xmlTag("idValor", opts.idValor) : ""}</caracteristica>`);
    if (im.quartos) addCaract("CFT2", { valor: im.quartos });
    if (im.banheiros) addCaract("CFT3", { valor: im.banheiros });
    if (im.suites) addCaract("CFT4", { valor: im.suites });
    if (im.vagas_garagem) addCaract("CFT7", { valor: im.vagas_garagem });
    if (im.area_total) addCaract("CFT100", { valor: im.area_total });
    if (im.area_construida) addCaract("CFT101", { valor: im.area_construida });
    if (im.valor_condominio) addCaract("CFT6", { valor: im.valor_condominio });
    if (im.valor_iptu) addCaract("CFT400", { valor: im.valor_iptu });
    if (im.ano_construcao) addCaract("CFT5", { valor: Math.max(0, new Date().getFullYear() - im.ano_construcao) });
    if (im.complemento) addCaract("2000199", { valor: im.complemento });
    caracteristicasExtrasImovelweb(im).forEach((id) => addCaract(id, { idValor: "1" }));
    if (!caracts.length) addCaract("CFT2", { valor: im.quartos || 0 });

    const precos: string[] = [];
    if ((im.finalidade === "venda" || im.finalidade === "venda_locacao") && im.valor_venda) {
      precos.push(`<preco><quantidade><![CDATA[${Math.round(Number(im.valor_venda))}]]></quantidade><moeda><![CDATA[BRL]]></moeda><operacao><![CDATA[VENTA]]></operacao></preco>`);
    }
    if ((im.finalidade === "locacao" || im.finalidade === "venda_locacao") && im.valor_locacao) {
      precos.push(`<preco><quantidade><![CDATA[${Math.round(Number(im.valor_locacao))}]]></quantidade><moeda><![CDATA[BRL]]></moeda><operacao><![CDATA[ALQUILER]]></operacao></preco>`);
    }
    if (!precos.length) return;

    const imagensXml = fotos.slice(0, 50).map((url) => `<imagem>${xmlTag("urlImagem", url)}</imagem>`).join("");

    blocos.push(`
    <Imovel>
      ${xmlTag("codigoAnuncio", String(im.codigo || im.id).slice(0, 100))}
      ${xmlTag("codigoReferencia", String(im.codigo || im.id).slice(0, 99))}
      ${xmlTag("titulo", titulo)}
      ${xmlTag("descricao", descricao)}
      <tipoPropriedade>
        ${xmlTag("idTipo", mapaTipo.idTipo)}
        ${xmlTag("tipo", mapaTipo.tipo)}
        ${xmlTag("idSubTipo", mapaTipo.idSubTipo)}
        ${xmlTag("subTipo", mapaTipo.subTipo)}
      </tipoPropriedade>
      <caracteristicas>${caracts.join("")}</caracteristicas>
      <precos>${precos.join("")}</precos>
      <multimidia><imagens>${imagensXml}</imagens></multimidia>
      <localizacao>
        ${xmlTag("endereco", endereco)}
        ${xmlTag("idLocalidade", resolverIdLocalidadeImovelweb(im.cidade, im.bairro))}
        ${xmlTag("codigoPostal", im.cep || "")}
        ${xmlTag("mostrarMapa", im.latitude && im.longitude ? "EXACTO" : "APROXIMADO")}
        ${im.latitude ? xmlTag("latitude", im.latitude) : ""}
        ${im.longitude ? xmlTag("longitude", im.longitude) : ""}
      </localizacao>
      <publicacao>${xmlTag("tipoPublicacao", TIPO_PUBLICACAO_IMOVELWEB[nivel] || "SIMPLE")}</publicacao>
      <publicador>
        ${xmlTag("codigoImobiliaria", PUBLICADOR_IMOVELWEB.codigoImobiliaria)}
        ${xmlTag("emailContato", PUBLICADOR_IMOVELWEB.emailContato)}
        ${xmlTag("nomeContato", PUBLICADOR_IMOVELWEB.nomeContato)}
        ${xmlTag("telefoneContato", PUBLICADOR_IMOVELWEB.telefoneContato)}
      </publicador>
    </Imovel>`);
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<OpenNavent>
  <dataModificacao>${Date.now()}</dataModificacao>
  <Imoveis>${blocos.join("")}
  </Imoveis>
</OpenNavent>`;

  return { xml, puladosPoucasFotos };
}

const COLUNAS = [
  "id", "codigo", "titulo", "tipo", "finalidade",
  "valor_venda", "valor_locacao", "valor_condominio", "valor_iptu",
  "endereco", "numero", "bairro", "cidade", "cep", "latitude", "longitude",
  "area_total", "area_construida", "quartos", "suites", "vagas_garagem", "banheiros",
  "ano_construcao", "complemento", "caracteristicas", "aceita_permuta", "situacao", "grupo_empreendimento",
  "descricao", "pontos_fortes", "fotos", "portais_destaque",
].join(",");

export default async (req: Request, context: Context) => {
  // Mesma regra de "ativo" usada no CRM: status = disponivel, publicado no site,
  // e com o portal Imovelweb marcado na ficha do imóvel.
  const url =
    `${SUPABASE_URL}/rest/v1/imoveis?select=${COLUNAS}` +
    `&status=eq.disponivel&publicado=eq.true&portais_publicacao=cs.%7Bimovelweb%7D` +
    `&order=criado_em.desc`;

  const resposta = await fetch(url, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });

  if (!resposta.ok) {
    return new Response("Erro ao buscar imóveis no Supabase.", { status: 502 });
  }

  const imoveis: Imovel[] = await resposta.json();
  const { xml } = gerarXmlImovelweb(imoveis);

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
};

export const config: Config = {
  path: "/feed/imovelweb.xml",
};
