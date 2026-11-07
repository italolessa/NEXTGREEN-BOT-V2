const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

let sinaisEncontrados = []; // Memória dos sinais
let buscando = false; // NOVO: Trava para o bot só procurar quando ativado

app.get('/health', (req, res) => res.status(200).send('OK'));

app.post('/api/configurar', (req, res) => {
    sinaisEncontrados = []; // Limpa os sinais antigos ao ativar nova busca
    buscando = true; 
    res.json({ success: true });
});

app.get('/api/sinais', (req, res) => res.json(sinaisEncontrados));

global.adicionarSinal = (sinal) => {
    if (!buscando) return; // Só salva se estiver no modo busca
    sinaisEncontrados.unshift(sinal);
    buscando = false; // Para de buscar após achar o primeiro
    if (sinaisEncontrados.length > 50) sinaisEncontrados.pop();
};

const { iniciarBotServidor } = require('./backend/bot_servidor');
const tokenPolarium = process.env.POLARIUM_TOKEN || 'COLE_SEU_TOKEN_AQUI';
if (tokenPolarium) iniciarBotServidor(null, tokenPolarium);

app.listen(port, () => console.log(`✅ Servidor API rodando na porta ${port}`));