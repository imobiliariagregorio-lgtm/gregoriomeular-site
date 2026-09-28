import type { Context, Config } from "@netlify/functions";

// =====================================================================
// FEED XML — GRUPO OLX (ZAP Imóveis, Viva Real e OLX) — formato VRSync
// Gera, na hora, o XML dos imóveis ativos ("disponível", publicados no site)
// que estiverem marcados no CRM para ZAP, Viva Real ou OLX. Os três portais
// leem o mesmo arquivo (o formato não é atrelado a um portal específico).
//
// URLs servidas por ESTA função:
//   /feed/vivareal.xml
//   /feed/vivareal/<TOKEN>_www.imoveisgregorio.com.br.xml   <- a que o Grupo OLX lê
//     (mesmo caminho que o ImobiBrasil usava — o portal continua lendo o mesmo endereço)
//
// ⚠️ CRÍTICO: NUNCA criar arquivo estático em site/feed/... — arquivo estático tem
// prioridade sobre a function e congela o feed num retrato antigo do banco
// (já aconteceu com o feed do Imovelweb em 2026-09-01).
//
// Regras do portal (developers.grupozap.com, conferidas em 2026-09-28):
//  - o portal lê (polling) a cada 12 horas, com User-Agent "VivaRealBot/1.0";
//  - só aceita redirect de HTTP para HTTPS do MESMO domínio (por isso a URL
//    cadastrada no portal deve ser https://imoveisgregorio.com.br/..., sem www);
//  - PostalCode obrigatório; Location/Country/State/City/Neighborhood obrigatórios;
//  - mínimo de 5 fotos, só jpg, uma com primary="true"; vídeo só do YouTube;
//  - Title 10–100 caracteres; Description 50–3.000 caracteres; ListingID único (1–50);
//  - áreas em número inteiro, com unit="square metres": LotArea para terreno/galpão/
//    rural, LivingArea (obrigatório) para os demais;
//  - anúncios acima da grade contratada são inativados pelo próprio portal.
//
// Diagnóstico (só na URL com token):
//   ?diagnostico=1  -> JSON com o que entrou no feed e o que foi ignorado (e por quê)
//   ?preview=todos  -> ignora a marcação de portal (testa todos os imóveis ativos)
// =====================================================================

const SUPABASE_URL = "https://yiyhspddvrypifxfzzdm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_JQK9ls0HmQDrGGOW8ClvDA_ehiFAUJd";

const SITE = "https://imoveisgregorio.com.br";
const ARQUIVO_TOKEN = "xnd1q62983phwms5ikoa4ycvr88859_www.imoveisgregorio.com.br.xml";

const PUBLICADOR = {
  nome: "Gregório | Meu Lar Imobiliária",
  email: "imobiliariagregorio@gmail.com",
  telefone: "(41) 99547-6193",
  site: SITE,
  logo: `${SITE}/assets/logo-header.png`,
};

type Imovel = {
  id: string;
  codigo: string | null;
  titulo: string | null;
  tipo: string | null;
  finalidade: string | null;
  situacao: string | null;
  valor_venda: string | number | null;
  valor_locacao: string | number | null;
  valor_condominio: string | number | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  area_total: string | number | null;
  area_construida: string | number | null;
  quartos: number | null;
  suites: number | null;
  vagas_garagem: number | null;
  banheiros: number | null;
  caracteristicas: string[] | null;
  descricao: string | null;
  pontos_fortes: string | null;
  fotos: string[] | null;
  video_url: string | null;
  portais_destaque: Record<string, string> | null;
};

const COLUNAS = [
  "id", "codigo", "titulo", "tipo", "finalidade", "situacao",
  "valor_venda", "valor_locacao", "valor_condominio",
  "endereco", "numero", "complemento", "bairro", "cidade", "estado", "cep", "latitude", "longitude",
  "area_total", "area_construida", "quartos", "suites", "vagas_garagem", "banheiros",
  "caracteristicas", "descricao", "pontos_fortes", "fotos", "video_url", "portais_destaque",
].join(",");

// ---- tipos (valores oficiais do elemento PropertyType) ----
const MAPA_TIPO: Record<string, { propertyType: string; usage: string; label: string }> = {
  casa: { propertyType: "Residential / Home", usage: "Residential", label: "Casa" },
  apartamento: { propertyType: "Residential / Apartment", usage: "Residential", label: "Apartamento" },
  kitnet: { propertyType: "Residential / Kitnet", usage: "Residential", label: "Kitnet" },
  terreno: { propertyType: "Residential / Land Lot", usage: "Residential", label: "Terreno" },
  area_urbana: { propertyType: "Residential / Land Lot", usage: "Residential", label: "Terreno" },
  sitio: { propertyType: "Residential / Agricultural", usage: "Residential", label: "Sítio" },
  fazenda: { propertyType: "Residential / Agricultural", usage: "Residential", label: "Fazenda" },
  area_rural: { propertyType: "Residential / Farm Ranch", usage: "Residential", label: "Chácara" },
  comercial: { propertyType: "Commercial / Business", usage: "Commercial", label: "Ponto comercial" },
  galpao: { propertyType: "Commercial / Industrial", usage: "Commercial", label: "Galpão" },
  sala_comercial: { propertyType: "Commercial / Office", usage: "Commercial", label: "Sala comercial" },
};
// Tipos em que o portal quer a ÁREA TOTAL (LotArea); nos demais, a área útil (LivingArea).
const TIPOS_LOTAREA = new Set([
  "Residential / Land Lot", "Commercial / Land Lot", "Commercial / Industrial",
  "Residential / Agricultural", "Residential / Farm Ranch",
]);
const EXIGE_QUARTOS = new Set([
  "Residential / Home", "Residential / Apartment", "Residential / Condo", "Residential / Sobrado",
  "Residential / Farm Ranch", "Residential / Agricultural",
]);
const EXIGE_BANHEIROS = new Set([
  ...EXIGE_QUARTOS, "Residential / Kitnet", "Commercial / Office",
]);

// ---- características (valores oficiais do elemento Feature) ----
const REGRAS_FEATURES: [string[], string][] = [
  [["piscina"], "Pool"],
  [["churrasqueira", "churraqueira"], "BBQ"],
  [["ar-condicionado", "ar condicionado", "climatiza"], "Cooling"],
  [["espaco pet", "pet place", "aceita pet", "permite animais", "permite pet", "pet friendly"], "Pets Allowed"],
  [["espaco gourmet", "gourmet"], "Gourmet Area"],
  [["despensa"], "Pantry"],
  [["alarme"], "Alarm System"],
  [["varanda", "sacada"], "Balcony"],
  [["elevador"], "Elevator"],
  [["sauna"], "Sauna"],
  [["salao de festas"], "Party Room"],
  [["playground"], "Playground"],
  [["academia", "fitness"], "Gym"],
  [["quintal"], "Backyard"],
  [["lavanderia"], "Laundry"],
  [["edicula"], "Edicule"],
  [["portaria 24"], "Concierge 24h"],
  [["rua asfaltada", "asfalto"], "Paved Street"],
  [["esquina"], "Corner Property"],
];

const ESTADOS: Record<string, string> = { PR: "Paraná", SC: "Santa Catarina", SP: "São Paulo", RS: "Rio Grande do Sul" };
const NIVEL_ORDEM = ["simples", "destaque", "super_destaque"];
const PUBLICATION_TYPE: Record<string, string> = { simples: "STANDARD", destaque: "PREMIUM", super_destaque: "SUPER_PREMIUM" };

function cdata(v: unknown): string {
  return `<![CDATA[${String(v ?? "").replace(/\]\]>/g, "]]]]><![CDATA[>")}]]>`;
}
function normalizar(v: unknown): string {
  return String(v ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}
function slugify(t: string): string {
  return (t || "imovel").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "imovel";
}
function inteiro(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : 0;
}
function semHtml(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
// Descrições do CRM podem vir com markdown (### título, **negrito**, - itens). O portal não
// interpreta markdown, então limpamos: título vira texto, negrito some, itens viram "•".
function limpaMarkdown(s: string): string {
  return s
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^\s*[-*•]\s+/gm, "&bull; ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
// Quebra de linha no padrão do portal (entidade dentro do CDATA), respeitando o teto de 3.000
// caracteres do elemento Description já com as entidades contadas.
function descricaoParaPortal(bruta: string): string {
  let corte = 2600;
  let saida = bruta.slice(0, corte).replace(/\n/g, "&lt;br&gt;");
  while (saida.length > 2950 && corte > 200) {
    corte -= 100;
    saida = bruta.slice(0, corte).replace(/\n/g, "&lt;br&gt;");
  }
  return saida;
}
function cepFormatado(cep: string | null): string | null {
  const d = String(cep ?? "").replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : null;
}
function ehJpg(url: string): boolean {
  return /\.jpe?g(\?.*)?$/i.test(url);
}
function nivelMaisAlto(im: Imovel): string {
  const d = im.portais_destaque || {};
  return ["zap", "vivareal", "olx"]
    .map((k) => d[k] || "simples")
    .reduce((a, b) => (NIVEL_ORDEM.indexOf(b) > NIVEL_ORDEM.indexOf(a) ? b : a), "simples");
}

type Resultado = { xml: string; incluidos: { codigo: string; titulo: string; tipo: string; publicacao: string }[]; ignorados: { codigo: string; motivos: string[] }[] };

function gerarVrSync(imoveis: Imovel[]): Resultado {
  const blocos: string[] = [];
  const incluidos: Resultado["incluidos"] = [];
  const ignorados: Resultado["ignorados"] = [];

  imoveis.forEach((im) => {
    const codigo = String(im.codigo || im.id).slice(0, 50);
    const motivos: string[] = [];
    const mapa = MAPA_TIPO[im.tipo ?? ""];
    if (!mapa) motivos.push(`tipo "${im.tipo}" sem equivalente no portal`);

    const cep = cepFormatado(im.cep);
    if (!cep) motivos.push("CEP ausente ou inválido (obrigatório no portal)");
    if (!im.cidade) motivos.push("cidade ausente");
    if (!im.bairro) motivos.push("bairro ausente");

    const fotos = (Array.isArray(im.fotos) ? im.fotos : []).filter(ehJpg).slice(0, 40);
    if (fotos.length < 5) motivos.push(`só ${fotos.length} foto(s) jpg (mínimo 5; png/webp não são importadas)`);

    // Preço / tipo de transação
    const venda = inteiro(im.valor_venda);
    const locacao = inteiro(im.valor_locacao);
    let transacao = "";
    if (im.finalidade === "venda_locacao") transacao = venda > 0 && locacao > 0 ? "Sale/Rent" : venda > 0 ? "For Sale" : locacao > 0 ? "For Rent" : "";
    else if (im.finalidade === "locacao") transacao = locacao > 0 ? "For Rent" : "";
    else transacao = venda > 0 ? "For Sale" : "";
    if (!transacao) motivos.push("sem preço para a finalidade do anúncio");

    // Áreas
    const areaTotal = inteiro(im.area_total);
    const usaLot = mapa ? TIPOS_LOTAREA.has(mapa.propertyType) : false;
    // Apartamento, kitnet e sala comercial costumam ter só a "área total" cadastrada,
    // que nesses tipos É a área útil. Em casa NÃO vale (a área total é a do terreno).
    const TOTAL_VALE_COMO_UTIL = new Set(["Residential / Apartment", "Residential / Kitnet", "Commercial / Office"]);
    const areaUtil = inteiro(im.area_construida) > 0
      ? inteiro(im.area_construida)
      : mapa && TOTAL_VALE_COMO_UTIL.has(mapa.propertyType) ? areaTotal : 0;
    const totalEhUtil = inteiro(im.area_construida) <= 0 && areaUtil > 0;
    if (mapa) {
      if (usaLot && areaTotal <= 0) motivos.push("área total ausente (LotArea)");
      if (!usaLot && areaUtil <= 0) motivos.push("área construída/útil ausente (LivingArea obrigatório)");
    }
    if (mapa && EXIGE_QUARTOS.has(mapa.propertyType) && !im.quartos) motivos.push("quartos ausente");
    if (mapa && EXIGE_BANHEIROS.has(mapa.propertyType) && !im.banheiros) motivos.push("banheiros ausente");

    if (motivos.length || !mapa) { ignorados.push({ codigo, motivos }); return; }

    // Título e descrição dentro dos limites do portal
    let titulo = semHtml(im.titulo || "").slice(0, 100);
    if (titulo.length < 10) titulo = `${mapa.label} em ${im.bairro}, ${im.cidade}`.slice(0, 100);

    let descricao = limpaMarkdown(semHtml([im.descricao, im.pontos_fortes].filter(Boolean).join("\n\n")));
    if (descricao.length < 50) {
      descricao = `${descricao} Imóvel disponível através da Gregório | Meu Lar Imobiliária, em ${im.cidade} - ${im.estado || "PR"}. Entre em contato para mais informações e agendamento de visita.`.trim();
    }
    descricao = descricaoParaPortal(descricao);

    const texto = normalizar([im.descricao, im.pontos_fortes, (im.caracteristicas || []).join(" | ")].filter(Boolean).join(" | "));
    const features = REGRAS_FEATURES.filter(([palavras]) => palavras.some((p) => texto.includes(p))).map(([, f]) => f);

    const nivel = nivelMaisAlto(im);
    const publicacao = PUBLICATION_TYPE[nivel] || "STANDARD";

    // Endereço: completo quando há rua e número; senão só rua; senão só bairro
    const displayAddress = im.endereco && im.numero ? "All" : im.endereco ? "Street" : "Neighborhood";
    const uf = String(im.estado || "PR").toUpperCase().slice(0, 2);

    const midia = fotos.map((url, i) => `<Item medium="image" caption="${xmlAttr(`Foto ${i + 1}`)}"${i === 0 ? ' primary="true"' : ""}>${cdata(url)}</Item>`);
    if (im.video_url && /youtube\.com|youtu\.be/i.test(im.video_url)) midia.unshift(`<Item medium="video">${cdata(im.video_url)}</Item>`);

    const detalhes: string[] = [
      `<UsageType>${mapa.usage}</UsageType>`,
      `<PropertyType>${mapa.propertyType}</PropertyType>`,
      `<Description>${cdata(descricao)}</Description>`,
    ];
    if (transacao !== "For Rent") detalhes.push(`<ListPrice currency="BRL">${venda}</ListPrice>`);
    if (transacao !== "For Sale") detalhes.push(`<RentalPrice currency="BRL" period="Monthly">${locacao}</RentalPrice>`);
    if (usaLot) detalhes.push(`<LotArea unit="square metres">${areaTotal}</LotArea>`);
    else {
      detalhes.push(`<LivingArea unit="square metres">${areaUtil}</LivingArea>`);
      if (areaTotal > 0 && !totalEhUtil) detalhes.push(`<LotArea unit="square metres">${areaTotal}</LotArea>`);
    }
    if (inteiro(im.valor_condominio) > 0) detalhes.push(`<PropertyAdministrationFee currency="BRL">${inteiro(im.valor_condominio)}</PropertyAdministrationFee>`);
    if (EXIGE_QUARTOS.has(mapa.propertyType) || im.quartos) detalhes.push(`<Bedrooms>${im.quartos || 0}</Bedrooms>`);
    if (EXIGE_BANHEIROS.has(mapa.propertyType) || im.banheiros) detalhes.push(`<Bathrooms>${im.banheiros || 0}</Bathrooms>`);
    if (im.suites) detalhes.push(`<Suites>${im.suites}</Suites>`);
    if (im.vagas_garagem) detalhes.push(`<Garage type="Parking Space">${im.vagas_garagem}</Garage>`);
    if (features.length) detalhes.push(`<Features>${features.map((f) => `<Feature>${f}</Feature>`).join("")}</Features>`);

    const local: string[] = [
      `<Country abbreviation="BR">Brasil</Country>`,
      `<State abbreviation="${uf}">${cdata(ESTADOS[uf] || uf)}</State>`,
      `<City>${cdata(im.cidade)}</City>`,
      `<Neighborhood>${cdata(im.bairro)}</Neighborhood>`,
    ];
    if (im.endereco) local.push(`<Address>${cdata(im.endereco)}</Address>`);
    if (im.numero) local.push(`<StreetNumber>${cdata(im.numero)}</StreetNumber>`);
    if (im.complemento) local.push(`<Complement>${cdata(im.complemento)}</Complement>`);
    local.push(`<PostalCode>${cep}</PostalCode>`);
    if (im.latitude && im.longitude) {
      local.push(`<Latitude>${Number(im.latitude)}</Latitude>`, `<Longitude>${Number(im.longitude)}</Longitude>`);
    }

    blocos.push(`
    <Listing>
      <ListingID>${cdata(codigo)}</ListingID>
      <Title>${cdata(titulo)}</Title>
      <TransactionType>${transacao}</TransactionType>
      <PublicationType>${publicacao}</PublicationType>
      <DetailViewUrl>${cdata(`${SITE}/imovel/${slugify(im.titulo || "")}-${im.id}`)}</DetailViewUrl>
      <Media>${midia.join("")}</Media>
      <Details>${detalhes.join("")}</Details>
      <Location displayAddress="${displayAddress}">${local.join("")}</Location>
      <ContactInfo>
        <Name>${cdata(PUBLICADOR.nome)}</Name>
        <Email>${cdata(PUBLICADOR.email)}</Email>
        <Website>${cdata(PUBLICADOR.site)}</Website>
        <Logo>${cdata(PUBLICADOR.logo)}</Logo>
        <OfficeName>${cdata(PUBLICADOR.nome)}</OfficeName>
        <Telephone>${cdata(PUBLICADOR.telefone)}</Telephone>
      </ContactInfo>
    </Listing>`);
    incluidos.push({ codigo, titulo, tipo: mapa.propertyType, publicacao });
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListingDataFeed xmlns="http://www.vivareal.com/schemas/1.0/VRSync" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.vivareal.com/schemas/1.0/VRSync http://xml.vivareal.com/vrsync.xsd">
  <Header>
    <Provider>${cdata(PUBLICADOR.nome)}</Provider>
    <Email>${cdata(PUBLICADOR.email)}</Email>
    <ContactName>${cdata(PUBLICADOR.nome)}</ContactName>
    <PublishDate>${new Date().toISOString().slice(0, 19)}</PublishDate>
    <Telephone>${cdata(PUBLICADOR.telefone)}</Telephone>
  </Header>
  <Listings>${blocos.join("")}
  </Listings>
</ListingDataFeed>`;

  return { xml, incluidos, ignorados };
}

function xmlAttr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const caminho = url.pathname;
  const ehTokenizada = caminho === `/feed/vivareal/${ARQUIVO_TOKEN}`;
  if (caminho !== "/feed/vivareal.xml" && !ehTokenizada) {
    return new Response("Not found", { status: 404 });
  }

  const preview = ehTokenizada && url.searchParams.get("preview") === "todos";
  const diagnostico = ehTokenizada && url.searchParams.get("diagnostico") === "1";

  // Mesma regra de "ativo" do CRM: disponível, publicado no site e marcado para
  // ZAP, Viva Real ou OLX na ficha do imóvel.
  const filtroPortal = preview ? "" : "&portais_publicacao=ov.%7Bzap,vivareal,olx%7D";
  const consulta =
    `${SUPABASE_URL}/rest/v1/imoveis?select=${COLUNAS}` +
    `&status=eq.disponivel&publicado=eq.true${filtroPortal}&order=criado_em.desc`;

  const resposta = await fetch(consulta, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!resposta.ok) return new Response("Erro ao buscar imóveis no Supabase.", { status: 502 });

  const imoveis: Imovel[] = await resposta.json();
  const { xml, incluidos, ignorados } = gerarVrSync(imoveis);

  if (diagnostico) {
    return new Response(JSON.stringify({ marcados_no_crm: imoveis.length, no_feed: incluidos, ignorados }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": preview ? "no-store" : "public, max-age=300, s-maxage=300",
    },
  });
};

export const config: Config = {
  path: ["/feed/vivareal.xml", "/feed/vivareal/*"],
};
