
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
  const { data: pessoa, error } = await supabase
    .from('pessoas')
    .select('*')
    .eq('auth_user_id', session.user.id)
    .maybeSingle();

  if (error || !pessoa || !(pessoa.papeis || []).includes('proprietario')) {
    mostrarErroLogin('Este login não está liberado para o Portal do Proprietário. Fale com seu corretor.');
    await supabase.auth.signOut();
    return;
  }

  $('#loginWrap').hidden = true;
  $('#dashboard').hidden = false;
  $('#ownerName').textContent = pessoa.nome;

  await Promise.all([carregarImoveis(pessoa.id), carregarRepasses(pessoa.id)]);
}

async function carregarImoveis(pessoaId) {
  const { data: imoveis } = await supabase
    .from('imoveis')
    .select('*')
    .eq('proprietario_id', pessoaId)
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

async function carregarRepasses(pessoaId) {
  const { data: contratos } = await supabase
    .from('contratos')
    .select('*, imoveis(titulo, endereco, bairro)')
    .eq('vendedor_locador_id', pessoaId)
    .eq('tipo', 'locacao')
    .order('data_inicio', { ascending: false });

  const wrap = $('#repassesWrap');
  const contratosAtivos = (contratos || []).filter(c => c.status === 'ativo');
  $('#statContratosAtivos').textContent = contratosAtivos.length;

  if (!contratos || contratos.length === 0) {
    wrap.innerHTML = '<p class="empty-state">Nenhum contrato de locação encontrado para o seu cadastro.</p>';
    $('#statUltimoRepasse').textContent = '—';
    return;
  }

  let ultimoRepasseTxt = '—';
  const blocks = [];

  for (const contrato of contratos) {
    const { data: cobrancas } = await supabase
      .from('cobrancas')
      .select('*')
      .eq('contrato_id', contrato.id)
      .order('referencia', { ascending: false })
      .limit(12);

    const taxa = Number(contrato.taxa_administracao_percentual || 0);
    const rows = (cobrancas || []).map(c => {
      const bruto = Number(c.valor_base || 0);
      const liquido = bruto * (1 - taxa / 100);
      if (ultimoRepasseTxt === '—' && c.status === 'pago') {
        ultimoRepasseTxt = fmtMoney(liquido);
      }
      return `
        <tr>
          <td>${fmtMonth(c.referencia)}</td>
          <td>${fmtMoney(bruto)}</td>
          <td>${taxa}%</td>
          <td><strong>${fmtMoney(liquido)}</strong></td>
          <td><span class="status-pill status-${c.status}">${STATUS_LABEL[c.status] || c.status}</span></td>
        </tr>`;
    }).join('');

    blocks.push(`
      <div class="portal-contract-block">
        <h3>${contrato.imoveis ? contrato.imoveis.titulo : 'Imóvel'} <span class="status-pill status-${contrato.status}">${contrato.status}</span></h3>
        <p class="portal-item-sub">${contrato.imoveis ? [contrato.imoveis.endereco, contrato.imoveis.bairro].filter(Boolean).join(', ') : ''}</p>
        <p class="portal-item-sub"><strong>Aluguel:</strong> ${fmtMoney(Number(contrato.valor))}/mês · <strong>Renovação do contrato:</strong> ${contrato.data_fim ? new Date(contrato.data_fim + 'T00:00:00').toLocaleDateString('pt-BR') : 'sem data definida'}</p>
        <div class="table-wrap">
          <table class="portal-table">
            <thead><tr><th>Referência</th><th>Aluguel bruto</th><th>Taxa adm.</th><th>Repasse líquido</th><th>Status</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="5" class="table-empty">Nenhuma cobrança lançada ainda.</td></tr>'}</tbody>
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

init();
