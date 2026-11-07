let configAtual = { timeframe: 'M1', mercado: 'OTC' };
let sinalAtual = null;

function setConfig(key, valor, btnAtivo, btnInativo) {
    configAtual[key] = valor;
    document.getElementById(btnAtivo).style.color = 'var(--green)';
    document.getElementById(btnAtivo).style.borderColor = 'var(--green)';
    document.getElementById(btnInativo).style.color = '#888';
    document.getElementById(btnInativo).style.borderColor = '#444';
}

function solicitarBusca() {
    document.getElementById('msg-inicial').style.display = 'none';
    document.getElementById('area-sinal').style.display = 'none';
    document.getElementById('loader').style.display = 'block';
    
    document.getElementById('btn-buscar').innerText = "⏳ Lendo Polarium...";
    document.getElementById('btn-buscar').disabled = true;
    document.getElementById('btn-parar').style.display = 'block';
    
    window.api.buscarAtivo(configAtual);
}

function pararBusca() {
    window.api.pararBusca();
    
    document.getElementById('loader').style.display = 'none';
    document.getElementById('msg-inicial').style.display = 'block';
    document.getElementById('msg-inicial').innerText = "Busca cancelada. O robô vai relaxar os filtros na próxima busca.";
    
    document.getElementById('btn-buscar').innerText = "🔍 Buscar Ativo";
    document.getElementById('btn-buscar').disabled = false;
    document.getElementById('btn-parar').style.display = 'none';
}

function novaBuscaLimpa() {
    window.api.resetarFiltros();
    document.getElementById('msg-inicial').innerText = "Filtros resetados para o modo Rígido. Clique em Buscar.";
}

window.api.onNovoSinal((dados) => {
    sinalAtual = dados;
    
    document.getElementById('loader').style.display = 'none';
    document.getElementById('area-sinal').style.display = 'block';
    document.getElementById('btn-buscar').innerText = "🔍 Buscar Ativo";
    document.getElementById('btn-buscar').disabled = false;
    document.getElementById('btn-parar').style.display = 'none';

    document.getElementById('res-ativo').innerText = dados.ativo;
    document.getElementById('res-tf').innerText = dados.timeframe;
    document.getElementById('res-estrategia').innerText = dados.estrategia;
    document.getElementById('res-rsi').innerText = dados.rsi;
    document.getElementById('res-adx').innerText = dados.adx;
    document.getElementById('res-conf').innerText = `${dados.score}%`;
    
    const campoHora = document.getElementById('res-hora');
    campoHora.innerText = `⏰ ${dados.horario}`;
    campoHora.style.color = 'var(--green)';
    campoHora.style.fontSize = '18px';
    campoHora.style.fontWeight = 'bold';

    const box = document.getElementById('box-direcao');
    if (dados.direcao === "PUT") {
        box.className = 'sinal-box';
        box.innerHTML = '📉 VENDA';
    } else {
        box.className = 'sinal-box compra';
        box.innerHTML = '📈 COMPRA';
    }

    // Atualiza o histórico após um novo sinal
    setTimeout(carregarHistorico, 1000);
});

function aprovarSinal() {
    if (sinalAtual) {
        window.api.aprovarSinal(sinalAtual);
        alert(`✅ Ordem de ${sinalAtual.direcao} no valor de $5.00 enviada!`);
        
        document.getElementById('area-sinal').style.display = 'none';
        document.getElementById('msg-inicial').style.display = 'block';
        document.getElementById('msg-inicial').innerText = "Ordem enviada! Clique em 'Buscar' para uma nova análise.";
    }
}

function fazerLogout() {
    if(confirm("Deseja desconectar sua conta da Polarium?")) {
        window.api.fazerLogout();
    }
}

// --- FUNÇÕES DO HISTÓRICO ---
async function carregarHistorico() {
    try {
        const historico = await window.api.lerHistorico();
        const container = document.getElementById('lista-historico');
        
        if (historico && historico.length > 0) {
            container.innerHTML = historico.map(item => `
                <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #222; align-items: center;">
                    <span style="color: var(--green); font-weight: bold; width: 120px;">${item.ativo}</span>
                    <span style="color: ${item.direcao === 'CALL' ? 'var(--green)' : 'var(--red)'}; font-weight: bold; width: 60px;">${item.direcao}</span>
                    <span style="width: 90px;">Score: ${item.confirmacao}%</span>
                    <span style="width: 130px;">RSI: ${item.rsi} | ADX: ${item.adx}</span>
                    <span style="color: #666; text-align: right; flex: 1;">⏰ ${item.horario_entrada}</span>
                </div>
            `).join('');
        } else {
            container.innerHTML = "Nenhum sinal gerado ainda...";
        }
    } catch (e) {
        console.log("Erro ao ler histórico", e);
    }
}

async function limparHistorico() {
    if (confirm("Tem certeza que deseja apagar todo o histórico de sinais? Essa ação não pode ser desfeita.")) {
        try {
            const resposta = await window.api.limparHistorico();
            if (resposta.success) {
                document.getElementById('lista-historico').innerHTML = "Nenhum sinal gerado ainda...";
                alert("✅ Histórico limpo com sucesso!");
            } else {
                alert("❌ Erro ao limpar: " + resposta.error);
            }
        } catch (e) {
            console.error("Erro na chamada:", e);
            alert("❌ Falha de comunicação com o backend.");
        }
    }
}

// Carrega o histórico quando a tela abrir
carregarHistorico();