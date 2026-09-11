
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
  await Promise.all([carregarImoveis(proprietarios), carregarRepasses(proprietarios)]);
}

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

      const linhasAjustes = ajustes.map((a) => {
        const v = Number(a.valor) || 0;
        const afetaProprietario = (a.destino === 'proprietario') || (a.origem === 'proprietario');
        const ehCredito = (a.tipo === 'acrescimo' && a.destino === 'proprietario') || (a.tipo === 'desconto' && a.destino === 'proprietario');
        const sinal = ehCredito ? '+' : '−';
        const notaRetido = !afetaProprietario ? ' (retido pela imobiliária, não afeta seu repasse)' : '';
        return `<tr class="portal-ajuste-row">
          <td colspan="2" class="portal-ajuste-desc">↳ ${a.descricao || (a.tipo === 'acrescimo' ? 'Acréscimo' : 'Desconto')}${notaRetido}</td>
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
