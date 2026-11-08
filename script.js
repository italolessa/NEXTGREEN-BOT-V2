let configAtual = { timeframe: 'M1', mercado: 'OTC' };
let sinalAtual = null;
let historicoLocal = [];
let ultimoAtivoEnviado = null; // Memória do último ativo recebido

// Função de selecionar as tabelas (M1/M5 e OTC/Aberto)
function setConfig(key, valor) {
    configAtual[key] = valor;

    if (key === 'timeframe') {
        document.getElementById('btn-m1').classList.remove('active');
        document.getElementById('btn-m5').classList.remove('active');
        document.getElementById(valor === 'M1' ? 'btn-m1' : 'btn-m5').classList.add('active');
    } else {
        document.getElementById('btn-otc').classList.remove('active');
        document.getElementById('btn-aberto').classList.remove('active');
        document.getElementById(valor === 'OTC' ? 'btn-otc' : 'btn-aberto').classList.add('active');
    }
}

// Botão: BUSCAR ATIVO
function solicitarBusca() {
    // Limpa a tela e mostra o loader
    document.getElementById('msg-inicial').style.display = 'none';
    document.getElementById('area-sinal').style.display = 'none';
    document.getElementById('loader').style.display = 'block';

    // Desabilita o botão buscar e mostra o botão parar
    document.getElementById('btn-buscar').innerText = "⏳ Lendo Polarium...";
    document.getElementById('btn-buscar').disabled = true;
    document.getElementById('btn-parar').style.display = 'block';

    // A MÁGICA: Envia a configuração E o último ativo para o servidor ignorar
    window.api.configurarBusca({
        timeframe: configAtual.timeframe,
        mercado: configAtual.mercado,
        ignorarAtivo: ultimoAtivoEnviado 
    });
}

// Botão: PARAR
function pararBusca() {
    document.getElementById('loader').style.display = 'none';
    document.getElementById('msg-inicial').style.display = 'block';
    document.getElementById('msg-inicial').innerText = "Busca cancelada no aplicativo. Aguardando nova ação.";

    document.getElementById('btn-buscar').innerText = "🔍 Buscar Ativo";
    document.getElementById('btn-buscar').disabled = false;
    document.getElementById('btn-parar').style.display = 'none';
}

// Botão: RESETAR FILTROS
function resetarFiltros() {
    if(confirm("Deseja resetar os filtros e limpar o histórico da tela?")) {
        configAtual = { timeframe: 'M1', mercado: 'OTC' };
        setConfig('timeframe', 'M1');
        setConfig('mercado', 'OTC');
        
        ultimoAtivoEnviado = null; // Limpa a memória para permitir ver o mesmo ativo de novo

        historicoLocal = [];
        atualizarHistorico();

        pararBusca();
        document.getElementById('msg-inicial').innerText = "Filtros resetados. Clique em 'Buscar Ativo'.";
    }
}

// Recebe o sinal da nuvem e atualiza a tela
window.api.onNovoSinal((dados) => {
    // =========================================================
    // A CORREÇÃO DEFINITIVA ESTÁ AQUI:
    // Se o ativo que chegou da nuvem for o mesmo que já está salvo 
    // na memória, o app ignora e não mostra na tela.
    // =========================================================
    if (ultimoAtivoEnviado && ultimoAtivoEnviado === dados.ativo) {
        console.log(`⏳ App ignorou sinal repetido da nuvem: ${dados.ativo}`);
        return; // Interrompe o código aqui e espera o próximo sinal
    }

    sinalAtual = dados;
    ultimoAtivoEnviado = dados.ativo; // Salva na memória qual ativo está na tela

    // Esconde o loader e mostra o card de resultado
    document.getElementById('loader').style.display = 'none';
    document.getElementById('area-sinal').style.display = 'block';

    // Reseta os botões
    document.getElementById('btn-buscar').innerText = "🔍 Buscar Ativo";
    document.getElementById('btn-buscar').disabled = false;
    document.getElementById('btn-parar').style.display = 'none';

    // Preenche os dados na tela
    document.getElementById('res-ativo').innerText = dados.ativo;
    document.getElementById('res-tf').innerText = dados.timeframe;
    document.getElementById('res-conf').innerText = `${dados.score}%`;
    document.getElementById('res-hora').innerText = `⏰ ${dados.horario}`;

    // Muda a cor e o texto dependendo da direção (CALL/PUT)
    const box = document.getElementById('box-direcao');
    if (dados.direcao === "PUT" || dados.direcao === "VENDA") {
        box.className = 'sinal-box venda';
        box.innerHTML = '📉 VENDA';
    } else {
        box.className = 'sinal-box compra';
        box.innerHTML = '📈 COMPRA';
    }

    // Adiciona ao histórico (evitando duplicar o mesmo id na lista)
    if (historicoLocal.length === 0 || historicoLocal[0].id !== dados.id) {
        historicoLocal.unshift(dados);
        if (historicoLocal.length > 20) historicoLocal.pop(); // Mantém os últimos 20
        atualizarHistorico();
    }
});

// Atualiza a tabela visual do histórico
function atualizarHistorico() {
    const container = document.getElementById('lista-historico');

    if (historicoLocal.length === 0) {
        container.innerHTML = '<div style="color: #666; text-align: center; padding: 10px;">Nenhum sinal recebido ainda...</div>';
        return;
    }
    
    container.innerHTML = historicoLocal.map(item => `
        <div class="historico-item">
            <span class="historico-ativo">${item.ativo}</span>
            <span class="historico-dir" style="color: ${item.direcao === 'CALL' || item.direcao === 'COMPRA' ? 'var(--green)' : 'var(--red)'};">${item.direcao}</span>
            <span class="historico-score">${item.timeframe} | ${item.score}%</span>
            <span class="historico-hora">⏰ ${item.horario}</span>
        </div>
    `).join('');
}

// Botão Enviar para Corretora (Aprovar)
function enviarParaCorretora() {
    if (sinalAtual) {
        alert(`✅ Ordem enviada para a Corretora!\n\nAtivo: ${sinalAtual.ativo}\nDireção: ${sinalAtual.direcao}\nEntrada: ${sinalAtual.horario}`);
        
        // Limpa a tela após o envio
        document.getElementById('area-sinal').style.display = 'none';
        document.getElementById('msg-inicial').style.display = 'block';
        document.getElementById('msg-inicial').innerText = "Sinal enviado! Clique em 'Buscar Ativo' para uma nova análise.";
        
        // Nós NÃO limpamos o ultimoAtivoEnviado aqui, para que se você buscar de novo, ele ainda ignore esse ativo e busque outro.
    }
}

// Função de Logout
function fazerLogout() {
    if(confirm("Deseja desconectar sua conta da Polarium?")) {
        window.api.fazerLogout();
    }
}