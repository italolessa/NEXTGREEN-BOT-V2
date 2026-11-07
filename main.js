process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const Store = require('electron-store');

const store = new Store();
app.commandLine.appendSwitch('ignore-certificate-errors');

let mainWindow, loginWindow, welcomeWindow, pollingInterval;
const SESSION_FILE = path.join(app.getPath('userData'), 'sessao.json');
const RENDER_URL = 'https://nextgreen-bot-v2.onrender.com'; // COLOQUE SUA URL AQUI

function iniciarPollingSinais() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(async () => {
        try {
            const resposta = await axios.get(`${RENDER_URL}/api/sinais`);
            if (resposta.data && resposta.data.length > 0) {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('novo-sinal', resposta.data[0]);
                }
            }
        } catch (e) {}
    }, 5000);
}

function createWelcomeWindow() {
    welcomeWindow = new BrowserWindow({ width: 400, height: 600, resizable: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
    welcomeWindow.loadFile('login.html');
    welcomeWindow.on('closed', () => { if (!mainWindow || mainWindow.isDestroyed()) app.quit(); });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({ width: 1200, height: 800, resizable: true, show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => { mainWindow.show(); iniciarPollingSinais(); });
}

function abrirJanelaLogin(dadosLogin) {
    session.defaultSession.clearStorageData({ storages: ['cookies', 'localstorage'] });
    loginWindow = new BrowserWindow({ width: 500, height: 700, title: "Login Polarium", webPreferences: { nodeIntegration: false, contextIsolation: true } });
    loginWindow.webContents.session.setCertificateVerifyProc((req, cb) => cb(0));
    loginWindow.loadURL('https://trade.polariumbroker.com/traderoom');

    loginWindow.webContents.on('did-navigate', async (event, url) => {
        if (url.includes('/traderoom')) {
            try {
                const cookies = await loginWindow.webContents.session.cookies.get({ domain: '.polariumbroker.com' });
                const tokenCookie = cookies.find(c => c.name.includes('ssid'));
                if (tokenCookie) {
                    fs.writeFileSync(SESSION_FILE, JSON.stringify({ ssid: tokenCookie.value }), 'utf-8');
                    if (dadosLogin.lembrar) store.set('tokenSalvo', tokenCookie.value); else store.delete('tokenSalvo');
                    if (loginWindow) loginWindow.close();
                    if (welcomeWindow) welcomeWindow.close();
                    createMainWindow();
                }
            } catch (err) {}
        }
    });
}

app.whenReady().then(() => createWelcomeWindow());

ipcMain.on('verificar-login-salvo', (event) => welcomeWindow?.webContents.send('status-login-salvo', store.has('tokenSalvo')));
ipcMain.on('iniciar-login', (event, dados) => abrirJanelaLogin(dados));
ipcMain.on('login-automatico', () => { if (welcomeWindow) welcomeWindow.close(); createMainWindow(); });
ipcMain.on('fazer-logout', () => { store.delete('tokenSalvo'); if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE); if (mainWindow) mainWindow.close(); createWelcomeWindow(); });

// Envia a configuração para o Render
ipcMain.on('configurar-busca', async (event, config) => {
    try {
        await axios.post(`${RENDER_URL}/api/configurar`, config);
        if (mainWindow) mainWindow.webContents.send('config-salva');
    } catch (e) { console.log("Erro ao enviar config:", e.message); }
});