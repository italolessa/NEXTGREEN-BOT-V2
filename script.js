const RENDER_URL = 'https://nextgreen-bot-v2.onrender.com'; // COLOQUE A SUA URL AQUI
let configAtual = { timeframe: 'M1', mercado: 'OTC' };
let sinalAtual = null;
let historicoLocal = [];
let ultimoAtivoEnviado = null; 

// --- FUNÇÃO DE ALARME SONORO NATIVO ---
function tocarAlarme() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // Primeiro Bipe
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.type = 'square'; // Som mais agudo e chamativo
        osc1.frequency.value = 880;
        gain1.gain.setValueAtTime(0.5, audioCtx.currentTime);
        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);
        osc1.start();
        osc1.stop(audioCtx.currentTime + 0.2);

        // Segundo Bipe (300ms depois)
        setTimeout(() => {
            const osc2 = audioCtx.createOscillator();
            const gain2 = audioCtx.createGain();
            osc2.type = 'square';
            osc2.frequency.value = 1100;
            gain2.gain.setValueAtTime(0.5, audioCtx.currentTime);
            osc2.connect(gain2);
            gain2.connect(audioCtx.destination);
            osc2.start();
            osc2.stop(audioCtx.currentTime + 0.3);
        }, 300);
    } catch (e) {
        console.log("Áudio bloqueado pelo navegador.");
    }
}

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
    document.getElementById('btn-buscar').innerText = "⏳ Analisando...";
    document.getElementById('btn-buscar').disabled = true;
    document.getElementById('btn-parar').style.display = 'block';

    window.api.configurarBusca({
        timeframe: configAtual.timeframe,
        mercado: configAtual.mercado,
        ignorarAtivo: ultimoAtivoEnviado 
    });
}

// Botão: PARAR
function pararBusca() {
    window.api.pararBusca();
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
        window.api.resetarFiltros();
        
        configAtual = { timeframe: 'M1', mercado: 'OTC' };
        setConfig('timeframe', 'M1');
        setConfig('mercado', 'OTC');
        
        ultimoAtivoEnviado = null;
        historicoLocal = [];
        sinalAtual = null;
        
        document.getElementById('area-sinal').style.display = 'none';
        document.getElementById('loader').style.display = 'none';
        document.getElementById('msg-inicial').style.display = 'block';
        document.getElementById('msg-inicial').innerText = "Filtros resetados. Clique em 'Buscar Ativo'.";
        
        document.getElementById('btn-buscar').innerText = "🔍 Buscar Ativo";
        document.getElementById('btn-buscar').disabled = false;
        document.getElementById('btn-parar').style.display = 'none';
        
        atualizarHistorico();
    }
}

// Recebe o sinal da nuvem e atualiza a tela
window.api.onNovoSinal((dados) => {
    if (ultimoAtivoEnviado && ultimoAtivoEnviado === dados.ativo) {
        return; 
    }
    
    // TOCA O ALARME
    tocarAlarme();

    sinalAtual = dados;
    ultimoAtivoEnviado = dados.ativo; 
    
    document.getElementById('loader').style.display = 'none';
    document.getElementById('area-sinal').style.display = 'block';
    document.getElementById('btn-buscar').innerText = "🔍 Buscar Ativo";
    document.getElementById('btn-buscar').disabled = false;
    document.getElementById('btn-parar').style.display = 'none';

    document.getElementById('res-ativo').innerText = dados.ativo;
    document.getElementById('res-tf').innerText = `${dados.timeframe} (${dados.estrategia})`;
    document.getElementById('res-conf').innerText = `${dados.confianca}%`;
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
            <span class="historico-direcao" style="color: ${item.direcao === 'CALL' || item.direcao === 'COMPRA' ? 'var(--green)' : 'var(--red)'};">${item.direcao}</span>
            <span class="historico-score">${item.estrategia} | ${item.confianca}%</span>
            <span class="historico-hora">⏰ ${item.horario}</span>
        </div>
    `).join('');
}

// Botão Enviar para Corretora (Aprovar)
function enviarParaCorretora() {
    if (sinalAtual) {
        alert(`✅ Ordem Confirmada!\n\nAtivo: ${sinalAtual.ativo}\nDireção: ${sinalAtual.direcao}\nENTRAR EXATAMENTE ÀS: ${sinalAtual.horario} (BRT)`);
        document.getElementById('area-sinal').style.display = 'none';
        document.getElementById('msg-inicial').style.display = 'block';
        document.getElementById('msg-inicial').innerText = "Siga para a Polarium no horário exato!";
    }
}

// Função de Logout
function fazerLogout() {
    if(confirm("Deseja desconectar sua conta da Polarium?")) {
        window.api.fazerLogout();
    }
}