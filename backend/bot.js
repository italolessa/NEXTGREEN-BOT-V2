const WS_URL = 'wss://ws.trade.polariumbroker.com/echo/websocket'; 
const fs = require('fs');
const path = require('path');

const HISTORICO_FILE = path.join(__dirname, '..', 'historico_sinais.json');

let sdk;
let mainWindowRef;
let isBuscando = false;
let nivelRelaxamento = 0; 
let ultimoAtivoEncontrado = null; 

async function iniciarBot(window, tokenSsid) {
    mainWindowRef = window;
    if (!tokenSsid) return console.error("❌ Token não fornecido.");

    try {
        const sdkModule = await import('@quadcode-tech/client-sdk-js');
        const { ClientSdk, SsidAuthMethod, WsConnectionStateEnum, BinaryOptionsDirection } = sdkModule;

        sdk = await ClientSdk.create(WS_URL, 82, new SsidAuthMethod(tokenSsid));
        global.BinaryOptionsDirection = BinaryOptionsDirection;
        console.log("✅ SDK inicializado!");

        const wsConnectionState = await sdk.wsConnectionState();
        wsConnectionState.subscribeOnStateChanged((state) => {
            if (state === WsConnectionStateEnum.Authenticated) console.log("🔓 AUTENTICADO!");
        });
    } catch (error) {
        console.error("❌ Erro ao conectar:", error.message);
    }
}

// --- MATEMÁTICA DOS INDICADORES ---
function calcularRSI(closes, period = 14) {
    if (closes.length < period) return 50;
    let gains = 0, losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + (avgGain / avgLoss)));
}

function calcularADX(highs, lows, closes, period = 14) {
    if (closes.length < period) return { adx: 0, plusDI: 0, minusDI: 0 };
    let trs = [], plusDMs = [], minusDMs = [];
    for (let i = 1; i < closes.length; i++) {
        const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1]));
        trs.push(tr);
        const upMove = highs[i] - highs[i-1];
        const downMove = lows[i-1] - lows[i];
        plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
        minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }
    const avgTR = trs.slice(-period).reduce((a,b)=>a+b,0) / period;
    const avgPlusDM = plusDMs.slice(-period).reduce((a,b)=>a+b,0) / period;
    const avgMinusDM = minusDMs.slice(-period).reduce((a,b)=>a+b,0) / period;
    const plusDI = avgTR === 0 ? 0 : (avgPlusDM / avgTR) * 100;
    const minusDI = avgTR === 0 ? 0 : (avgMinusDM / avgTR) * 100;
    const dx = (plusDI + minusDI) === 0 ? 0 : Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100;
    return { adx: dx, plusDI, minusDI };
}

// --- SALVAR HISTÓRICO ---
function salvarHistorico(sinal) {
    let historico = [];
    if (fs.existsSync(HISTORICO_FILE)) {
        try {
            historico = JSON.parse(fs.readFileSync(HISTORICO_FILE, 'utf-8'));
        } catch (e) { historico = []; }
    }

    const novoRegistro = {
        id: Date.now(),
        data_hora: new Date().toISOString(),
        ativo: sinal.ativo,
        direcao: sinal.direcao,
        timeframe: sinal.timeframe,
        confirmacao: parseFloat(sinal.confianca.replace('%', '')),
        rsi: parseFloat(sinal.rsi),
        adx: parseFloat(sinal.adx),
        estrategia: sinal.estrategia,
        horario_entrada: sinal.horario
    };

    historico.unshift(novoRegistro); // Adiciona no topo
    if (historico.length > 100) historico.pop(); // Mantém os últimos 100

    fs.writeFileSync(HISTORICO_FILE, JSON.stringify(historico, null, 2));
}

// --- ANÁLISE PROFISSIONAL E ASSERTIVA ---
async function analisarAtivo(active) {
    try {
        const layerM1 = await sdk.realTimeChartDataLayer(active.id, 60);
        const candlesM1 = await layerM1.fetchAllCandles(Math.floor(Date.now() / 1000) - (15 * 60)); 

        const layerM5 = await sdk.realTimeChartDataLayer(active.id, 300);
        const candlesM5 = await layerM5.fetchAllCandles(Math.floor(Date.now() / 1000) - (60 * 60)); 

        if (!candlesM1 || candlesM1.length < 5 || !candlesM5 || candlesM5.length < 5) return null;

        const closesM1 = candlesM1.map(c => c.close);
        const highsM1 = candlesM1.map(c => c.max);
        const lowsM1 = candlesM1.map(c => c.min);
        const volumesM1 = candlesM1.map(c => c.volume);

        const closesM5 = candlesM5.map(c => c.close);
        const highsM5 = candlesM5.map(c => c.max);
        const lowsM5 = candlesM5.map(c => c.min);

        const rsiM1 = calcularRSI(closesM1);
        const { adx: adxM5, plusDI: plusDI_M5, minusDI: minusDI_M5 } = calcularADX(highsM5, lowsM5, closesM5);

        const ultimaVela = candlesM1[candlesM1.length - 1];
        
        const volumeMedio = volumesM1.slice(-10).reduce((a,b)=>a+b,0) / 10;
        const volumeForte = ultimaVela.volume > (volumeMedio * 1.2);

        const corpo = Math.abs(ultimaVela.close - ultimaVela.open);
        const pavioInferior = Math.min(ultimaVela.open, ultimaVela.close) - ultimaVela.min;
        const pavioSuperior = ultimaVela.max - Math.max(ultimaVela.open, ultimaVela.close);
        const tamanhoTotal = ultimaVela.max - ultimaVela.min;

        const velaForte = tamanhoTotal > 0 && (corpo / tamanhoTotal) > 0.4; 
        const rejeicaoCompra = pavioInferior > corpo; 
        const rejeicaoVenda = pavioSuperior > corpo;  

        let direcao = null;
        let estrategia = "";
        let score = 0;

        // --- CÁLCULO DE SCORE MATEMÁTICO (IGUAL AO SITE) ---
        if (adxM5 > 20 && plusDI_M5 > minusDI_M5) {
            if (rsiM1 < 40 && volumeForte && velaForte && rejeicaoCompra) {
                direcao = "CALL";
                estrategia = "Macro Alta + RSI Baixo + Pavio de Rejeição";
                
                // Fórmula do Score baseada na força dos indicadores
                const forcaTendencia = Math.min(100, adxM5);
                const forcaRsi = 40 - rsiM1;
                const forcaPavio = (pavioInferior / tamanhoTotal) * 100;
                
                score = Math.floor(70 + (forcaTendencia * 0.1) + (forcaRsi * 0.5) + (forcaPavio * 0.1));
                score = Math.min(99, score); // Limita a 99%
            }
        } else if (adxM5 > 20 && minusDI_M5 > plusDI_M5) {
            if (rsiM1 > 60 && volumeForte && velaForte && rejeicaoVenda) {
                direcao = "PUT";
                estrategia = "Macro Baixa + RSI Alto + Pavio de Rejeição";
                
                const forcaTendencia = Math.min(100, adxM5);
                const forcaRsi = rsiM1 - 60;
                const forcaPavio = (pavioSuperior / tamanhoTotal) * 100;
                
                score = Math.floor(70 + (forcaTendencia * 0.1) + (forcaRsi * 0.5) + (forcaPavio * 0.1));
                score = Math.min(99, score);
            }
        }

        // Modo Relaxado
        if (!direcao && nivelRelaxamento > 0) {
            if (rsiM1 < 45) { direcao = "CALL"; estrategia = "Reversão (Relaxado)"; score = 70; }
            else if (rsiM1 > 55) { direcao = "PUT"; estrategia = "Reversão (Relaxado)"; score = 70; }
        }

        if (!direcao) return null;

        const proximoMinuto = Math.floor(Date.now() / 60000) * 60000 + 60000;
        const horaEntrada = new Date(proximoMinuto).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        return {
            ativo: active.ticker,
            direcao: direcao,
            rsi: rsiM1.toFixed(1),
            adx: adxM5.toFixed(1),
            score: score,
            estrategia: estrategia,
            horario: horaEntrada, 
            precoAtual: closesM1[closesM1.length - 1].toFixed(5)
        };

    } catch (e) {
        return null;
    }
}

const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function buscarAnaliseManual(config) {
    if (!sdk || isBuscando) return;
    isBuscando = true;
    console.log(`🔎 [SCANNER] Buscando Oportunidade...`);
    
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        mainWindowRef.webContents.send('status-busca', { status: 'carregando' });
    }

    try {
        const binaryOptions = await sdk.binaryOptions();
        const actives = binaryOptions.getActives();
        
        let ativosFiltrados = actives.filter(a => {
            const isOtc = config.mercado === 'OTC' ? a.ticker.includes('-OTC') : !a.ticker.includes('-OTC');
            const isAtivoPrincipal = a.ticker.includes('EUR') || a.ticker.includes('USD') || a.ticker.includes('GBP') || a.ticker.includes('BTC') || a.ticker.includes('XAU');
            return isOtc && isAtivoPrincipal;
        });

        if (ultimoAtivoEncontrado) {
            ativosFiltrados = ativosFiltrados.filter(a => a.ticker !== ultimoAtivoEncontrado);
        }

        while (isBuscando) {
            let melhoresSinais = [];
            ativosFiltrados.sort(() => 0.5 - Math.random());

            for (let i = 0; i < ativosFiltrados.length; i += 5) {
                if (!isBuscando) break; 
                const lote = ativosFiltrados.slice(i, i + 5);
                const resultadosLote = await Promise.all(lote.map(ativo => analisarAtivo(ativo)));
                melhoresSinais = melhoresSinais.concat(resultadosLote.filter(r => r !== null));
            }

            if (melhoresSinais.length > 0) {
                melhoresSinais.sort((a, b) => b.score - a.score);
                const campeao = melhoresSinais[0];
                
                ultimoAtivoEncontrado = campeao.ativo;

                const sinalFinal = {
                    ativo: campeao.ativo.replace("-OTC", "") + (config.mercado === 'OTC' ? " (OTC)" : ""),
                    direcao: campeao.direcao,
                    timeframe: "M1",
                    confianca: `${campeao.score}%`,
                    score: campeao.score,
                    rsi: campeao.rsi,
                    adx: campeao.adx,
                    estrategia: campeao.estrategia,
                    precoAtual: campeao.precoAtual,
                    horario: campeao.horario 
                };

                // SALVA NO HISTÓRICO
                salvarHistorico(sinalFinal);

                console.log(`🏆 ALVO: ${sinalFinal.ativo} | ${sinalFinal.direcao} | Entrar às: ${sinalFinal.horario} | Score: ${campeao.score}%`);
                if (mainWindowRef && !mainWindowRef.isDestroyed()) mainWindowRef.webContents.send('novo-sinal', sinalFinal);
                
                isBuscando = false; 
                break; 
            }

            if (isBuscando) {
                console.log("⚠️ Nenhum ativo com confluência. Retentando...");
                await esperar(10000); 
            }
        }
    } catch (error) {
        console.error("❌ Erro no scanner:", error.message);
        isBuscando = false;
    }
}

async function executarOrdemReal(dados) {
    if (!sdk) return;
    try {
        console.log(`🚀 [REAL] Enviando ordem: ${dados.ativo} | ${dados.direcao}`);
        const binaryOptions = await sdk.binaryOptions();
        const actives = binaryOptions.getActives();
        const tickerBase = dados.ativo.replace("/", "").replace(" (OTC)", "");
        const active = actives.find(a => a.ticker === tickerBase || a.ticker === tickerBase + "-OTC");
        if (!active) return console.log(`❌ Ativo não encontrado.`);

        const now = sdk.currentTime();
        const instrument = (await active.instruments()).getAvailableForBuyAt(now).find(inst => {
            const diff = (inst.expiration - now) / 1000;
            return diff >= 55 && diff <= 62; 
        });

        if (!instrument) return console.log(`❌ Vela M1 indisponível.`);

        const balances = await sdk.balances();
        const balance = balances.getBalances().find(b => b.type === 'demo') || balances.getBalances()[0];
        const direction = dados.direcao === "PUT" ? global.BinaryOptionsDirection.Put : global.BinaryOptionsDirection.Call;

        const option = await binaryOptions.buy(instrument, direction, 5, balance);
        console.log(`✅ [REAL] ORDEM ENVIADA! ID: ${option.id}`);
    } catch (error) {
        console.error("❌ Falha na ordem:", error.message);
    }
}

function pararBusca() { if (isBuscando) { isBuscando = false; console.log("🛑 Cancelado."); } }
function aumentarRelaxamento() { if (nivelRelaxamento < 3) { nivelRelaxamento++; console.log(`⚠️ Estratégia Relaxada: Nível ${nivelRelaxamento}`); } }
function resetarFiltros() { nivelRelaxamento = 0; ultimoAtivoEncontrado = null; console.log("🧹 Filtros Resetados."); }

module.exports = { iniciarBot, executarOrdemReal, buscarAnaliseManual, pararBusca, resetarFiltros, aumentarRelaxamento };