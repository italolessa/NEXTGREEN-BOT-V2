const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

let sinaisEncontrados = [];
let sinalEntregue = false;

global.configuracaoAtual = { timeframe: 'M1', mercado: 'OTC', ignorarAtivo: null };
global.buscando = false;

app.get('/health', (req, res) => res.status(200).send('OK'));

app.post('/api/configurar', (req, res) => {
    sinaisEncontrados = [];
    sinalEntregue = false;
    global.configuracaoAtual = req.body;
    global.buscando = true;
    
    console.log(`⚙️ Nova busca. Ignorando: ${global.configuracaoAtual.ignorarAtivo || 'Nenhum'} | Mercado: ${global.configuracaoAtual.mercado}`);
    res.json({ success: true });
});

app.get('/api/sinais', (req, res) => {
    // Se já entregou, retorna vazio para o app não receber de novo
    if (sinalEntregue) return res.json([]);
    res.json(sinaisEncontrados);
});

global.adicionarSinal = (sinal) => {
    // Comparação EXATA (não includes) para evitar falso positivo
    const ignorar = global.configuracaoAtual.ignorarAtivo;
    if (ignorar) {
        const ativoLimpo = sinal.ativo.replace("-OTC", "").replace(" (OTC)", "").replace("/", "");
        const ignorarLimpo = ignorar.replace("-OTC", "").replace(" (OTC)", "").replace("/", "");
        
        if (ativoLimpo === ignorarLimpo) {
            console.log(`⏳ [IGNORADO] ${sinal.ativo} (mesmo ativo da busca anterior)`);
            return; // NÃO desliga global.buscando, continua procurando
        }
    }
    
    // Filtro de mercado
    const mercado = global.configuracaoAtual.mercado;
    const isOtc = sinal.ativo.includes('-OTC');
    if (mercado === 'OTC' && !isOtc) {
        console.log(`⏳ [IGNORADO] ${sinal.ativo} (mercado != OTC)`);
        return;
    }
    if (mercado === 'ABERTO' && isOtc) {
        console.log(`⏳ [IGNORADO] ${sinal.ativo} (mercado != ABERTO)`);
        return;
    }
    
    sinaisEncontrados = [sinal];
    sinalEntregue = false; // ainda não foi lido
    global.buscando = false;
    console.log(`✅ [ENVIADO] ${sinal.ativo} ${sinal.direcao}`);
};

const { iniciarBotServidor } = require('./backend/bot_servidor');
const tokenPolarium = process.env.POLARIUM_TOKEN || 'COLE_SEU_TOKEN_AQUI';
if (tokenPolarium) iniciarBotServidor(null, tokenPolarium);

app.listen(port, () => console.log(`✅ Servidor API rodando na porta ${port}`));