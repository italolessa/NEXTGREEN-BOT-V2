const WS_URL = 'wss://ws.trade.polariumbroker.com/echo/websocket'; 

let sdk;
let isBuscando = false;
let ultimoSinal = 0; // Trava: 1 = Compra, -1 = Venda, 0 = Neutro
let ultimoAtivoEnviado = null;
let tempoUltimoEnvio = 0;

async function iniciarBotServidor(window, tokenSsid) {
    if (!tokenSsid) return console.error("❌ Token não configurado.");

    console.log("⏳ Iniciando SDK no servidor...");
    try {
        const sdkModule = await import('@quadcode-tech/client-sdk-js');
        const { ClientSdk, SsidAuthMethod, BinaryOptionsDirection } = sdkModule;

        sdk = await ClientSdk.create(WS_URL, 82, new SsidAuthMethod(tokenSsid));
        global.BinaryOptionsDirection = BinaryOptionsDirection;
        
        console.log("✅ SDK inicializado! Iniciando Estratégia NextGreen Original (EMAs)...");
        
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

// --- MATEMÁTICA DAS MÉDIAS MÓVEIS EXPONENCIAIS (EMA) ---
function calcularEMA(dados, period) {
    if (dados.length < period) return dados[dados.length - 1];
    const k = 2 / (period + 1);
    let ema = dados.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < dados.length; i++) {
        ema = dados[i] * k + ema * (1 - k);
    }
    return ema;
}

// --- VARREDURA ---
async function buscarAnaliseServidor() {
    if (!sdk) return;
    isBuscando = true;
    console.log(`🔎 [SERVIDOR] Buscando cruzamento de EMAs no mercado OTC...`);
    
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
            const campeao = melhoresSinais[0];
            const agora = Date.now();
            
            // Trava para não ficar repetindo o mesmo sinal na mesma vela
            if (campeao.ativo === ultimoAtivoEnviado && (agora - tempoUltimoEnvio) < 60000) {
                console.log(`⏳ [IGNORADO] ${campeao.ativo} (Aguardando nova vela)`);
            } else {
                ultimoAtivoEnviado = campeao.ativo;
                tempoUltimoEnvio = agora;
                console.log(`🏆 [SINAL ESTRATÉGIA ORIGINAL] ${campeao.ativo} | ${campeao.direcao} | Confiança: ${campeao.score}% | Hora: ${campeao.horario}`);
            }
        } else {
            console.log("⚠️ Nenhum cruzamento de EMA válido no momento.");
        }
    } catch (error) {
        console.error("❌ Erro na varredura:", error.message);
    } finally {
        isBuscando = false;
    }
}

// --- ANÁLISE COM A ESTRATÉGIA EXATA DO ARQUIVO ---
async function analisarAtivoServidor(active) {
    try {
        const layerM1 = await sdk.realTimeChartDataLayer(active.id, 60);
        // Pega 250 candles para calcular a EMA de 200 e os últimos movimentos
        const candlesM1 = await layerM1.fetchAllCandles(Math.floor(Date.now() / 1000) - (250 * 60)); 

        if (!candlesM1 || candlesM1.length < 210) return null;

        const closes = candlesM1.map(c => c.close);
        const highs = candlesM1.map(c => c.max);
        const lows = candlesM1.map(c => c.min);
        
        // HLC3 = (High + Low + Close) / 3
        const hlc3 = candlesM1.map(c => (c.max + c.min + c.close) / 3);

        const closeAtual = closes[closes.length - 1];
        const close3 = closes[closes.length - 4]; // Preço de 3 velas atrás

        // Cálculo das EMAs
        const emaa_atual = calcularEMA(closes, 21);
        const emab = calcularEMA(closes, 200); // Tendência Macro
        const emac_atual = calcularEMA(hlc3, 14);
        const emad_atual = calcularEMA(hlc3, 34);
        
        // EMAs do candle anterior para verificar o cruzamento
        const emac_anterior = calcularEMA(hlc3.slice(0, -1), 14);
        const emad_anterior = calcularEMA(hlc3.slice(0, -1), 34);

        // Condições de Cruzamento (O gatilho da estratégia)
        const ENC = (emac_anterior < emad_anterior) && (emac_atual > emad_atual);
        const ENV = (emac_anterior > emad_anterior) && (emac_atual < emad_atual);

        let direcao = null;
        let score = 0;

        // Regra de COMPRA
        const sinal_compra = ENC && 
                             (closeAtual > emab) &&       // Acima da média de 200
                             (emac_atual > emad_atual) && 
                             (closeAtual > close3);       // Subiu nos últimos 3 candles

        // Regra de VENDA
        const sinal_venda = ENV && 
                            (closeAtual < emab) &&        // Abaixo da média de 200
                            (emac_atual < emad_atual) && 
                            (closeAtual < close3);        // Caiu nos últimos 3 candles

        if (sinal_venda && ultimoSinal !== -1) {
            direcao = "PUT";
            score = 95;
            ultimoSinal = -1;
        } else if (sinal_compra && ultimoSinal !== 1) {
            direcao = "CALL";
            score = 95;
            ultimoSinal = 1;
        } else if (!sinal_compra && !sinal_venda) {
            ultimoSinal = 0; // Reseta a trava se não houver sinal
        }

        if (!direcao) return null;

        const proximoMinuto = Math.floor(Date.now() / 60000) * 60000 + 60000;
        const horaEntrada = new Date(proximoMinuto).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        return {
            ativo: active.ticker,
            direcao: direcao,
            rsi: 0, // Não usado nesta estratégia
            adx: 0, // Não usado nesta estratégia
            score: score,
            horario: horaEntrada
        };

    } catch (e) {
        return null; 
    }
}

module.exports = { iniciarBotServidor };