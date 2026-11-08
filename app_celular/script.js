// COLOQUE A URL DO SEU RENDER AQUI (sem barra no final)
const RENDER_URL = 'https://nextgreen-bot-v2.onrender.com';

let configAtual = { timeframe: 'M1', mercado: 'OTC' };
let sinalAtual = null;
let historicoLocal = [];
let ultimoAtivoEnviado = null;
let pollingInterval;

// Função que vai buscar os sinais no Render
function iniciarBuscaNaNuvem() {
    if (pollingInterval) clearInterval(pollingInterval);
    
    pollingInterval = setInterval(async () => {
        try {
            const resposta = await fetch(`${RENDER_URL}/api/sinais`);
            const dados = await resposta.json();
            
            if (dados && dados.length > 0) {
                const novoAtivo = dados[0];
                // Se for um ativo diferente do que já está na tela
                if (ultimoAtivoEnviado !== novoAtivo.ativo) {
                    mostrarSinalNaTela(novoAtivo);
                }
            }
        } catch (error) {
            console.log("Aguardando servidor...");
        }
    }, 5000);
}

// Função para selecionar M1/M5 e OTC/Aberto
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

// Botão Buscar Ativo
async function solicitarBusca() {
    document.getElementById('msg-inicial').style.display = 'none';
    document.getElementById('area-sinal').style.display = 'none';
    document.getElementById('loader').style.display = 'block';
    document.getElementById('btn-buscar').innerText = "⏳ Analisando...";
    document.getElementById('btn-buscar').disabled = true;
    document.getElementById('btn-parar').style.display = 'block';

    try {
        // Avisa o servidor no Render para começar a buscar
        await fetch(`${RENDER_URL}/api/configurar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                timeframe: configAtual.timeframe,
                mercado: configAtual.mercado,
                ignorarAtivo: ultimoAtivoEnviado
            })
        });
    } catch (error) {
        alert("Erro ao conectar no servidor. Verifique a internet.");
        pararBusca();
    }
}

// Botão Parar
function pararBusca() {
    document.getElementById('loader').style.display = 'none';
    document.getElementById('msg-inicial').style.display = 'block';
    document.getElementById('msg-inicial').innerText = "Busca cancelada.";
    document.getElementById('btn-buscar').innerText = "🔍 Buscar Ativo";
    document.getElementById('btn-buscar').disabled = false;
    document.getElementById('btn-parar').style.display = 'none';
}

// Botão Resetar Filtros
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

// Mostra o sinal que chegou da nuvem na tela
function mostrarSinalNaTela(dados) {
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
}

// Atualiza a lista de histórico
function atualizarHistorico() {
    const container = document.getElementById('lista-historico');
    if (historicoLocal.length === 0) {
        container.innerHTML = '<div style="color: #666; text-align: center; padding: 10px;">Nenhum sinal recebido ainda...</div>';
        return;
    }
    container.innerHTML = historicoLocal.map(item => `
        <div class="historico-item">
            <span class="historico-ativo">${item.ativo}</span>
            <span class="historico-direcao" style="color: ${item.direcao === 'CALL' ? 'var(--green)' : 'var(--red)'};">${item.direcao}</span>
            <span class="historico-score">${item.estrategia} | ${item.confianca}%</span>
            <span class="historico-hora">⏰ ${item.horario}</span>
        </div>
    `).join('');
}

function enviarParaCorretora() {
    if (sinalAtual) {
        alert(`✅ Ordem Confirmada!\n\nAtivo: ${sinalAtual.ativo}\nDireção: ${sinalAtual.direcao}\nENTRAR EXATAMENTE ÀS: ${sinalAtual.horario} (BRT)`);
        document.getElementById('area-sinal').style.display = 'none';
        document.getElementById('msg-inicial').style.display = 'block';
        document.getElementById('msg-inicial').innerText = "Siga para a Polarium no horário exato!";
    }
}

// Função para tirar o botão de Sair, já que no celular não tem login
function fazerLogout() {
    alert("No celular, a conexão é gerenciada pelo seu PC. Feche o app para sair.");
}

// Inicia o recebimento de sinais quando a página abrir
window.onload = () => {
    iniciarBuscaNaNuvem();
};