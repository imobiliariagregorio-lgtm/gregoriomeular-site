
const $ = (sel) => document.querySelector(sel);
const fmtMoney = (v) => (v === null || v === undefined) ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtMonth = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '—';

const STATUS_LABEL = { pago: 'Pago', pendente: 'Pendente', atrasado: 'Atrasado', cancelado: 'Cancelado' };

document.getElementById('year') && (document.getElementById('year').textContent = new Date().getFullYear());

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    await carregarPessoaEDashboard(session);
  }
}

async function carregarPessoaEDashboard(session) {
  const { data: pessoas, error } = await supabase
    .from('pessoas')
    .select('*')
    .eq('auth_user_id', session.user.id);

  const proprietarios = (pessoas || []).filter((p) => (p.papeis || []).includes('proprietario'));

  if (error || !proprietarios.length) {
    mostrarErroLogin('Este login não está liberado para o Portal do Proprietário. Fale com seu corretor.');
    await supabase.auth.signOut();
    return;
  }

  $('#loginWrap').hidden = true;
  $('#dashboard').hidden = false;
  // Um mesmo login pode reunir mais de uma pessoa (ex: mãe e filha donas de imóveis em conjunto) —
  // mostra os dois nomes quando for o caso.
  $('#ownerName').textContent = proprietarios.map((p) => p.nome).join(' & ');

  const pessoaIds = proprietarios.map((p) => p.id);
  await Promise.all([carregarImoveis(proprietarios), carregarRepasses(proprietarios), montarSecaoIR(proprietarios)]);
}

// ==== Relatório de Imposto de Renda — só liberado dentro do prazo configurado pelo Gregório ====
async function montarSecaoIR(proprietarios) {
  const wrap = $('#irStatusWrap');
  const pessoaIds = proprietarios.map((p) => p.id);
  const anoAnterior = new Date().getFullYear() - 1;

  const { data: config } = await supabase.from('config_site').select('ir_declaracao_inicio, ir_declaracao_fim, razao_social, cnpj').eq('id', 1).maybeSingle();
  const hoje = new Date().toISOString().slice(0, 10);
  const dentroDoPrazo = config?.ir_declaracao_inicio && config?.ir_declaracao_fim && hoje >= config.ir_declaracao_inicio && hoje <= config.ir_declaracao_fim;

  if (!dentroDoPrazo) {
    const fmtData = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
    wrap.innerHTML = `<div><strong>Ainda não disponível.</strong><span class="portal-item-sub">O relatório do ano de ${anoAnterior} fica disponível para download de ${fmtData(config?.ir_declaracao_inicio)} a ${fmtData(config?.ir_declaracao_fim)} — o período em que a Receita Federal recebe a declaração do Imposto de Renda.</span></div>`;
    return;
  }

  wrap.innerHTML = `<div><strong>Relatório do ano de ${anoAnterior} disponível.</strong><span class="portal-item-sub">Traz o total repassado a você em todos os 12 meses de ${anoAnterior}, para declarar no Imposto de Renda.</span></div><button class="btn btn-primary btn-sm" id="irGerarProprioBtn">Gerar relatório de ${anoAnterior}</button>`;

  $('#irGerarProprioBtn').addEventListener('click', async () => {
    const btn = $('#irGerarProprioBtn');
    btn.disabled = true;
    btn.textContent = 'Gerando...';

    const dataInicio = `${anoAnterior}-01-01`;
    const dataFim = `${anoAnterior}-12-31`;

    const { data: contratos } = await supabase
      .from('contratos')
      .select('id, vendedor_locador_id, imoveis(titulo, endereco)')
      .in('vendedor_locador_id', pessoaIds)
      .eq('tipo', 'locacao');

    const nomeporId = Object.fromEntries(proprietarios.map((p) => [p.id, p.nome]));
    let totalGeral = 0;
    const blocos = [];

    for (const contrato of (contratos || [])) {
      const { data: cobrancas } = await supabase
        .from('cobrancas')
        .select('referencia, valor_base, cobranca_ajustes(*)')
        .eq('contrato_id', contrato.id)
        .gte('referencia', dataInicio)
        .lte('referencia', dataFim)
        .order('referencia');

      if (!cobrancas || !cobrancas.length) continue;

      const { data: contratoCompleto } = await supabase.from('contratos').select('taxa_administracao_percentual').eq('id', contrato.id).maybeSingle();
      const taxa = Number(contratoCompleto?.taxa_administracao_percentual || 0);

      let totalImovel = 0;
      const nomesMesesAbrev = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
      const linhas = cobrancas.map((cb) => {
        const bruto = Number(cb.valor_base || 0);
        let ajusteProprietario = 0;
        (cb.cobranca_ajustes || []).forEach((a) => {
          const v = Number(a.valor) || 0;
          if (a.tipo === 'acrescimo' && a.destino === 'proprietario') ajusteProprietario += v;
          if (a.tipo === 'desconto' && a.destino === 'proprietario') ajusteProprietario += v;
          if (a.tipo === 'desconto' && a.origem === 'proprietario') ajusteProprietario -= v;
        });
        const liquido = bruto * (1 - taxa / 100) + ajusteProprietario;
        totalImovel += liquido;
        totalGeral += liquido;
        const [ay, am] = cb.referencia.split('-');
        return `<tr><td>${nomesMesesAbrev[Number(am)]}/${ay}</td><td>${fmtMoney(liquido)}</td></tr>`;
      }).join('');

      blocos.push(`
        <div style="margin-top:14px;">
          <p style="font-weight:700;margin:0 0 4px;">${nomeporId[contrato.vendedor_locador_id] ? nomeporId[contrato.vendedor_locador_id] + ' — ' : ''}${contrato.imoveis?.titulo || 'Imóvel'} ${contrato.imoveis?.endereco ? '(' + contrato.imoveis.endereco + ')' : ''}</p>
          <table class="portal-table"><thead><tr><th>Mês</th><th>Repassado</th></tr></thead><tbody>${linhas}</tbody></table>
          <p style="text-align:right;font-weight:700;">Subtotal: ${fmtMoney(totalImovel)}</p>
        </div>
      `);
    }

    const janela = window.open('', '_blank');
    janela.document.write(`
      <html><head><title>Relatório IR ${anoAnterior}</title><link rel="stylesheet" href="css/style.css"></head>
      <body style="padding:24px;font-family:sans-serif;">
        <div style="text-align:center;margin-bottom:20px;">
          <h2>${config?.razao_social || 'Gregório | Meu Lar Imóveis'}</h2>
          <p>CNPJ: ${config?.cnpj || '—'}</p>
          <h3>Relatório de repasses para fins de Imposto de Renda</h3>
          <p>Proprietário(s): <strong>${proprietarios.map((p) => p.nome).join(' e ')}</strong></p>
          <p>Ano-calendário: ${anoAnterior} (janeiro a dezembro)</p>
        </div>
        ${blocos.join('')}
        <h2 style="text-align:right;margin-top:20px;border-top:2px solid #0F2747;padding-top:10px;">Total repassado em ${anoAnterior}: ${fmtMoney(totalGeral)}</h2>
        <p style="font-size:.75rem;color:#666;margin-top:16px;">Relatório gerado automaticamente. Não substitui orientação de um contador.</p>
      </body></html>
    `);
    janela.document.close();
    janela.focus();
    setTimeout(() => janela.print(), 300);

    btn.disabled = false;
    btn.textContent = `Gerar relatório de ${anoAnterior}`;
  });

async function carregarImoveis(proprietarios) {
  const pessoaIds = proprietarios.map((p) => p.id);
  const nomeporId = Object.fromEntries(proprietarios.map((p) => [p.id, p.nome]));
  const mostrarDono = proprietarios.length > 1;

  const { data: imoveis } = await supabase
    .from('imoveis')
    .select('*')
    .in('proprietario_id', pessoaIds)
    .eq('finalidade', 'locacao')
    .eq('status', 'alugado')
    .order('criado_em', { ascending: false });

  const list = $('#imoveisList');
  $('#statImoveis').textContent = imoveis ? imoveis.length : '0';

  if (!imoveis || imoveis.length === 0) {
    list.innerHTML = '<p class="empty-state">Nenhum imóvel vinculado ao seu cadastro ainda.</p>';
    return;
  }

  list.innerHTML = imoveis.map(im => `
    <div class="portal-item">
      <div>
        ${mostrarDono ? `<span class="portal-dono-tag">${nomeporId[im.proprietario_id] || 'Proprietário'}</span>` : ''}
        <strong>${im.titulo || im.codigo || 'Imóvel'}</strong>
        <span class="portal-item-sub">${[im.endereco, im.bairro, im.cidade].filter(Boolean).join(', ') || 'Endereço não informado'}</span>
      </div>
      <div class="portal-item-right">
        <span class="status-pill status-${im.status}">${(im.status || '').replace('_', ' ')}</span>
        <span class="portal-item-value">${im.finalidade === 'locacao' ? fmtMoney(im.valor_locacao) + '/mês' : fmtMoney(im.valor_venda)}</span>
      </div>
    </div>
  `).join('');
}

async function carregarRepasses(proprietarios) {
  const pessoaIds = proprietarios.map((p) => p.id);
  const nomeporId = Object.fromEntries(proprietarios.map((p) => [p.id, p.nome]));
  const mostrarDono = proprietarios.length > 1;

  const { data: contratos } = await supabase
    .from('contratos')
    .select('*, imoveis(titulo, endereco, bairro), pessoas!contratos_comprador_locatario_id_fkey(nome)')
    .in('vendedor_locador_id', pessoaIds)
    .eq('tipo', 'locacao')
    .eq('status', 'ativo')
    .order('data_inicio', { ascending: false });

  const wrap = $('#repassesWrap');
  const contratosAtivos = contratos || [];
  $('#statContratosAtivos').textContent = contratosAtivos.length;

  if (!contratos || contratos.length === 0) {
    wrap.innerHTML = '<p class="empty-state">Nenhum contrato de locação ativo encontrado para o seu cadastro.</p>';
    $('#statUltimoRepasse').textContent = '—';
    return;
  }

  let ultimoRepasseTxt = '—';
  const blocks = [];
  const dataMinima = '2026-07-01'; // histórico visível ao proprietário: julho de 2026 em diante

  for (const contrato of contratos) {
    const { data: cobrancas } = await supabase
      .from('cobrancas')
      .select('*, cobranca_ajustes(*)')
      .eq('contrato_id', contrato.id)
      .gte('referencia', dataMinima)
      .order('referencia', { ascending: false });

    const taxa = Number(contrato.taxa_administracao_percentual || 0);
    const rows = (cobrancas || []).map(c => {
      const bruto = Number(c.valor_base || 0);
      const repasseBase = bruto * (1 - taxa / 100);

      // Soma só os ajustes que de fato mexem no que o proprietário recebe (créditos/descontos
      // com origem ou destino = proprietário) — os que ficam só entre inquilino/imobiliária não mudam o repasse.
      let ajusteProprietario = 0;
      const ajustes = c.cobranca_ajustes || [];
      ajustes.forEach((a) => {
        const v = Number(a.valor) || 0;
        if (a.tipo === 'acrescimo' && a.destino === 'proprietario') ajusteProprietario += v;
        if (a.tipo === 'desconto' && a.destino === 'proprietario') ajusteProprietario += v;
        if (a.tipo === 'desconto' && a.origem === 'proprietario') ajusteProprietario -= v;
      });

      const liquido = repasseBase + ajusteProprietario;
      if (ultimoRepasseTxt === '—' && c.status === 'pago') {
        ultimoRepasseTxt = fmtMoney(liquido);
      }

      const linhasAjustes = ajustes.filter((a) => (a.destino === 'proprietario') || (a.origem === 'proprietario')).map((a) => {
        const v = Number(a.valor) || 0;
        const ehCredito = (a.tipo === 'acrescimo' && a.destino === 'proprietario') || (a.tipo === 'desconto' && a.destino === 'proprietario');
        const sinal = ehCredito ? '+' : '−';
        return `<tr class="portal-ajuste-row">
          <td colspan="2" class="portal-ajuste-desc">↳ ${a.descricao || (a.tipo === 'acrescimo' ? 'Acréscimo' : 'Desconto')}</td>
          <td class="${ehCredito ? 'portal-ajuste-credito' : 'portal-ajuste-debito'}">${sinal} ${fmtMoney(v)}</td>
          <td></td>
        </tr>`;
      }).join('');

      return `
        <tr>
          <td>${fmtMonth(c.referencia)}</td>
          <td>${fmtMoney(bruto)}</td>
          <td><strong>${fmtMoney(liquido)}</strong></td>
          <td><span class="status-pill status-${c.status}">${STATUS_LABEL[c.status] || c.status}</span></td>
        </tr>
        ${linhasAjustes}`;
    }).join('');

    blocks.push(`
      <div class="portal-contract-block">
        ${mostrarDono ? `<span class="portal-dono-tag">${nomeporId[contrato.vendedor_locador_id] || 'Proprietário'}</span>` : ''}
        <h3>${contrato.imoveis ? contrato.imoveis.titulo : 'Imóvel'} <span class="status-pill status-${contrato.status}">${contrato.status}</span></h3>
        <p class="portal-item-sub">${contrato.imoveis ? [contrato.imoveis.endereco, contrato.imoveis.bairro].filter(Boolean).join(', ') : ''}</p>
        <p class="portal-item-sub"><strong>Inquilino:</strong> ${contrato.pessoas?.nome || 'não informado'}</p>
        <p class="portal-item-sub"><strong>Aluguel:</strong> ${fmtMoney(Number(contrato.valor))}/mês · <strong>Renovação do contrato:</strong> ${contrato.data_fim ? new Date(contrato.data_fim + 'T00:00:00').toLocaleDateString('pt-BR') : 'sem data definida'}</p>
        <p class="portal-item-sub"><strong>Dia programado do repasse:</strong> ${contrato.dia_repasse ? `todo dia ${contrato.dia_repasse}` : 'ainda não definido'}</p>
        <div class="table-wrap">
          <table class="portal-table">
            <thead><tr><th>Referência</th><th>Aluguel bruto</th><th>Repasse líquido</th><th>Status</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="4" class="table-empty">Nenhuma cobrança lançada desde julho.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `);
  }

  $('#statUltimoRepasse').textContent = ultimoRepasseTxt;
  wrap.innerHTML = blocks.join('');
}

function mostrarErroLogin(msg) {
  const el = $('#loginError');
  el.textContent = msg;
  el.hidden = false;
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#loginBtn');
  btn.disabled = true;
  btn.textContent = 'Entrando...';
  $('#loginError').hidden = true;

  const email = $('#login-email').value.trim();
  const password = $('#login-senha').value;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  btn.disabled = false;
  btn.textContent = 'Entrar';

  if (error) {
    mostrarErroLogin('E-mail ou senha inválidos.');
    return;
  }
  await carregarPessoaEDashboard(data.session);
});

$('#forgotBtn').addEventListener('click', () => {
  $('#loginForm').hidden = true;
  $('#forgotForm').hidden = false;
});
$('#backToLoginBtn').addEventListener('click', () => {
  $('#forgotForm').hidden = true;
  $('#loginForm').hidden = false;
});
$('#forgotForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#forgot-email').value.trim();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/portal-proprietario'
  });
  const fb = $('#forgotFeedback');
  fb.hidden = false;
  fb.textContent = error ? 'Não foi possível enviar o link. Confira o e-mail digitado.' : 'Link enviado! Confira seu e-mail.';
});

$('#logoutBtn').addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.reload();
});

// ==== Trocar senha (pelo botão no dashboard, ou automaticamente ao chegar pelo link de "Esqueci minha senha") ====
function abrirModalTrocarSenha() {
  $('#trocarSenhaErro').hidden = true;
  $('#nova-senha-1').value = '';
  $('#nova-senha-2').value = '';
  $('#trocarSenhaOverlay').hidden = false;
}
$('#trocarSenhaBtn').addEventListener('click', abrirModalTrocarSenha);
$('#cancelarTrocarSenha').addEventListener('click', () => { $('#trocarSenhaOverlay').hidden = true; });

$('#trocarSenhaForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const erroEl = $('#trocarSenhaErro');
  erroEl.hidden = true;

  const senha1 = $('#nova-senha-1').value;
  const senha2 = $('#nova-senha-2').value;
  if (senha1 !== senha2) {
    erroEl.textContent = 'As senhas digitadas são diferentes.';
    erroEl.hidden = false;
    return;
  }

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  const { error } = await supabase.auth.updateUser({ password: senha1 });

  btn.disabled = false;
  btn.textContent = 'Salvar nova senha';

  if (error) {
    erroEl.textContent = 'Não foi possível trocar a senha: ' + error.message;
    erroEl.hidden = false;
    return;
  }

  $('#trocarSenhaOverlay').hidden = true;
  alert('Senha alterada com sucesso!');
});

// Quando o proprietário clica no link de "Esqueci minha senha" recebido por e-mail, o Supabase abre
// uma sessão temporária de recuperação e dispara este evento — abre direto o modal de nova senha,
// em vez de simplesmente cair no dashboard sem trocar nada.
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    carregarPessoaEDashboard(session).then(abrirModalTrocarSenha);
  }
});

init();
