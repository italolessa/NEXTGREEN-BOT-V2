process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const Store = require('electron-store');

const store = new Store();
app.commandLine.appendSwitch('ignore-certificate-errors');

let mainWindow;
let loginWindow;
let welcomeWindow;
let pollingInterval;
let buscandoAtivamente = false; // NOVO: Trava para saber se está buscando
const SESSION_FILE = path.join(app.getPath('userData'), 'sessao.json');
const RENDER_URL = 'https://nextgreen-bot-v2.onrender.com'; // SUA URL AQUI

function iniciarPollingSinais() {
    // Se já estiver buscando, não faz nada
    if (pollingInterval) clearInterval(pollingInterval);
    
    pollingInterval = setInterval(async () => {
        // SÓ busca se estiver no modo ativo
        if (!buscandoAtivamente) return; 

        try {
            const resposta = await axios.get(`${RENDER_URL}/api/sinais`);
            if (resposta.data && resposta.data.length > 0) {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('novo-sinal', resposta.data[0]);
                    buscandoAtivamente = false; // Para de buscar depois de achar um sinal
                }
            }
        } catch (error) {}
    }, 3000); // Checa a cada 3 segundos (mais rápido)
}

function createWelcomeWindow() {
    welcomeWindow = new BrowserWindow({
        width: 400, height: 600, resizable: false, autoHideMenuBar: true,
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
    });
    welcomeWindow.loadFile('login.html');
    welcomeWindow.on('closed', () => { if (!mainWindow || mainWindow.isDestroyed()) app.quit(); });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, resizable: true, autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  
  mainWindow.loadFile('index.html');
  
  mainWindow.once('ready-to-show', () => {
      mainWindow.show();
      iniciarPollingSinais(); // Inicia o loop, mas ele está travado pelo buscandoAtivamente = false
  });
}

function abrirJanelaLogin(dadosLogin) {
    session.defaultSession.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb'] });
    loginWindow = new BrowserWindow({ width: 500, height: 700, autoHideMenuBar: true, webPreferences: { contextIsolation: true } });
    loginWindow.webContents.session.setCertificateVerifyProc((req, cb) => cb(0));
    loginWindow.loadURL('https://trade.polariumbroker.com/traderoom');

    loginWindow.webContents.on('did-navigate', async (event, url) => {
        if (url.includes('/traderoom')) {
            try {
                const cookies = await loginWindow.webContents.session.cookies.get({ domain: '.polariumbroker.com' });
                const tokenCookie = cookies.find(c => c.name.includes('ssid'));
                if (tokenCookie) {
                    fs.writeFileSync(SESSION_FILE, JSON.stringify({ ssid: tokenCookie.value }), 'utf-8');
                    if (dadosLogin.lembrar) store.set('tokenSalvo', tokenCookie.value);
                    else store.delete('tokenSalvo');
                    if (loginWindow) loginWindow.close();
                    if (welcomeWindow) welcomeWindow.close();
                    createMainWindow();
                }
            } catch (err) { console.error(err); }
        }
    });
}

app.whenReady().then(() => { createWelcomeWindow(); });

ipcMain.on('verificar-login-salvo', (event) => welcomeWindow?.webContents.send('status-login-salvo', store.has('tokenSalvo')));
ipcMain.on('iniciar-login', (event, dados) => abrirJanelaLogin(dados));
ipcMain.on('login-automatico', () => { if (welcomeWindow) welcomeWindow.close(); createMainWindow(); });

// NOVO: Quando o usuário clica em "Ativar Busca", envia a config E liga a trava para buscar
ipcMain.on('configurar-busca', async (event, config) => {
    buscandoAtivamente = true; // Liga a busca
    try {
        // Envia a config e limpa os sinais antigos
        await axios.post(`${RENDER_URL}/api/configurar`, config);
        if (mainWindow) mainWindow.webContents.send('config-salva');
    } catch (e) { console.log("Erro ao enviar config:", e.message); }
});

ipcMain.on('fazer-logout', async () => {
    store.delete('tokenSalvo');
    if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
    if (mainWindow) mainWindow.close();
    await session.defaultSession.clearStorageData({ storages: ['cookies', 'localstorage'] });
    createWelcomeWindow();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });