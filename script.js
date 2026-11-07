let configAtual = { timeframe: 'M1', mercado: 'OTC' };
let sinalAtual = null;

function setConfig(key, valor) {
    configAtual[key] = valor;
    document.querySelectorAll('.config-table td').forEach(td => td.classList.remove('active'));
    if (key === 'timeframe') document.getElementById(valor === 'M1' ? 'btn-m1' : 'btn-m5').classList.add('active');
    else document.getElementById(valor === 'OTC' ? 'btn-otc' : 'btn-aberto').classList.add('active');
}

function solicitarBusca() {
    document.getElementById('msg-inicial').style.display = 'none';
    document.getElementById('area-sinal').style.display = 'none';
    document.getElementById('loader').style.display = 'block';
    
    // Envia a configuração para o servidor no Render
    window.api.configurarBusca(configAtual);
}

// Recebe o sinal da nuvem
window.api.onNovoSinal((dados) => {
    sinalAtual = dados;
    
    document.getElementById('loader').style.display = 'none';
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
});

function enviarParaCorretora() {
    if (sinalAtual) {
        alert(`✅ Sinal copiado: ${sinalAtual.ativo} | ${sinalAtual.direcao} às ${sinalAtual.horario}`);
        document.getElementById('area-sinal').style.display = 'none';
        document.getElementById('msg-inicial').style.display = 'block';
    }
}

function fazerLogout() {
    if(confirm("Deseja desconectar sua conta da Polarium?")) {
        window.api.fazerLogout();
    }
}