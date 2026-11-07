const WS_URL = 'wss://ws.trade.polariumbroker.com/echo/websocket'; 

let sdk;
let isBuscando = false;
let ultimoAtivoEnviado = null;
let tempoUltimoEnvio = 0;

async function iniciarBotServidor(window, tokenSsid) {
    if (!tokenSsid) return console.error("❌ Token não configurado.");

    console.log("⏳ Iniciando SDK no servidor (Modo Ultimate)...");
    try {
        const sdkModule = await import('@quadcode-tech/client-sdk-js');
        const { ClientSdk, SsidAuthMethod, BinaryOptionsDirection } = sdkModule;

        sdk = await ClientSdk.create(WS_URL, 82, new SsidAuthMethod(tokenSsid));
        global.BinaryOptionsDirection = BinaryOptionsDirection;
        
        console.log("✅ SDK inicializado! Iniciando Estratégias Combinadas...");
        
        // Roda a cada 30 segundos
        setInterval(async () => {
            if (!isBuscando) {
                await buscarAnaliseServidor();
            }
        }, 30000);

    } catch (error) {
        console.error("❌ Erro ao conectar no servidor:", error.message);
    }
}

// --- MATEMÁTICA DOS INDICADORES ---
function calcularEMA(dados, period) {
    if (dados.length < period) return dados[dados.length - 1];
    const k = 2 / (period + 1);
    let ema = dados.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < dados.length; i++) {
        ema = dados[i] * k + ema * (1 - k);
    }
    return ema;
}

function calcularSMA(dados, period) {
    if (dados.length < period) return 0;
    const slice = dados.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
}

// --- VARREDURA ---
async function buscarAnaliseServidor() {
    if (!sdk) return;
    isBuscando = true;
    console.log(`🔎 [SERVIDOR] Buscando confluência (EMA + Engolfo + Volume)...`);
    
    try {
        const binaryOptions = await sdk.binaryOptions();
        const actives = binaryOptions.getActives();
        
        let ativosFiltrados = actives.filter(a => a.ticker.includes('-OTC'));
        let melhoresSinais = [];

        for (let i = 0; i < ativosFiltrados.length; i += 5) {
            const lote = ativosFiltrados.slice(i, i + 5);
            const resultadosLote = await Promise.all(lote.map(ativo => analisarAtivoServidor(ativo)));
            melhoresSinais = melhoresSinais.concat(resultadosLote.filter(r => r !== null));
        }

        if (melhoresSinais.length > 0) {
            melhoresSinais.sort((a, b) => b.score - a.score);
            const campeao = melhoresSinais[0];
            
            const agora = Date.now();
            if (campeao.ativo === ultimoAtivoEnviado && (agora - tempoUltimoEnvio) < 60000) {
                console.log(`⏳ [IGNORADO] ${campeao.ativo} (Aguardando nova vela)`);
            } else {
                ultimoAtivoEnviado = campeao.ativo;
                tempoUltimoEnvio = agora;
                console.log(`🏆 [SINAL ULTIMATE] ${campeao.ativo} | ${campeao.direcao} | Confiança: ${campeao.score}% | Estratégia: ${campeao.estrategia} | Hora: ${campeao.horario}`);
            }
        } else {
            console.log("⚠️ Nenhuma confluência forte encontrada no momento.");
        }
    } catch (error) {
        console.error("❌ Erro na varredura:", error.message);
    } finally {
        isBuscando = false;
    }
}

// --- ANÁLISE DE ATIVO (A FUSÃO DAS ESTRATÉGIAS) ---
async function analisarAtivoServidor(active) {
    try {
        const layerM1 = await sdk.realTimeChartDataLayer(active.id, 60);
        // Pega 250 candles para as médias longas
        const candles = await layerM1.fetchAllCandles(Math.floor(Date.now() / 1000) - (250 * 60)); 

        if (!candles || candles.length < 210) return null;

        const closes = candles.map(c => c.close);
        const opens = candles.map(c => c.open);
        const highs = candles.map(c => c.max);
        const lows = candles.map(c => c.min);
        const volumes = candles.map(c => c.volume);
        const hlc3 = candles.map(c => (c.max + c.min + c.close) / 3);

        const atual = candles[candles.length - 1];
        const anterior = candles[candles.length - 2];
        const close3 = closes[closes.length - 4];

        // --- 1. INDICADORES DA ESTRATÉGIA DE TENDÊNCIA (EMA) ---
        const emaa = calcularEMA(closes, 21);
        const emab = calcularEMA(closes, 200);
        const emac_atual = calcularEMA(hlc3, 14);
        const emad_atual = calcularEMA(hlc3, 34);
        const emac_ant = calcularEMA(hlc3.slice(0, -1), 14);
        const emad_ant = calcularEMA(hlc3.slice(0, -1), 34);

        const ENC = (emac_ant < emad_ant) && (emac_atual > emad_atual);
        const ENV = (emac_ant > emad_ant) && (emac_atual < emad_atual);

        // --- 2. INDICADORES DA ESTRATÉGIA WYCKOFF/ENGOLFO ---
        const ma9 = calcularSMA(closes, 9);
        const ma21 = calcularSMA(closes, 21);
        
        // Engolfo de Alta: Vela anterior vermelha, atual verde e fecha acima da máxima da anterior
        const engolfo_alta = (atual.close > atual.open) && (anterior.close < anterior.open) && (atual.close > anterior.max);
        // Engolfo de Baixa: Vela anterior verde, atual vermelha e fecha abaixo da mínima da anterior
        const engolfo_baixa = (atual.close < atual.open) && (anterior.close > anterior.open) && (atual.close < anterior.min);

        // --- 3. INDICADOR DE VOLUME (EFRAIM) ---
        // Média de volume das últimas 10 velas (excluindo a atual)
        const volumeMedio = calcularSMA(volumes.slice(0, -1), 10);
        const volumeForte = atual.volume > (volumeMedio * 1.2); // Volume 20% acima da média

        let direcao = null;
        let score = 0;
        let estrategiaFinal = "";

        // --- CONFLUÊNCIA DE ALTA (COMPRA) ---
        const tendenciaAlta = ENC && (atual.close > emab) && (emac_atual > emad_atual) && (atual.close > close3);
        const reversaoAlta = engolfo_alta && (ma9 > ma21);

        if (tendenciaAlta && reversaoAlta && volumeForte) {
            direcao = "CALL";
            score = 98;
            estrategiaFinal = "EMA + Engolfo + Wyckoff + Volume";
        }

        // --- CONFLUÊNCIA DE BAIXA (VENDA) ---
        const tendenciaBaixa = ENV && (atual.close < emab) && (emac_atual < emad_atual) && (atual.close < close3);
        const reversaoBaixa = engolfo_baixa && (ma9 < ma21);

        if (tendenciaBaixa && reversaoBaixa && volumeForte) {
            direcao = "PUT";
            score = 98;
            estrategiaFinal = "EMA + Engolfo + Wyckoff + Volume";
        }

        if (!direcao) return null;

        const proximoMinuto = Math.floor(Date.now() / 60000) * 60000 + 60000;
        const horaEntrada = new Date(proximoMinuto).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        return {
            ativo: active.ticker,
            direcao: direcao,
            score: score,
            estrategia: estrategiaFinal,
            horario: horaEntrada
        };

    } catch (e) {
        return null; 
    }
}

module.exports = { iniciarBotServidor };