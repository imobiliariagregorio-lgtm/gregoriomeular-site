
const $ = (sel) => document.querySelector(sel);
const fmtMoney = (v) => (v === null || v === undefined) ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
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
  const { data: pessoa, error } = await supabase
    .from('pessoas')
    .select('*')
    .eq('auth_user_id', session.user.id)
    .maybeSingle();

  if (error || !pessoa || !(pessoa.papeis || []).includes('locatario')) {
    mostrarErroLogin('Este login não está liberado para o Portal do Locatário. Fale com seu corretor.');
    await supabase.auth.signOut();
    return;
  }

  $('#loginWrap').hidden = true;
  $('#dashboard').hidden = false;
  $('#tenantName').textContent = pessoa.nome;

  await carregarContratos(pessoa.id);
}

async function carregarContratos(pessoaId) {
  const { data: contratos } = await supabase
    .from('contratos')
    .select('*, imoveis(titulo, endereco, bairro, cidade, valor_condominio, valor_iptu)')
    .eq('comprador_locatario_id', pessoaId)
    .eq('tipo', 'locacao')
    .order('status', { ascending: true })
    .order('data_inicio', { ascending: false });

  const wrap = $('#contractsWrap');

  if (!contratos || contratos.length === 0) {
    $('#noContractMsg').hidden = false;
    wrap.innerHTML = '';
    return;
  }
  $('#noContractMsg').hidden = true;

  const blocks = [];
  for (const contrato of contratos) {
    const { data: cobrancas } = await supabase
      .from('cobrancas')
      .select('*')
      .eq('contrato_id', contrato.id)
      .order('referencia', { ascending: false })
      .limit(12);

    const proxima = (cobrancas || []).find(c => c.status === 'pendente' || c.status === 'atrasado');
    const imovel = contrato.imoveis || {};

    const historico = (cobrancas || []).map(c => `
      <tr>
        <td>${fmtMonth(c.referencia)}</td>
        <td>${fmtMoney(c.valor_base)}</td>
        <td>${fmtDate(c.data_vencimento)}</td>
        <td>${fmtDate(c.data_pagamento)}</td>
        <td><span class="status-pill status-${c.status}">${STATUS_LABEL[c.status] || c.status}</span></td>
      </tr>
    `).join('');

    blocks.push(`
      <div class="portal-contract-block">
        <h3>${imovel.titulo || 'Imóvel alugado'} <span class="status-pill status-${contrato.status}">${contrato.status}</span></h3>
        <p class="portal-item-sub">${[imovel.endereco, imovel.bairro, imovel.cidade].filter(Boolean).join(', ')}</p>

        ${proxima ? `
        <div class="portal-highlight">
          <div>
            <span class="eyebrow">Próxima cobrança</span>
            <strong class="portal-highlight-value">${fmtMoney(proxima.valor_base)}</strong>
          </div>
          <div>
            <span class="portal-item-sub">Vencimento</span>
            <strong>${fmtDate(proxima.data_vencimento)}</strong>
          </div>
          <span class="status-pill status-${proxima.status}">${STATUS_LABEL[proxima.status]}</span>
        </div>` : `<div class="portal-highlight portal-highlight-ok"><span>✓ Nenhuma cobrança pendente no momento.</span></div>`}

        <div class="about-stats portal-stats">
          <div class="about-card"><strong>${fmtMoney(contrato.valor)}</strong><span>Valor mensal do contrato</span></div>
          <div class="about-card"><strong>${fmtMoney(imovel.valor_condominio)}</strong><span>Condomínio</span></div>
          <div class="about-card"><strong>${fmtMoney(imovel.valor_iptu)}</strong><span>IPTU</span></div>
        </div>

        <h4 class="portal-sub-title">Histórico de pagamentos</h4>
        <div class="table-wrap">
          <table class="portal-table">
            <thead><tr><th>Referência</th><th>Valor</th><th>Vencimento</th><th>Pago em</th><th>Status</th></tr></thead>
            <tbody>${historico || '<tr><td colspan="5" class="table-empty">Nenhuma cobrança lançada ainda.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `);
  }

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
    redirectTo: window.location.origin + '/portal-locatario'
  });
  const fb = $('#forgotFeedback');
  fb.hidden = false;
  fb.textContent = error ? 'Não foi possível enviar o link. Confira o e-mail digitado.' : 'Link enviado! Confira seu e-mail.';
});

$('#logoutBtn').addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.reload();
});

init();
