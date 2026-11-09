const WS_URL = 'wss://ws.trade.polariumbroker.com/echo/websocket'; 
let sdk;
let isBuscando = false;
let ultimoAtivoEnviado = null;
let configSolicitada = { timeframe: 'M1', mercado: 'OTC' };
let ativosIgnoradosLista = [];
let sinaisParaAvaliar = [];

// LISTA NEGRA: Ações e Índices
const ACOES_E_INDICES_PROIBIDOS = [
    'AAPL', 'APPLE', 'MSFT', 'MICROSOFT', 'TSLA', 'TESLA', 'AMZN', 'AMAZON', 
    'GOOGL', 'GOOGLE', 'META', 'FACEBOOK', 'NFLX', 'NETFLIX', 'NVDA', 'NVIDIA', 
    'INTC', 'INTEL', 'IBM', 'FORD', 'OPENAI', 'SPACEX', 'ANTHROPIC', 'DAX', 
    'S&P', 'SP500', 'NASDAQ', 'US100', 'US30', 'DOWJONES', 'JP225', 
    'COCA', 'PEPSI', 'MCDONALD', 'BOEING', 'PFIZER', 'JOHNSON'
];

global.definirConfiguracao = (config) => {
    configSolicitada = config;
    console.log(`🤖 Cérebro atualizado: Foco em ${config.timeframe} | Mercado ${config.mercado}`);
};

global.resetarAtivos = () => {
    ativosIgnoradosLista = [];
    ultimoAtivoEnviado = null;
};

async function iniciarBotServidor(window, tokenSsid) {
    if (!tokenSsid) return console.error("❌ Token não configurado.");
    console.log("⏳ Iniciando SDK no servidor...");
    try {
        const sdkModule = await import('@quadcode-tech/client-sdk-js');
        const { ClientSdk, SsidAuthMethod, BinaryOptionsDirection } = sdkModule;
        sdk = await ClientSdk.create(WS_URL, 82, new SsidAuthMethod(tokenSsid));
        global.BinaryOptionsDirection = BinaryOptionsDirection;

        console.log("✅ SDK inicializado! Cérebro Flexível (Mais Sinais) ativo.");

        setInterval(async () => {
            if (!isBuscando && global.buscando) {
                await buscarAnaliseServidor();
            }
        }, 5000); 

        setInterval(async () => {
            await verificarResultados();
        }, 10000); 

    } catch (error) {
        console.error("❌ Erro ao conectar no servidor:", error.message);
    }
}

// --- MATEMÁTICA DOS INDICADORES ---
function calcularEMA(dados, period) {
    if (dados.length < period) return dados[dados.length - 1];
    const k = 2 / (period + 1);
    let ema = dados.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < dados.length; i++) ema = dados[i] * k + ema * (1 - k);
    return ema;
}

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

// --- O CÉREBRO FLEXÍVEL (MAIS SINAIS) ---
function analisarGraficoComEstrategias(candles) {
    const closes = candles.map(c => c.close);
    const rsi = calcularRSI(closes);
    const ema9 = calcularEMA(closes, 9);
    const ema21 = calcularEMA(closes, 21);
    
    const atual = candles[candles.length - 1];
    const anterior = candles[candles.length - 2];

    const corpo = Math.abs(atual.close - atual.open);
    const pavioSuperior = atual.max - Math.max(atual.open, atual.close);
    const pavioInferior = Math.min(atual.open, atual.close) - atual.min;

    // ESTRATÉGIA 1: REVERSÃO (RSI + PAVIO) - FILTROS RELAXADOS
    // RSI < 40 (em vez de 35) e pavio apenas maior que o corpo (em vez de 1.5x)
    if (rsi < 40 && pavioInferior > corpo) {
        return { 
            direcao: "CALL", 
            estrategia: "Reversão (RSI + Pavio)", 
            confianca: 88 
        };
    }
    if (rsi > 60 && pavioSuperior > corpo) {
        return { 
            direcao: "PUT", 
            estrategia: "Reversão (RSI + Pavio)", 
            confianca: 88 
        };
    }

    // ESTRATÉGIA 2: TENDÊNCIA (EMAs) - SE O RSI NÃO ESTIVER NOS EXTREMOS
    // Se a EMA9 > EMA21 e a vela atual for de alta, compra (mesmo com RSI neutro)
    if (ema9 > ema21 && atual.close > atual.open && rsi > 50) {
        return { 
            direcao: "CALL", 
            estrategia: "Tendência (EMA 9/21)", 
            confianca: 85 
        };
    }
    if (ema9 < ema21 && atual.close < atual.open && rsi < 50) {
        return { 
            direcao: "PUT", 
            estrategia: "Tendência (EMA 9/21)", 
            confianca: 85 
        };
    }
    
    return null;
}

async function buscarAnaliseServidor() {
    if (!sdk || !global.buscando) return;
    isBuscando = true;

    try {
        const binaryOptions = await sdk.binaryOptions();
        const actives = binaryOptions.getActives();
        const now = sdk.currentTime();

        let ativosFiltrados = actives.filter(a => {
            const mercadoOk = configSolicitada.mercado === 'OTC' ? a.ticker.includes('-OTC') : !a.ticker.includes('-OTC');
            const estaAberto = a.canBeBoughtAt(now);
            const jaFoiMostrado = ativosIgnoradosLista.includes(a.ticker);
            
            let ehProibido = false;
            for (let palavra of ACOES_E_INDICES_PROIBIDOS) {
                if (a.ticker.toUpperCase().includes(palavra)) {
                    ehProibido = true;
                    break;
                }
            }

            return mercadoOk && estaAberto && !jaFoiMostrado && !ehProibido;
        });

        if (ativosFiltrados.length === 0) {
            ativosIgnoradosLista = [];
            ativosFiltrados = actives.filter(a => {
                const mercadoOk = configSolicitada.mercado === 'OTC' ? a.ticker.includes('-OTC') : !a.ticker.includes('-OTC');
                let ehProibido = false;
                for (let palavra of ACOES_E_INDICES_PROIBIDOS) {
                    if (a.ticker.toUpperCase().includes(palavra)) { ehProibido = true; break; }
                }
                return mercadoOk && a.canBeBoughtAt(now) && !ehProibido;
            });
        }
        
        let melhoresSinais = [];

        for (let i = 0; i < ativosFiltrados.length; i += 10) {
            if (!global.buscando) break;
            const lote = ativosFiltrados.slice(i, i + 10);

            const res = await Promise.all(lote.map(async (ativo) => {
                const seconds = configSolicitada.timeframe === 'M5' ? 300 : 60;
                const layer = await sdk.realTimeChartDataLayer(ativo.id, seconds);
                const count = 30; 
                const candles = await layer.fetchAllCandles(Math.floor(Date.now() / 1000) - (count * seconds));

                if (!candles || candles.length < 20) return null;

                const resultado = analisarGraficoComEstrategias(candles);

                if (resultado) {
                    let nomeBonito = ativo.ticker.replace('-OTC', ' (OTC)');
                    return {
                        ativo: nomeBonito,
                        tickerReal: ativo.ticker,
                        timeframe: configSolicitada.timeframe,
                        direcao: resultado.direcao,
                        confianca: resultado.confianca,
                        estrategia: resultado.estrategia,
                        mercado: configSolicitada.mercado,
                        horario: getHoraProximaVela(),
                        id: Date.now(),
                        status: "PENDENTE"
                    };
                }
                return null;
            }));
            melhoresSinais = melhoresSinais.concat(res.filter(r => r !== null));
        }

        if (melhoresSinais.length > 0 && global.buscando) {
            melhoresSinais.sort((a, b) => b.confianca - a.confianca);
            const campeao = melhoresSinais[0];
            
            const agora = new Date();
            const segundosRestantes = 60 - agora.getSeconds();
            
            if (segundosRestantes >= 10) {
                ativosIgnoradosLista.push(campeao.tickerReal);
                ultimoAtivoEnviado = campeao.tickerReal;
                console.log(`\n🏆 [SINAL] ${campeao.ativo} | ${campeao.direcao} | ${campeao.estrategia} | Entrada: ${campeao.horario}`);
                
                sinaisParaAvaliar.push(campeao); 
                
                if (global.adicionarSinal) global.adicionarSinal(campeao);
            }
        }
    } catch (error) {
        console.error("❌ Erro na varredura:", error.message);
    } finally {
        isBuscando = false;
    }
}

// --- AUTO-AVALIAÇÃO ---
async function verificarResultados() {
    if (!sdk || sinaisParaAvaliar.length === 0) return;
    const agora = new Date();
    if (agora.getSeconds() > 10) return; 

    const sinaisParaRemover = [];
    for (let i = 0; i < sinaisParaAvaliar.length; i++) {
        const sinal = sinaisParaAvaliar[i];
        try {
            const seconds = sinal.timeframe === 'M5' ? 300 : 60;
            const layer = await sdk.realTimeChartDataLayer(sinal.tickerReal, seconds);
            const candles = await layer.fetchAllCandles(Math.floor(Date.now() / 1000) - (5 * seconds));

            if (candles && candles.length >= 2) {
                const velaFechada = candles[candles.length - 2];
                let result = "EMPATE";
                if (sinal.direcao === "CALL" || sinal.direcao === "COMPRA") {
                    if (velaFechada.close > velaFechada.open) result = "WIN";
                    else if (velaFechada.close < velaFechada.open) result = "LOSS";
                } else if (sinal.direcao === "PUT" || sinal.direcao === "VENDA") {
                    if (velaFechada.close < velaFechada.open) result = "WIN";
                    else if (velaFechada.close > velaFechada.open) result = "LOSS";
                }

                sinal.status = result;
                console.log(`📊 [RESULTADO] ${sinal.ativo} | ${sinal.direcao} | ${result}`);
                if (global.adicionarSinal) global.adicionarSinal(sinal);
                sinaisParaRemover.push(i);
            }
        } catch (e) {
            sinaisParaRemover.push(i);
        }
    }

    for (let i = sinaisParaRemover.length - 1; i >= 0; i--) {
        sinaisParaAvaliar.splice(sinaisParaRemover[i], 1);
    }
}

function getHoraProximaVela() {
    const agora = new Date();
    const proximoMinuto = Math.floor(agora.getTime() / 60000) * 60000 + 60000;
    return new Date(proximoMinuto).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

module.exports = { iniciarBotServidor };