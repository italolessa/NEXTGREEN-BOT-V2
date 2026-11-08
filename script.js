let configAtual = { timeframe: 'M1', mercado: 'OTC' };
let sinalAtual = null;
let historicoLocal = [];
let ultimoAtivoEnviado = null; // NOVO: Memória do último ativo recebido

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
    document.getElementById('msg-inicial').style.display = 'none';
    document.getElementById('area-sinal').style.display = 'none';
    document.getElementById('loader').style.display = 'block';

    document.getElementById('btn-buscar').innerText = "⏳ Lendo Polarium...";
    document.getElementById('btn-buscar').disabled = true;
    document.getElementById('btn-parar').style.display = 'block';

    // A MÁGICA: Envia a configuração e o último ativo para ser ignorado
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
    document.getElementById('msg-inicial').innerText = "Busca cancelada no aplicativo.";

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
        ultimoAtivoEnviado = null; // Limpa a memória do ativo

        historicoLocal = [];
        atualizarHistorico();

        pararBusca();
        document.getElementById('msg-inicial').innerText = "Filtros resetados. Clique em 'Buscar Ativo'.";
    }
}

// Recebe o sinal da nuvem e atualiza a tela
window.api.onNovoSinal((dados) => {
    sinalAtual = dados;
    ultimoAtivoEnviado = dados.ativo; // Salva o ativo atual para a próxima busca

    document.getElementById('loader').style.display = 'none';
    document.getElementById('area-sinal').style.display = 'block';

    document.getElementById('btn-buscar').innerText = "🔍 Buscar Ativo";
    document.getElementById('btn-buscar').disabled = false;
    document.getElementById('btn-parar').style.display = 'none';
    document.getElementById('res-ativo').innerText = dados.ativo;
    document.getElementById('res-tf').innerText = dados.timeframe;
    document.getElementById('res-conf').innerText = `${dados.score}%`;
    document.getElementById('res-hora').innerText = `⏰ ${dados.horario}`;

    const box = document.getElementById('box-direcao');
    if (dados.direcao === "PUT") {
        box.className = 'sinal-box venda';
        box.innerHTML = '📉 VENDA';
    } else {
        box.className = 'sinal-box compra';
        box.innerHTML = '📈 COMPRA';
    }

    if (historicoLocal.length === 0 || historicoLocal[0].id !== dados.id) {
        historicoLocal.unshift(dados);
        if (historicoLocal.length > 20) historicoLocal.pop();
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
            <span class="historico-dir" style="color: ${item.direcao === 'CALL' ? 'var(--green)' : 'var(--red)'};">${item.direcao}</span>
            <span class="historico-score">${item.timeframe} | ${item.score}%</span>
            <span class="historico-hora">⏰ ${item.horario}</span>
        </div>
    `).join('');
}

// Botão Enviar para Corretora
function enviarParaCorretora() {
    if (sinalAtual) {
        alert(`✅ Ordem enviada!\nAtivo: ${sinalAtual.ativo}\nDireção: ${sinalAtual.direcao}`);
        document.getElementById('area-sinal').style.display = 'none';
        document.getElementById('msg-inicial').style.display = 'block';
        document.getElementById('msg-inicial').innerText = "Sinal enviado! Clique em 'Buscar Ativo' para uma nova análise.";
    }
}

function fazerLogout() {
    if(confirm("Deseja desconectar sua conta da Polarium?")) {
        window.api.fazerLogout();
    }
}