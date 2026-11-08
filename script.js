let configAtual = { timeframe: 'M1', mercado: 'OTC' };
let sinalAtual = null;
let historicoLocal = [];
let ultimoAtivoEnviado = null; 

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

function solicitarBusca() {
    document.getElementById('msg-inicial').style.display = 'none';
    document.getElementById('area-sinal').style.display = 'none';
    document.getElementById('loader').style.display = 'block';
    document.getElementById('btn-buscar').innerText = "⏳ Lendo Polarium...";
    document.getElementById('btn-buscar').disabled = true;
    document.getElementById('btn-parar').style.display = 'block';

    window.api.configurarBusca({
        timeframe: configAtual.timeframe,
        mercado: configAtual.mercado,
        ignorarAtivo: ultimoAtivoEnviado 
    });
}

function pararBusca() {
    document.getElementById('loader').style.display = 'none';
    document.getElementById('msg-inicial').style.display = 'block';
    document.getElementById('msg-inicial').innerText = "Busca cancelada.";
    document.getElementById('btn-buscar').innerText = "🔍 Buscar Ativo";
    document.getElementById('btn-buscar').disabled = false;
    document.getElementById('btn-parar').style.display = 'none';
}

function resetarFiltros() {
    if(confirm("Deseja resetar os filtros e limpar o histórico?")) {
        configAtual = { timeframe: 'M1', mercado: 'OTC' };
        setConfig('timeframe', 'M1');
        setConfig('mercado', 'OTC');
        ultimoAtivoEnviado = null; 
        historicoLocal = [];
        atualizarHistorico();
        pararBusca();
        document.getElementById('msg-inicial').innerText = "Filtros resetados. Clique em 'Buscar Ativo'.";
    }
}

window.api.onNovoSinal((dados) => {
    if (ultimoAtivoEnviado && ultimoAtivoEnviado === dados.ativo) {
        return; 
    }

    sinalAtual = dados;
    ultimoAtivoEnviado = dados.ativo; 

    document.getElementById('loader').style.display = 'none';
    document.getElementById('area-sinal').style.display = 'block';
    document.getElementById('btn-buscar').innerText = "🔍 Buscar Ativo";
    document.getElementById('btn-buscar').disabled = false;
    document.getElementById('btn-parar').style.display = 'none';

    document.getElementById('res-ativo').innerText = dados.ativo;
    document.getElementById('res-tf').innerText = dados.timeframe;
    document.getElementById('res-conf').innerText = `${dados.score}%`;
    
    document.getElementById('res-hora').innerText = `⏰ ${dados.horario} (BRT)`;

    const box = document.getElementById('box-direcao');
    if (dados.direcao === "PUT" || dados.direcao === "VENDA") {
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

function enviarParaCorretora() {
    if (sinalAtual) {
        alert(`✅ Ordem Confirmada!\n\nAtivo: ${sinalAtual.ativo}\nDireção: ${sinalAtual.direcao}\nENTRAR EXATAMENTE ÀS: ${sinalAtual.horario} (BRT)`);
        document.getElementById('area-sinal').style.display = 'none';
        document.getElementById('msg-inicial').style.display = 'block';
        document.getElementById('msg-inicial').innerText = "Aguardando o horário de entrada na Polarium...";
    }
}

function fazerLogout() {
    if(confirm("Deseja desconectar sua conta da Polarium?")) {
        window.api.fazerLogout();
    }
}