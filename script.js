let configAtual = { timeframe: 'M1', mercado: 'OTC' };
let historico = [];

function setConfig(key, valor) {
    configAtual[key] = valor;
    document.querySelectorAll('.btn-tab').forEach(t => t.classList.remove('active'));
    
    if (key === 'timeframe') document.getElementById(valor === 'M1' ? 'tab-m1' : 'tab-m5').classList.add('active');
    else document.getElementById(valor === 'OTC' ? 'tab-otc' : 'tab-aberto').classList.add('active');
}

function salvarConfig() {
    window.api.configurarBusca(configAtual);
    alert(`✅ Busca ativada para ${configAtual.timeframe} | ${configAtual.mercado}`);
}

window.api.onNovoSinal((dados) => {
    document.getElementById('msg-inicial').style.display = 'none';
    document.getElementById('area-sinal').style.display = 'block';

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

    if (historico.length === 0 || historico[0].id !== dados.id) {
        historico.unshift(dados);
        if (historico.length > 10) historico.pop();
        atualizarHistorico();
    }
});

function atualizarHistorico() {
    document.getElementById('lista-historico').innerHTML = historico.map(h => `
        <div class="historico-item">
            <span style="color: var(--green); font-weight: bold; width: 120px;">${h.ativo}</span>
            <span style="color: ${h.direcao === 'CALL' ? 'var(--green)' : 'var(--red)'}; width: 60px;">${h.direcao}</span>
            <span style="width: 100px;">${h.timeframe} | ${h.score}%</span>
            <span style="text-align: right; flex: 1;">⏰ ${h.horario}</span>
        </div>
    `).join('');
}

function fazerLogout() { if(confirm("Deseja sair?")) window.api.fazerLogout(); }