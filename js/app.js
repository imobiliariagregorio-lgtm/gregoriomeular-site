
// =====================================================================
// HELPERS
// =====================================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function formatMoney(value) {
  if (value === null || value === undefined) return '';
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

const TIPO_LABELS = {
  casa: 'Casa', apartamento: 'Apartamento', terreno: 'Terreno', sitio: 'Sítio',
  fazenda: 'Fazenda', comercial: 'Comercial', galpao: 'Galpão',
  sala_comercial: 'Sala comercial', area_rural: 'Área rural', area_urbana: 'Área urbana'
};

function tipoLabel(tipo) { return TIPO_LABELS[tipo] || tipo; }

function whatsappLink(extraText) {
  const text = encodeURIComponent(extraText || WHATSAPP_MESSAGE);
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${text}`;
}

// =====================================================================
// RASTREIO DE CONVERSÃO — GA4 e Meta Pixel
// Dispara em: clique em qualquer WhatsApp e envio do formulário de contato.
// Se a propriedade GA4 estiver linkada ao Google Ads e "generate_lead" marcado
// como evento-chave, essas mesmas conversões entram automaticamente no Google Ads
// (não precisa de um AW-.../label separado).
// =====================================================================
function trackEvent(nome, params = {}) {
  if (typeof gtag === 'function') gtag('event', nome, params);
}
function trackMeta(nome, params = {}) {
  if (typeof fbq === 'function') fbq('track', nome, params);
}
function trackWhatsappClick(origem) {
  trackEvent('whatsapp_click', { origem });
  trackMeta('Contact', { content_name: origem });
}
// Marca automaticamente qualquer link de WhatsApp clicado (atual e futuro, mesmo os
// que são renderizados dinamicamente depois, como o botão dentro do modal do imóvel).
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href*="wa.me"]');
  if (!link) return;
  trackWhatsappClick(link.id || link.closest('[id]')?.id || 'whatsapp_generico');
});

function priceLabel(imovel) {
  if (imovel.finalidade === 'locacao' && imovel.valor_locacao) {
    return `${formatMoney(imovel.valor_locacao)}/mês`;
  }
  if (imovel.valor_venda) return formatMoney(imovel.valor_venda);
  if (imovel.valor_locacao) return `${formatMoney(imovel.valor_locacao)}/mês`;
  return 'Consulte-nos';
}

function firstPhoto(imovel) {
  const fotos = allPhotos(imovel);
  return fotos.length ? fotos[0] : null;
}

function allPhotos(imovel) {
  try {
    const fotos = Array.isArray(imovel.fotos) ? imovel.fotos : JSON.parse(imovel.fotos || '[]');
    return Array.isArray(fotos) ? fotos.filter(Boolean) : [];
  } catch { return []; }
}

function tagList(arr) {
  return Array.isArray(arr) ? arr.filter(Boolean) : [];
}

function youtubeEmbedUrl(url) {
  if (!url) return null;
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/);
  return match ? `https://www.youtube.com/embed/${match[1]}` : null;
}

// =====================================================================
// RENDER: CARD DE IMÓVEL
// =====================================================================
function renderCard(imovel) {
  const foto = firstPhoto(imovel);
  const card = document.createElement('article');
  card.className = 'property-card';
  card.addEventListener('click', () => {
    if (imovel._isGrupo) {
      navigateToEmpreendimento(imovel._grupoCodigo, nomeEmpreendimento(imovel));
    } else {
      navigateToImovel(imovel);
      supabase.rpc('incrementar_visualizacao_imovel', { p_imovel_id: imovel.id }).then(({ error }) => { if (error) console.error(error); });
    }
  });

  const precoLabel = imovel._isGrupo ? `A partir de ${priceLabel(imovel)}` : priceLabel(imovel);
  const tituloCard = imovel._isGrupo ? nomeEmpreendimento(imovel) : imovel.titulo;

  card.innerHTML = `
    <div class="property-thumb">
      ${foto ? `<img src="${foto}" alt="${imovel.titulo}">` : '🏠'}
      <span class="badge ${imovel.finalidade === 'locacao' ? 'badge-outline' : ''}">
        ${imovel.finalidade === 'locacao' ? 'Locação' : imovel.finalidade === 'venda_locacao' ? 'Venda/Locação' : 'Venda'}
      </span>
      ${imovel.situacao === 'lancamento' ? '<span class="badge badge-outline" style="left:auto;right:12px;">🏗️ Lançamento</span>' : ''}
    </div>
    <div class="property-body">
      <div class="property-price">${precoLabel}</div>
      <div class="property-title">${tituloCard}</div>
      <div class="property-loc">${[imovel.bairro, imovel.cidade].filter(Boolean).join(' — ')}</div>
      <div class="property-specs">
        ${imovel._isGrupo ? `<span>🏘 ${imovel._unidades.length} unidade${imovel._unidades.length > 1 ? 's' : ''} disponíve${imovel._unidades.length > 1 ? 'is' : 'l'}</span>` : `
        ${imovel.quartos ? `<span>🛏 ${imovel.quartos}</span>` : ''}
        ${imovel.banheiros ? `<span>🚿 ${imovel.banheiros}</span>` : ''}
        ${imovel.vagas_garagem ? `<span>🚗 ${imovel.vagas_garagem}</span>` : ''}
        ${imovel.area_total ? `<span>📐 ${imovel.area_total}m²</span>` : ''}
        `}
      </div>
    </div>
  `;
  return card;
}

function renderGrid(container, imoveis, emptyEl) {
  container.innerHTML = '';
  if (!imoveis || imoveis.length === 0) {
    if (emptyEl) emptyEl.hidden = false;
    return;
  }
  if (emptyEl) emptyEl.hidden = true;
  agruparPorEmpreendimento(imoveis).forEach((item) => container.appendChild(renderCard(item)));
}

// Lançamentos com grupo_empreendimento definido viram UM card só (o de menor preço
// representa o grupo, com "a partir de"); clicar leva pra subpágina com todas as unidades.
function agruparPorEmpreendimento(imoveis) {
  const grupos = new Map();
  const semGrupo = [];
  imoveis.forEach((im) => {
    if (im.situacao === 'lancamento' && im.grupo_empreendimento) {
      if (!grupos.has(im.grupo_empreendimento)) grupos.set(im.grupo_empreendimento, []);
      grupos.get(im.grupo_empreendimento).push(im);
    } else {
      semGrupo.push(im);
    }
  });
  const cardsAgrupados = [];
  grupos.forEach((unidades, codigo) => {
    if (unidades.length === 1) {
      semGrupo.push(unidades[0]); // grupo de 1 unidade só — comporta-se como imóvel normal
      return;
    }
    const menorPreco = unidades.slice().sort((a, b) => (Number(a.valor_venda) || Infinity) - (Number(b.valor_venda) || Infinity))[0];
    cardsAgrupados.push({ ...menorPreco, _grupoCodigo: codigo, _unidades: unidades, _isGrupo: true });
  });
  return [...semGrupo, ...cardsAgrupados];
}

function nomeEmpreendimento(imovel) {
  return (imovel.titulo || '').split(' — ')[0].trim();
}

// =====================================================================
// PÁGINA COMPLETA DO IMÓVEL (URL própria, ex: /imovel/casa-x-<id>)
// =====================================================================
const DEFAULT_TITLE = document.title;
const DEFAULT_DESCRIPTION = document.querySelector('meta[name="description"]')?.content || '';

function slugify(text) {
  return (text || 'imovel')
    .toString().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'imovel';
}

function imovelUrl(imovel) {
  return `/imovel/${slugify(imovel.titulo)}-${imovel.id}`;
}

function empreendimentoUrl(grupoCodigo, nome) {
  return `/lancamento/${slugify(nome)}-${grupoCodigo}`;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const GRUPO_RE = /\/lancamento\/.*-([A-Z0-9]{2,8})$/;

function imovelIdFromPath(pathname) {
  const match = pathname.match(UUID_RE);
  return match ? match[0] : null;
}

function grupoFromPath(pathname) {
  const match = pathname.match(GRUPO_RE);
  return match ? match[1] : null;
}

async function fetchImovelById(id) {
  const { data, error } = await supabase.from('imoveis').select('*').eq('id', id).eq('publicado', true).maybeSingle();
  if (error) { console.error(error); return null; }
  return data;
}

async function fetchEmpreendimento(grupoCodigo) {
  const { data, error } = await supabase.from('imoveis').select('*')
    .eq('grupo_empreendimento', grupoCodigo).eq('publicado', true)
    .order('valor_venda', { ascending: true });
  if (error) { console.error(error); return []; }
  return data || [];
}

// ---- lightbox de fotos (foto inteira, sem corte, ao clicar na imagem) ----
let lightboxFotos = [];
let lightboxIndex = 0;

function abrirLightbox(index) {
  if (!lightboxFotos.length) return;
  lightboxIndex = ((index % lightboxFotos.length) + lightboxFotos.length) % lightboxFotos.length;
  $('#imovelLightboxImg').src = lightboxFotos[lightboxIndex];
  const varias = lightboxFotos.length > 1;
  $('#imovelLightboxPrev').hidden = !varias;
  $('#imovelLightboxNext').hidden = !varias;
  $('#imovelLightbox').hidden = false;
  document.body.style.overflow = 'hidden';
}

function fecharLightbox() {
  $('#imovelLightbox').hidden = true;
  document.body.style.overflow = '';
}

function lightboxMudarFoto(delta) {
  abrirLightbox(lightboxIndex + delta);
}

$('#imovelLightboxClose').addEventListener('click', fecharLightbox);
$('#imovelLightbox').addEventListener('click', (e) => { if (e.target.id === 'imovelLightbox') fecharLightbox(); });
$('#imovelLightboxPrev').addEventListener('click', () => lightboxMudarFoto(-1));
$('#imovelLightboxNext').addEventListener('click', () => lightboxMudarFoto(1));
document.addEventListener('keydown', (e) => {
  if ($('#imovelLightbox').hidden) return;
  if (e.key === 'Escape') fecharLightbox();
  if (e.key === 'ArrowLeft') lightboxMudarFoto(-1);
  if (e.key === 'ArrowRight') lightboxMudarFoto(1);
});

function renderImovelPage(imovel) {
  const fotos = allPhotos(imovel);
  const foto = fotos[0] || null;
  lightboxFotos = fotos;

  const enderecoCompleto = [
    [imovel.endereco, imovel.numero].filter(Boolean).join(', '),
    imovel.complemento,
    imovel.bairro,
  ].filter(Boolean).join(' — ');

  const caracteristicas = tagList(imovel.caracteristicas);
  const comodos = tagList(imovel.comodos);
  const proximidades = tagList(imovel.proximidades);
  const todasTags = [...caracteristicas, ...comodos, ...proximidades];

  const terreno = [
    imovel.terreno_frente ? `Frente ${imovel.terreno_frente}m` : null,
    imovel.terreno_fundo ? `Fundo ${imovel.terreno_fundo}m` : null,
    imovel.terreno_lateral_esquerda ? `Lateral esq. ${imovel.terreno_lateral_esquerda}m` : null,
    imovel.terreno_lateral_direita ? `Lateral dir. ${imovel.terreno_lateral_direita}m` : null,
  ].filter(Boolean).join(' · ');

  const finalidadeLabel = imovel.finalidade === 'locacao' ? 'Locação' : imovel.finalidade === 'venda_locacao' ? 'Venda/Locação' : 'Venda';

  $('#imovelHero').innerHTML = `
    ${foto ? `<img src="${foto}" alt="${imovel.titulo}" id="imovel-hero-img" title="Clique para ver a foto inteira">` : '🏠'}
    <div class="imovel-hero-fade"></div>
    <span class="badge imovel-hero-badge">${finalidadeLabel}</span>
  `;
  let heroIndiceAtual = 0;
  if (foto) {
    $('#imovel-hero-img').addEventListener('click', () => abrirLightbox(heroIndiceAtual));
  }

  $('#imovelGallery').innerHTML = fotos.length > 1
    ? fotos.map((url, i) => `<div class="imovel-gallery-thumb ${i === 0 ? 'active' : ''}" data-url="${url}"><img src="${url}" alt=""></div>`).join('')
    : '';

  $('#imovelMain').innerHTML = `
    <div class="imovel-title-row">
      <div>
        <p class="eyebrow">${tipoLabel(imovel.tipo)} · ${finalidadeLabel}${imovel.codigo ? ` · Código ${imovel.codigo}` : ''}</p>
        <h1>${imovel.titulo}</h1>
        <p>${enderecoCompleto || [imovel.bairro, imovel.cidade, imovel.estado].filter(Boolean).join(', ')}${imovel.cidade && enderecoCompleto ? `, ${imovel.cidade}/${imovel.estado || 'PR'}` : ''}${imovel.zona ? ` — Zona ${imovel.zona}` : ''}</p>
      </div>
    </div>
    ${imovel.ponto_referencia ? `<p class="eyebrow">📍 ${imovel.ponto_referencia}</p>` : ''}
    ${imovel.descricao ? `<p>${imovel.descricao}</p>` : ''}
    <div class="modal-specs">
      ${imovel.quartos ? `<div><strong>${imovel.quartos}</strong>Quartos</div>` : ''}
      ${imovel.suites ? `<div><strong>${imovel.suites}</strong>Suítes</div>` : ''}
      ${imovel.banheiros ? `<div><strong>${imovel.banheiros}</strong>Banheiros</div>` : ''}
      ${imovel.salas ? `<div><strong>${imovel.salas}</strong>Salas</div>` : ''}
      ${imovel.vagas_garagem ? `<div><strong>${imovel.vagas_garagem}</strong>Vagas</div>` : ''}
      ${imovel.area_total ? `<div><strong>${imovel.area_total}m²</strong>Área total</div>` : ''}
      ${imovel.area_construida ? `<div><strong>${imovel.area_construida}m²</strong>Área construída</div>` : ''}
      ${imovel.ano_construcao ? `<div><strong>${imovel.ano_construcao}</strong>Construído em</div>` : ''}
    </div>
    ${terreno ? `<p class="eyebrow">📐 Terreno — ${terreno}</p>` : ''}
    ${todasTags.length ? `<div class="modal-tags">${todasTags.map((t) => `<span class="tag-chip">${t}</span>`).join('')}</div>` : ''}
    ${imovel.pontos_fortes ? `<h3 class="modal-subtitle">Pontos fortes</h3><p style="white-space:pre-line">${imovel.pontos_fortes}</p>` : ''}
    ${youtubeEmbedUrl(imovel.video_url) ? `
      <h3 class="modal-subtitle">Vídeo</h3>
      <div class="modal-video">
        <iframe src="${youtubeEmbedUrl(imovel.video_url)}" title="Vídeo do imóvel" frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
      </div>
    ` : ''}
    ${imovel.situacao === 'lancamento' ? '<p class="eyebrow">🏗️ Lançamento — imóvel na planta / em construção</p>' : ''}
    ${imovel.elegivel_mcmv ? '<p class="eyebrow">✅ Elegível para Minha Casa Minha Vida</p>' : ''}
    ${imovel.aceita_financiamento ? '<p class="eyebrow">✅ Aceita financiamento</p>' : ''}
    ${imovel.aceita_permuta ? '<p class="eyebrow">✅ Aceita permuta</p>' : ''}
    ${imovel.latitude && imovel.longitude ? `
      <h3 class="modal-subtitle">Localização</h3>
      <div class="modal-mapa">
        <iframe src="https://maps.google.com/maps?q=${imovel.latitude},${imovel.longitude}&z=15&output=embed" title="Mapa do imóvel" frameborder="0" loading="lazy"></iframe>
      </div>
    ` : ''}
    ${imovel.tour_virtual_url ? `
      <a class="btn btn-outline btn-block" style="margin-bottom:10px" target="_blank" rel="noopener" href="${imovel.tour_virtual_url}">🧭 Ver tour virtual 360°</a>
    ` : ''}
  `;

  $('#imovelSide').innerHTML = `
    <div class="imovel-contact-card">
      <h3>${imovel.titulo}</h3>
      <div class="imovel-contact-price">${priceLabel(imovel)}</div>
      <div class="modal-lead-gate" id="modalLeadGate">
        <button type="button" class="btn btn-whatsapp btn-block" id="modalLeadGateOpen">Falar sobre este imóvel</button>
      </div>
    </div>
  `;

  if (fotos.length > 1) {
    $$('.imovel-gallery-thumb').forEach((el, i) => {
      el.title = 'Clique para ver a foto inteira';
      el.addEventListener('click', () => {
        $$('.imovel-gallery-thumb').forEach((t) => t.classList.remove('active'));
        el.classList.add('active');
        heroIndiceAtual = i;
        const img = $('#imovel-hero-img');
        if (img) img.src = el.dataset.url;
        abrirLightbox(i);
      });
    });
  }

  // ---- "Falar sobre este imóvel" — pede nome + WhatsApp antes de abrir a conversa,
  // grava como lead (a roleta de corretores do banco assume a distribuição sozinha) ----
  const leadGate = $('#modalLeadGate');
  $('#modalLeadGateOpen').addEventListener('click', () => {
    leadGate.innerHTML = `
      <form id="modalLeadForm" class="modal-lead-form" novalidate>
        <p class="modal-lead-form-hint">Me diga seu nome e WhatsApp que eu já te conecto com um corretor:</p>
        <input required id="mlf-nome" placeholder="Seu nome" autocomplete="name">
        <input required id="mlf-telefone" placeholder="Seu WhatsApp (com DDD)" autocomplete="tel" inputmode="tel">
        <button type="submit" class="btn btn-whatsapp btn-block">Continuar no WhatsApp</button>
      </form>
    `;
    $('#mlf-nome').focus();

    $('#modalLeadForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const nome = $('#mlf-nome').value.trim();
      const telefone = $('#mlf-telefone').value.trim();
      if (!nome || !telefone) return;

      const link = whatsappLink(`Olá! Meu nome é ${nome}. Tenho interesse no imóvel: ${imovel.titulo} (código ${imovel.codigo || imovel.id})`);
      // abre a nova aba já no clique (síncrono) pra não ser bloqueada como pop-up
      window.open(link, '_blank', 'noopener');

      supabase.from('leads').insert({
        nome,
        telefone,
        origem: 'site',
        interesse: imovel.finalidade === 'locacao' ? 'locacao' : 'compra',
        imovel_id: imovel.id,
        status: 'novo',
        observacoes: `Clicou em "Falar sobre este imóvel": ${imovel.titulo}${imovel.codigo ? ' (código ' + imovel.codigo + ')' : ''}`,
      }).then(({ error }) => { if (error) console.error(error); });

      trackEvent('generate_lead', { origem: 'pagina_imovel', imovel_id: imovel.id });
      trackMeta('Lead', { content_name: imovel.titulo });

      leadGate.innerHTML = `<p class="modal-lead-form-ok">✅ Prontinho! Abrimos o WhatsApp numa nova aba — se não abriu, <a href="${link}" target="_blank" rel="noopener">toque aqui</a>.</p>`;
    });
  });

  document.title = `${imovel.titulo} — Gregório | Meu Lar Imobiliária`;
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.content = (imovel.descricao || DEFAULT_DESCRIPTION).slice(0, 160);

  carregarImoveisSemelhantes(imovel);
}

// ---- imóveis semelhantes (mesma faixa de preço) — aparece abaixo, ao rolar a página ----
let observerSemelhantes = null;

async function carregarImoveisSemelhantes(imovel) {
  const section = $('#imovelSemelhantes');
  const grid = $('#imovelSemelhantesGrid');
  if (!section || !grid) return;
  section.hidden = true;
  section.classList.remove('in-view');
  grid.innerHTML = '';

  const ehLocacao = imovel.finalidade === 'locacao';
  const campoValor = ehLocacao ? 'valor_locacao' : 'valor_venda';
  const valorRef = Number(imovel[campoValor]) || Number(imovel.valor_venda) || Number(imovel.valor_locacao);
  if (!valorRef) return;

  const min = valorRef * 0.65;
  const max = valorRef * 1.35;
  const finalidadesAceitas = ehLocacao ? ['locacao', 'venda_locacao'] : ['venda', 'venda_locacao'];

  const { data, error } = await supabase
    .from('imoveis')
    .select('*')
    .eq('publicado', true)
    .neq('id', imovel.id)
    .in('finalidade', finalidadesAceitas)
    .gte(campoValor, min)
    .lte(campoValor, max)
    .limit(24);

  if (error) { console.error(error); return; }
  if (!data || !data.length) return;

  const sugeridos = data
    .map((item) => ({ item, diff: Math.abs(Number(item[campoValor]) - valorRef) }))
    .sort((a, b) => a.diff - b.diff)
    .slice(0, 4)
    .map((x) => x.item);

  if (!sugeridos.length) return;

  renderGrid(grid, sugeridos);
  section.hidden = false;

  if (observerSemelhantes) observerSemelhantes.disconnect();
  observerSemelhantes = new IntersectionObserver((entries) => {
    entries.forEach((entry) => { if (entry.isIntersecting) section.classList.add('in-view'); });
  }, { threshold: 0.15 });
  observerSemelhantes.observe(section);
}

function showImovelPage(imovel) {
  $('#siteHome').hidden = true;
  $('#empreendimentoPage').hidden = true;
  $('#imovelPage').hidden = false;
  renderImovelPage(imovel);
  window.scrollTo(0, 0);
}

function showSiteHome() {
  $('#imovelPage').hidden = true;
  $('#empreendimentoPage').hidden = true;
  $('#siteHome').hidden = false;
  document.title = DEFAULT_TITLE;
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.content = DEFAULT_DESCRIPTION;
}

function showEmpreendimentoPage(unidades) {
  $('#siteHome').hidden = true;
  $('#imovelPage').hidden = true;
  $('#empreendimentoPage').hidden = false;
  renderEmpreendimentoPage(unidades);
  window.scrollTo(0, 0);
}

function renderEmpreendimentoPage(unidades) {
  const ordenadas = unidades.slice().sort((a, b) => (Number(a.valor_venda) || Infinity) - (Number(b.valor_venda) || Infinity));
  const representante = ordenadas[0];
  const fotos = allPhotos(representante);
  const foto = fotos[0] || null;
  const nome = nomeEmpreendimento(representante);

  document.title = `${nome} — Gregório | Meu Lar Imóveis`;
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc && representante.descricao) metaDesc.content = representante.descricao.slice(0, 160);

  $('#empreendimentoHero').innerHTML = `
    ${foto ? `<img src="${foto}" alt="${nome}">` : '🏠'}
    <div class="imovel-hero-fade"></div>
    <span class="badge imovel-hero-badge">🏗️ Lançamento</span>
  `;

  $('#empreendimentoMain').innerHTML = `
    <p class="eyebrow">${[representante.bairro, representante.cidade].filter(Boolean).join(' — ')}</p>
    <h1>${nome}</h1>
    ${representante.descricao ? `<p style="white-space:pre-line">${representante.descricao}</p>` : ''}
  `;

  const grid = $('#empreendimentoUnidadesGrid');
  grid.innerHTML = '';
  agruparPorTipologia(ordenadas).forEach(({ representante, unidades: lista }) => {
    const precosDiferentes = new Set(lista.map((x) => x.valor_venda)).size > 1;
    const precoTexto = precosDiferentes ? `A partir de ${priceLabel(representante)}` : priceLabel(representante);
    const card = document.createElement('article');
    card.className = 'property-card';
    card.addEventListener('click', () => {
      navigateToImovel(representante);
      supabase.rpc('incrementar_visualizacao_imovel', { p_imovel_id: representante.id }).then(({ error }) => { if (error) console.error(error); });
    });
    card.innerHTML = `
      <div class="property-body">
        <div class="property-price">${precoTexto}</div>
        <div class="property-title">${tipologiaLabel(representante)}</div>
        <div class="property-specs">
          ${representante.quartos ? `<span>🛏 ${representante.quartos}</span>` : ''}
          ${representante.banheiros ? `<span>🚿 ${representante.banheiros}</span>` : ''}
          ${representante.vagas_garagem ? `<span>🚗 ${representante.vagas_garagem}</span>` : ''}
          ${representante.area_construida ? `<span>📐 ${representante.area_construida}m²</span>` : ''}
          <span>🏘 ${lista.length} unidade${lista.length > 1 ? 's' : ''} disponíve${lista.length > 1 ? 'is' : 'l'}</span>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

// Várias unidades com a mesma área/planta (Tipo A, Tipo B...) viram UM card só na
// subpágina do empreendimento — mostra "a partir de" quando o preço varia entre elas.
function agruparPorTipologia(unidades) {
  const grupos = new Map();
  unidades.forEach((u) => {
    const chave = u.area_construida || u.titulo;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(u);
  });
  return Array.from(grupos.values()).map((lista) => {
    const ordenado = lista.slice().sort((a, b) => (Number(a.valor_venda) || Infinity) - (Number(b.valor_venda) || Infinity));
    return { representante: ordenado[0], unidades: lista };
  });
}

function tipologiaLabel(u) {
  const m = (u.titulo || '').match(/Tipo (\w+)/i);
  if (m) return `Tipo ${m[1]}`;
  return (u.titulo || '').split(' — ')[1] || u.titulo;
}

function navigateToEmpreendimento(grupoCodigo, nome) {
  history.pushState({ grupoCodigo }, '', empreendimentoUrl(grupoCodigo, nome));
  fetchEmpreendimento(grupoCodigo).then((unidades) => { if (unidades.length) showEmpreendimentoPage(unidades); });
}

$('#empreendimentoBack').addEventListener('click', () => {
  if (history.state && history.state.grupoCodigo) history.back();
  else { history.pushState({}, '', '/'); showSiteHome(); }
});

function navigateToImovel(imovel) {
  history.pushState({ imovelId: imovel.id }, '', imovelUrl(imovel));
  showImovelPage(imovel);
}

$('#imovelBack').addEventListener('click', () => {
  if (history.state && history.state.imovelId) history.back();
  else { history.pushState({}, '', '/'); showSiteHome(); }
});

window.addEventListener('popstate', () => {
  const grupoCodigo = grupoFromPath(location.pathname);
  if (grupoCodigo) {
    fetchEmpreendimento(grupoCodigo).then((unidades) => { if (unidades.length) showEmpreendimentoPage(unidades); else showSiteHome(); });
    return;
  }
  const id = imovelIdFromPath(location.pathname);
  if (id) {
    fetchImovelById(id).then((imovel) => { if (imovel) showImovelPage(imovel); else showSiteHome(); });
  } else {
    showSiteHome();
  }
});

// Se o link foi aberto direto numa URL /imovel/... ou /lancamento/..., já abre a página certa
(function initRotaImovel() {
  const grupoCodigo = grupoFromPath(location.pathname);
  if (grupoCodigo) {
    fetchEmpreendimento(grupoCodigo).then((unidades) => { if (unidades.length) showEmpreendimentoPage(unidades); });
    return;
  }
  const id = imovelIdFromPath(location.pathname);
  if (!id) return;
  fetchImovelById(id).then((imovel) => { if (imovel) showImovelPage(imovel); });
})();

// =====================================================================
// BUSCA: DESTAQUES
// =====================================================================
async function loadDestaques() {
  const grid = $('#destaquesGrid');
  const { data, error } = await supabase
    .from('imoveis')
    .select('*')
    .eq('publicado', true)
    .eq('destaque', true)
    .order('criado_em', { ascending: false })
    .limit(6);

  if (error) { console.error(error); grid.innerHTML = '<p class="empty-state">Não foi possível carregar os destaques agora.</p>'; return; }
  renderGrid(grid, data);
}

// =====================================================================
// BUSCA: LISTAGEM COMPLETA (com filtros)
// =====================================================================
// Busca "por palavras": cada palavra digitada precisa aparecer em algum lugar (título, bairro,
// cidade ou endereço) — em qualquer ordem, não precisa ser a frase exata. Cada .or() do Supabase
// soma um "E" na consulta (dentro do .or() é "OU" entre as colunas daquela palavra).
function aplicarBuscaTexto(query, termoBusca) {
  const palavras = (termoBusca || '').trim().split(/\s+/).filter(Boolean);
  palavras.forEach((p) => {
    const escapado = p.replace(/[%,]/g, '');
    if (!escapado) return;
    query = query.or(`titulo.ilike.%${escapado}%,bairro.ilike.%${escapado}%,cidade.ilike.%${escapado}%,endereco.ilike.%${escapado}%`);
  });
  return query;
}

async function loadListagem(filters = {}) {
  const grid = $('#listagemGrid');
  const emptyEl = $('#emptyState');

  let query = supabase.from('imoveis').select('*').eq('publicado', true);

  if (filters.finalidade) query = query.in('finalidade', [filters.finalidade, 'venda_locacao']);
  if (filters.tipo) query = query.eq('tipo', filters.tipo);
  if (filters.cidade) query = query.ilike('cidade', filters.cidade);
  if (filters.quartos) query = query.gte('quartos', Number(filters.quartos));
  if (filters.precoMin) query = query.or(`valor_venda.gte.${filters.precoMin},valor_locacao.gte.${filters.precoMin}`);
  if (filters.precoMax) query = query.or(`valor_venda.lte.${filters.precoMax},valor_locacao.lte.${filters.precoMax}`);
  if (filters.busca) query = aplicarBuscaTexto(query, filters.busca);
  else if (filters.bairro) query = query.or(`bairro.ilike.%${filters.bairro}%,cidade.ilike.%${filters.bairro}%`);
  if (filters.mcmv) query = query.eq('elegivel_mcmv', true);
  if (filters.luxo) query = query.eq('imovel_luxo', true);
  if (filters.lancamento) query = query.eq('situacao', 'lancamento');

  query = query.order('criado_em', { ascending: false }).limit(60);

  const { data, error } = await query;
  if (error) { console.error(error); grid.innerHTML = ''; emptyEl.hidden = false; emptyEl.textContent = 'Não foi possível carregar os imóveis agora.'; return; }
  renderGrid(grid, data, emptyEl);
}

function currentListFilters() {
  return {
    busca: $('#lf-busca').value,
    finalidade: $('#lf-finalidade').value,
    tipo: $('#lf-tipo').value,
    cidade: $('#lf-cidade').value,
    quartos: $('#lf-quartos').value,
    precoMin: $('#lf-preco-min').value,
    precoMax: $('#lf-preco-max').value,
    mcmv: $('#lf-mcmv').checked,
    luxo: $('#lf-luxo').checked,
    lancamento: $('#lf-lancamento').checked,
  };
}

['#lf-finalidade', '#lf-tipo', '#lf-cidade', '#lf-quartos', '#lf-mcmv', '#lf-luxo', '#lf-lancamento'].forEach((sel) => {
  $(sel).addEventListener('change', () => loadListagem(currentListFilters()));
});

let debounceLfBusca;
$('#lf-busca').addEventListener('input', () => {
  clearTimeout(debounceLfBusca);
  debounceLfBusca = setTimeout(() => loadListagem(currentListFilters()), 350);
});

let debounceLfPreco;
['#lf-preco-min', '#lf-preco-max'].forEach((sel) => {
  $(sel).addEventListener('input', () => {
    clearTimeout(debounceLfPreco);
    debounceLfPreco = setTimeout(() => loadListagem(currentListFilters()), 500);
  });
});

$('#clearFilters').addEventListener('click', () => {
  $('#lf-finalidade').value = '';
  $('#lf-tipo').value = '';
  $('#lf-cidade').value = '';
  $('#lf-quartos').value = '';
  $('#lf-preco-min').value = '';
  $('#lf-preco-max').value = '';
  $('#lf-busca').value = '';
  $('#lf-mcmv').checked = false;
  $('#lf-luxo').checked = false;
  $('#lf-lancamento').checked = false;
  loadListagem();
});

// =====================================================================
// HERO: imagem de fundo — usa fotos cadastradas no CRM; se não houver
// nenhuma, cai nas ilustrações padrão
// =====================================================================
const HERO_FALLBACK = [
  'assets/hero/hero-1.svg',
  'assets/hero/hero-2.svg',
  'assets/hero/hero-3.svg',
  'assets/hero/hero-4.svg',
];

async function initHero() {
  const heroPhotoEl = $('#heroPhoto');
  if (!heroPhotoEl) return;

  let imagens = HERO_FALLBACK;
  try {
    const { data } = await supabase.from('hero_imagens').select('url').eq('ativo', true);
    if (data && data.length) imagens = data.map((h) => h.url);
  } catch { /* usa fallback */ }

  const escolhida = imagens[Math.floor(Math.random() * imagens.length)];
  heroPhotoEl.style.backgroundImage = `url('${escolhida}')`;
}
initHero();

// =====================================================================
// EQUIPE (busca do banco — editável pelo CRM)
// =====================================================================
async function loadEquipe() {
  const grid = $('#equipeGrid');
  if (!grid) return;
  const { data, error } = await supabase.from('equipe_publica').select('*').order('nome');

  if (error || !data?.length) { grid.innerHTML = ''; return; }

  grid.innerHTML = data.map((u) => {
    const iniciais = (u.nome || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
    const cargoLabel = { admin: 'Administração', gerente: 'Gerente', corretor: 'Corretor', atendente: 'Atendente' }[u.cargo] || u.cargo;
    return `
      <div class="team-card">
        <div class="team-avatar">
          ${u.foto_url ? `<img src="${u.foto_url}" alt="${u.nome}">` : `<span class="team-initials">${iniciais}</span>`}
        </div>
        <h3>${u.nome}</h3>
        <p class="team-role">${cargoLabel}</p>
      </div>
    `;
  }).join('');
}
loadEquipe();

// =====================================================================
// DEPOIMENTOS (busca do banco — editável pelo CRM)
// =====================================================================
async function loadDepoimentosPublicos() {
  const grid = $('#depoimentosGrid');
  if (!grid) return;
  const { data, error } = await supabase.from('depoimentos').select('*').eq('publicado', true).order('ordem').limit(9);

  if (error || !data?.length) {
    grid.innerHTML = '<p class="empty-state">Em breve, depoimentos de quem já negociou com a gente.</p>';
    return;
  }

  grid.innerHTML = data.map((d) => `
    <div class="testimonial-card">
      <div class="testimonial-stars">${'★'.repeat(d.nota)}${'☆'.repeat(5 - d.nota)}</div>
      <p class="testimonial-text">"${d.texto}"</p>
      <p class="testimonial-author">
        ${d.foto_url ? `<img class="testimonial-avatar" src="${d.foto_url}" alt="${d.nome_cliente}">` : ''}
        — ${d.nome_cliente}
      </p>
    </div>
  `).join('');
}
loadDepoimentosPublicos();

// =====================================================================
// ABAS COMPRAR / ALUGAR (Home)
// =====================================================================
const searchSubmitBtn = $('#searchForm button[type="submit"]');

function setSearchTab(finalidade) {
  $('#f-finalidade').value = finalidade;
  $$('.search-tab').forEach((tab) => {
    const active = tab.dataset.finalidade === finalidade;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  if (searchSubmitBtn) {
    searchSubmitBtn.textContent = finalidade === 'locacao' ? 'Buscar para alugar' : 'Buscar para comprar';
  }
}

$$('.search-tab').forEach((tab) => {
  tab.addEventListener('click', () => setSearchTab(tab.dataset.finalidade));
});

setSearchTab('venda');

// =====================================================================
// BUSCA DO HERO -> aplica filtros na listagem e rola até lá
// =====================================================================
$('#searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const finalidade = $('#f-finalidade').value;
  const tipo = $('#f-tipo').value;
  const busca = $('#f-bairro').value;

  $('#lf-finalidade').value = finalidade;
  $('#lf-tipo').value = tipo;
  $('#lf-busca').value = busca;

  loadListagem({ finalidade, tipo, busca });
  $('#imoveis').scrollIntoView({ behavior: 'smooth' });
});

// Atalho "Alugar" nas tags do hero já abre a busca na aba de locação
$('.hero-tags')?.querySelectorAll('a').forEach((tagEl) => {
  if (tagEl.getAttribute('href') === '#alugar') {
    tagEl.addEventListener('click', () => setSearchTab('locacao'));
  }
});

// Cards de categoria também pré-aplicam filtro
$$('.cat-card').forEach((card) => {
  card.addEventListener('click', (e) => {
    const finalidade = card.dataset.finalidade;
    const tipo = card.dataset.tipo;
    const luxo = card.dataset.luxo;
    const lancamento = card.dataset.lancamento;
    if (finalidade) $('#lf-finalidade').value = finalidade;
    if (tipo) $('#lf-tipo').value = tipo;
    if (luxo) $('#lf-luxo').checked = true;
    if (lancamento) $('#lf-lancamento').checked = true;
    setTimeout(() => loadListagem(currentListFilters()), 50);
  });
});

// Menu superior (Comprar / Alugar / Terrenos / Alto padrão / Lançamentos) também aplica o
// filtro certo no catálogo completo e rola até lá — antes só mudava a URL e
// não filtrava nada.
$$('[data-nav-finalidade], [data-nav-tipo], [data-nav-luxo], [data-nav-lancamento]').forEach((link) => {
  link.addEventListener('click', () => {
    $('#lf-finalidade').value = '';
    $('#lf-tipo').value = '';
    $('#lf-mcmv').checked = false;
    $('#lf-luxo').checked = false;
    $('#lf-lancamento').checked = false;

    if (link.dataset.navFinalidade) $('#lf-finalidade').value = link.dataset.navFinalidade;
    if (link.dataset.navTipo) $('#lf-tipo').value = link.dataset.navTipo;
    if (link.dataset.navLuxo) $('#lf-luxo').checked = true;
    if (link.dataset.navLancamento) $('#lf-lancamento').checked = true;

    loadListagem(currentListFilters());
  });
});

// =====================================================================
// FORMULÁRIO DE LEAD
// =====================================================================
$('#leadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#leadSubmit');
  const feedback = $('#formFeedback');

  const payload = {
    nome: $('#l-nome').value.trim(),
    telefone: $('#l-telefone').value.trim(),
    email: $('#l-email').value.trim() || null,
    interesse: $('#l-interesse').value,
    observacoes: $('#l-obs').value.trim() || null,
    origem: 'site',
    status: 'novo',
  };

  if (!payload.nome || !payload.telefone) return;

  btn.disabled = true;
  btn.textContent = 'Enviando...';
  feedback.hidden = true;

  const { error } = await supabase.from('leads').insert(payload);

  btn.disabled = false;
  btn.textContent = 'Enviar e falar com um corretor';

  if (error) {
    console.error(error);
    feedback.className = 'form-feedback err';
    feedback.textContent = 'Não foi possível enviar agora. Tente novamente ou chame no WhatsApp.';
    feedback.hidden = false;
    return;
  }

  feedback.className = 'form-feedback ok';
  feedback.textContent = 'Recebemos seu contato! Um corretor vai falar com você em breve.';
  feedback.hidden = false;
  e.target.reset();

  // conversão: lead cadastrado com sucesso
  trackEvent('generate_lead', { interesse: payload.interesse });
  trackMeta('Lead', { content_name: payload.interesse });
});

// =====================================================================
// SIMULADOR DE FINANCIAMENTO (Tabela Price)
// =====================================================================
$('#simuladorForm')?.addEventListener('submit', (e) => {
  e.preventDefault();

  const valorImovel = Number($('#sim-valor').value);
  const entrada = Number($('#sim-entrada').value);
  const taxaAnual = Number($('#sim-taxa').value);
  const prazoAnos = Number($('#sim-prazo').value);

  const financiado = Math.max(valorImovel - entrada, 0);
  const n = prazoAnos * 12;
  const iMensal = Math.pow(1 + taxaAnual / 100, 1 / 12) - 1;

  let parcela;
  if (iMensal === 0) {
    parcela = financiado / n;
  } else {
    parcela = financiado * (iMensal * Math.pow(1 + iMensal, n)) / (Math.pow(1 + iMensal, n) - 1);
  }

  const totalPago = parcela * n;
  const totalJuros = totalPago - financiado;

  $('#resParcela').textContent = formatMoney(parcela);
  $('#resFinanciado').textContent = formatMoney(financiado);
  $('#resTotal').textContent = formatMoney(totalPago);
  $('#resJuros').textContent = formatMoney(totalJuros);
  $('#simuladorResult').hidden = false;

  // sinal de intenção de compra (não é lead ainda, mas ajuda a segmentar público de anúncio)
  trackEvent('usou_simulador_financiamento', { valor_imovel: valorImovel });
  trackMeta('InitiateCheckout', { value: valorImovel, currency: 'BRL' });
});
$('#navWhatsapp').href = whatsappLink();
$('#contactWhatsapp').href = whatsappLink();
$('#floatWhatsapp').href = whatsappLink();

$('#navToggle').addEventListener('click', () => {
  $('#mainNav').classList.toggle('open');
});
// Fecha o menu mobile ao escolher um link (ex: "Alugar") ou ao tocar fora dele.
$('#mainNav').querySelectorAll('a').forEach((a) => {
  a.addEventListener('click', () => $('#mainNav').classList.remove('open'));
});
document.addEventListener('click', (e) => {
  if (!$('#mainNav').contains(e.target) && !$('#navToggle').contains(e.target)) {
    $('#mainNav').classList.remove('open');
  }
});

// =====================================================================
// MENU "ÁREA DO CLIENTE" (portais + CRM)
// =====================================================================
$('#accessToggle').addEventListener('click', (e) => {
  e.stopPropagation();
  const dropdown = $('#accessDropdown');
  const isOpen = dropdown.classList.toggle('open');
  $('#accessToggle').setAttribute('aria-expanded', isOpen ? 'true' : 'false');
});
document.addEventListener('click', (e) => {
  if (!$('#accessMenu').contains(e.target)) {
    $('#accessDropdown').classList.remove('open');
    $('#accessToggle').setAttribute('aria-expanded', 'false');
  }
});

$('#year').textContent = new Date().getFullYear();

// =====================================================================
// INIT
// =====================================================================
loadDestaques();
loadListagem();

// ---- Momentos: fotos reais de assinatura de contrato e entrega de chaves ----
async function loadMomentos() {
  const track = $('#momentosTrack');
  const secao = $('#momentos');
  if (!track || !secao) return;
  const { data, error } = await supabase.from('entregas_chaves').select('*').eq('publicado', true).order('ordem');
  if (error) { console.error(error); return; }
  if (!data || !data.length) return; // mantém a seção escondida se não houver fotos
  track.innerHTML = data.map((m) => `
    <div class="momento-card">
      <img src="${m.foto_url}" alt="${m.tipo === 'entrega_chaves' ? 'Entrega de chaves — cliente Gregório | Meu Lar' : 'Assinatura de contrato — cliente Gregório | Meu Lar'}" loading="lazy">
    </div>
  `).join('');
  secao.hidden = false;
}
loadMomentos();
$('#momentosPrev')?.addEventListener('click', () => $('#momentosTrack').scrollBy({ left: -280, behavior: 'smooth' }));
$('#momentosNext')?.addEventListener('click', () => $('#momentosTrack').scrollBy({ left: 280, behavior: 'smooth' }));

// =====================================================================
// CONTEÚDO DO SITE (sobre, alugar/vender, rodapé, redes sociais)
// vem do banco (tabela config_site) — editável pelo gerente/admin no CRM
// =====================================================================
const ICONES_SOCIAL = {
  instagram: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2.2c3.2 0 3.58.01 4.85.07 1.17.05 1.97.24 2.43.4a4.9 4.9 0 0 1 1.77 1.15 4.9 4.9 0 0 1 1.15 1.77c.16.46.35 1.26.4 2.43.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.24 1.97-.4 2.43a4.9 4.9 0 0 1-1.15 1.77 4.9 4.9 0 0 1-1.77 1.15c-.46.16-1.26.35-2.43.4-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.97-.24-2.43-.4a4.9 4.9 0 0 1-1.77-1.15 4.9 4.9 0 0 1-1.15-1.77c-.16-.46-.35-1.26-.4-2.43C2.21 15.58 2.2 15.2 2.2 12s.01-3.58.07-4.85c.05-1.17.24-1.97.4-2.43a4.9 4.9 0 0 1 1.15-1.77A4.9 4.9 0 0 1 5.59 1.8c.46-.16 1.26-.35 2.43-.4C9.29 1.34 9.67 1.33 12 1.33m0 1.87c-3.15 0-3.5.01-4.74.07-.96.04-1.48.2-1.82.34-.46.18-.78.39-1.13.73a3.02 3.02 0 0 0-.73 1.13c-.14.34-.3.86-.34 1.82-.06 1.24-.07 1.59-.07 4.74s.01 3.5.07 4.74c.04.96.2 1.48.34 1.82.18.46.39.78.73 1.13.35.34.67.55 1.13.73.34.14.86.3 1.82.34 1.24.06 1.59.07 4.74.07s3.5-.01 4.74-.07c.96-.04 1.48-.2 1.82-.34.46-.18.78-.39 1.13-.73.34-.35.55-.67.73-1.13.14-.34.3-.86.34-1.82.06-1.24.07-1.59.07-4.74s-.01-3.5-.07-4.74c-.04-.96-.2-1.48-.34-1.82a3.02 3.02 0 0 0-.73-1.13 3.02 3.02 0 0 0-1.13-.73c-.34-.14-.86-.3-1.82-.34-1.24-.06-1.59-.07-4.74-.07Zm0 3.18a5.75 5.75 0 1 1 0 11.5 5.75 5.75 0 0 1 0-11.5Zm0 1.87a3.88 3.88 0 1 0 0 7.76 3.88 3.88 0 0 0 0-7.76Zm5.98-2.07a1.34 1.34 0 1 1-2.69 0 1.34 1.34 0 0 1 2.69 0Z"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M13.5 21.9v-8.4h2.82l.42-3.28H13.5V8.1c0-.95.26-1.6 1.63-1.6h1.74V3.6A23 23 0 0 0 14.4 3.5c-2.5 0-4.2 1.52-4.2 4.32v2.4H7.36v3.28h2.84v8.4h3.3Z"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M17.6 6.32A7.85 7.85 0 0 0 12.05 4a7.94 7.94 0 0 0-6.9 11.9L4 20l4.2-1.1a7.9 7.9 0 0 0 3.85 1h.01a7.94 7.94 0 0 0 5.54-13.58ZM12.06 18.4a6.57 6.57 0 0 1-3.36-.92l-.24-.14-2.5.66.67-2.44-.16-.25a6.6 6.6 0 1 1 12.24-3.5 6.56 6.56 0 0 1-6.65 6.59Zm3.6-4.93c-.2-.1-1.17-.58-1.35-.64s-.31-.1-.44.1-.51.64-.62.77-.23.15-.42.05a5.4 5.4 0 0 1-1.6-.99 6 6 0 0 1-1.1-1.37c-.12-.2 0-.3.09-.4.1-.1.2-.24.3-.36a1.4 1.4 0 0 0 .2-.34.37.37 0 0 0 0-.35c-.05-.1-.44-1.06-.6-1.45-.16-.38-.32-.33-.44-.34h-.38a.72.72 0 0 0-.52.24 2.2 2.2 0 0 0-.68 1.63 3.8 3.8 0 0 0 .8 2.02 8.7 8.7 0 0 0 3.34 2.96c.47.2.83.32 1.12.42.47.15.9.13 1.24.08.38-.06 1.17-.48 1.34-.94s.17-.86.12-.94-.18-.13-.38-.23Z"/></svg>',
  youtube: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M23.5 6.2a3.02 3.02 0 0 0-2.12-2.14C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.38.56A3.02 3.02 0 0 0 .5 6.2 31.6 31.6 0 0 0 0 12a31.6 31.6 0 0 0 .5 5.8 3.02 3.02 0 0 0 2.12 2.14C4.5 20.5 12 20.5 12 20.5s7.5 0 9.38-.56a3.02 3.02 0 0 0 2.12-2.14A31.6 31.6 0 0 0 24 12a31.6 31.6 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.27 3.6-6.27 3.6Z"/></svg>',
};

function paragrafosHtml(texto) {
  if (!texto) return '';
  return texto.split(/\n\s*\n/).map((p) => `<p>${p.trim().replace(/\n/g, '<br>')}</p>`).join('');
}

function formatarTelefoneBr(tel) {
  // espera algo como 5541995476193 (DDI 2 + DDD 2 + número)
  if (!tel || tel.length < 12) return tel || '';
  const ddd = tel.slice(2, 4);
  const resto = tel.slice(4);
  const meio = resto.slice(0, resto.length - 4);
  const fim = resto.slice(-4);
  return `(${ddd}) ${meio}-${fim}`;
}

async function carregarConfigSite() {
  const { data, error } = await supabase.from('config_site').select('*').eq('id', 1).maybeSingle();
  if (error || !data) { console.error(error); return; }

  // ---- Sobre ----
  $('#sobreTexto').innerHTML = paragrafosHtml(data.sobre_nos_texto);
  if (data.rodape_descricao) $('#sobreCardDescricao').textContent = data.rodape_descricao;
  if (data.whatsapp_telefone) {
    $('#sobreCardWhatsapp').textContent = formatarTelefoneBr(data.whatsapp_telefone);
    $('#sobreCardWhatsapp').href = `https://wa.me/${data.whatsapp_telefone}`;
  }
  if (data.horario_funcionamento) $('#sobreCardHorario').textContent = '🕒 ' + data.horario_funcionamento;
  if (data.email) {
    $('#sobreCardEmail').textContent = data.email;
    $('#sobreCardEmail').href = `mailto:${data.email}`;
  }

  // ---- Alugar ou vender meu imóvel ----
  $('#anuncieTexto').innerHTML = paragrafosHtml(data.alugar_vender_texto);
  $('#anuncieServicos').innerHTML = (data.alugar_vender_servicos || []).map((s) => `<li>✅ ${s}</li>`).join('');
  $('#anuncieFechamento').textContent = data.alugar_vender_fechamento || '';
  $('#anuncieWhatsapp').href = whatsappLink('Olá! Tenho um imóvel e gostaria de saber mais sobre alugar ou vender com a Gregório | Meu Lar.');

  // ---- Rodapé ----
  if (data.rodape_descricao) $('#footerDescricao').textContent = data.rodape_descricao;
  if (data.whatsapp_telefone) {
    $('#footerWhatsapp').textContent = formatarTelefoneBr(data.whatsapp_telefone);
    $('#footerWhatsapp').href = `https://wa.me/${data.whatsapp_telefone}`;
  }
  if (data.whatsapp_secundario) {
    $('#footerWhatsappSecundario').textContent = formatarTelefoneBr(data.whatsapp_secundario);
    $('#footerWhatsappSecundario').href = `https://wa.me/${data.whatsapp_secundario}`;
    $('#footerWhatsappSecundarioWrap').hidden = false;
  }
  if (data.telefone_fixo) {
    $('#footerTelefoneFixo').textContent = formatarTelefoneBr(data.telefone_fixo);
    $('#footerTelefoneFixo').href = `tel:+${data.telefone_fixo}`;
    $('#footerTelefoneFixoWrap').hidden = false;
  }
  if (data.email) {
    $('#footerEmail').textContent = data.email;
    $('#footerEmail').href = `mailto:${data.email}`;
  }
  if (data.creci) $('#footerCreci').textContent = data.creci;

  // ---- Redes sociais ----
  const redes = [
    { chave: 'instagram', url: data.instagram_url, label: 'Instagram' },
    { chave: 'facebook', url: data.facebook_url, label: 'Facebook' },
    { chave: 'whatsapp', url: data.whatsapp_url, label: 'WhatsApp' },
    { chave: 'youtube', url: data.youtube_url, label: 'YouTube' },
  ].filter((r) => r.url);

  $('#footerSocial').innerHTML = redes.map((r) => `
    <a href="${r.url}" target="_blank" rel="noopener" class="social-icon" aria-label="${r.label}">${ICONES_SOCIAL[r.chave]}</a>
  `).join('');
}
carregarConfigSite();
