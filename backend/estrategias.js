const fs = require('fs');
const path = require('path');

// Funções auxiliares matemáticas
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
    return 100 - (100 / (1 + (gains / (losses || 1))));
}
function calcularADX(highs, lows, closes, period = 14) {
    if (closes.length < period) return { adx: 0 };
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

// ==========================================
// LEITOR DE ARQUIVOS TXT
// ==========================================
function carregarEstrategiasTXT() {
    const pasta = path.join(__dirname, '..', 'estrategias_txt');
    const estrategias = [];
    
    // Se a pasta não existir, usa as padrão
    if (!fs.existsSync(pasta)) {
        console.log("⚠️ Pasta 'estrategias_txt' não encontrada. Usando estratégias padrão.");
        return [];
    }

    const arquivos = fs.readdirSync(pasta);
    
    for (const arquivo of arquivos) {
        if (arquivo.endsWith('.txt')) {
            const caminho = path.join(pasta, arquivo);
            const conteudo = fs.readFileSync(caminho, 'utf-8');
            
            // Aqui o robô lê o texto. Você pode adicionar regras de busca dentro do texto
            // (Ex: se o txt tiver a palavra "engolfo", ele ativa a regra de engolfo)
            estrategias.push({
                nome: arquivo.replace('.txt', ''),
                conteudo: conteudo
            });
        }
    }
    return estrategias;
}

// ==========================================
// O JÚRI DE ESTRATÉGIAS (O QUE O ROBÔ EXECUTA)
// ==========================================
// Nota: Como o robô não consegue "adivinhar" a matemática complexa de um texto puro,
// nós criamos as regras de execução aqui, e o leitor de txt serve para você catalogar.
module.exports = {
    analisarGrafico: (candles) => {
        const closes = candles.map(c => c.close);
        const highs = candles.map(c => c.max);
        const lows = candles.map(c => c.min);
        const atual = candles[candles.length - 1];
        const anterior = candles[candles.length - 2];

        const rsi = calcularRSI(closes);
        const { adx } = calcularADX(highs, lows, closes);
        
        // --- ESTRATÉGIA 1: EMAs (Tendência) ---
        const hlc3 = candles.map(c => (c.max + c.min + c.close) / 3);
        const ema200 = calcularEMA(closes, 200);
        const ema14 = calcularEMA(hlc3, 14);
        const ema34 = calcularEMA(hlc3, 34);
        
        if (adx > 25) {
            if (ema14 > ema34 && atual.close > ema200) return { direcao: "CALL", estrategia: "EMAs (M5/M1)", confianca: 95 };
            if (ema14 < ema34 && atual.close < ema200) return { direcao: "PUT", estrategia: "EMAs (M5/M1)", confianca: 95 };
        }

        // --- ESTRATÉGIA 2: Engolfo (Reversão) ---
        const engolfoAlta = (atual.close > atual.open) && (anterior.close < anterior.open) && (atual.close > anterior.max);
        const engolfoBaixa = (atual.close < atual.open) && (anterior.close > anterior.open) && (atual.close < anterior.min);
        
        if (adx < 20) {
            if (engolfoAlta && rsi < 40) return { direcao: "CALL", estrategia: "Engolfo Wyckoff", confianca: 90 };
            if (engolfoBaixa && rsi > 60) return { direcao: "PUT", estrategia: "Engolfo Wyckoff", confianca: 90 };
        }

        // --- ESTRATÉGIA 3: RSI + Pavio (Fundo/Topo) ---
        const corpo = Math.abs(atual.close - atual.open);
        const pavioInferior = Math.min(atual.open, atual.close) - atual.min;
        const pavioSuperior = atual.max - Math.max(atual.open, atual.close);

        if (rsi < 30 && pavioInferior > corpo) return { direcao: "CALL", estrategia: "RSI + Pavio", confianca: 88 };
        if (rsi > 70 && pavioSuperior > corpo) return { direcao: "PUT", estrategia: "RSI + Pavio", confianca: 88 };

        // Se nada for encontrado, retorna null (Mercado Ruidoso)
        return null;
    }
};

console.log("📚 Estratégias carregadas:", carregarEstrategiasTXT().map(e => e.nome).join(", "));