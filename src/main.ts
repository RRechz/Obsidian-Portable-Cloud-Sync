import { App, Plugin, PluginSettingTab, Setting, Notice, TFile } from 'obsidian';
import * as ftp from 'basic-ftp';
import * as fs from 'fs';
import * as path from 'path';

// --- i18n (Internationalization) Dictionary ---
const i18n = {
    en: {
        uploadStarting: 'Upload starting...',
        uploadSuccess: (count: number) => `${count} .md file(s) uploaded to CloudStorage.`,
        uploadNoChanges: 'No new changes found to upload.',
        uploadError: 'Error (Upload): ',
        downloadStarting: 'Download starting...',
        folderNotFound: (folder: string) => `Target folder '${folder}' not found on the cloud server.`,
        downloadSuccess: (count: number) => `${count} .md file(s) downloaded and updated.`,
        downloadNoChanges: 'No new changes found to download.',
        downloadError: 'Error (Download): ',
        settingsTitle: 'Portable Cloud Sync',
        ftpHost: 'FTP Host',
        ftpPort: 'Port',
        ftpUser: 'Username',
        ftpPassword: 'Password',
        targetFolder: 'Target Folder',
        targetFolderDesc: 'The main folder on the server to store .md notes (e.g., Obsidian)',
        syncInterval: 'Sync Interval (min)',
        language: 'Language',
        languageDesc: 'Choose the plugin interface language. (Note: Command palette names require an app restart to update).',
        syncToCloudCmd: 'Sync to Cloud',
        syncFromCloudCmd: 'Sync from Cloud'
    },
    tr: {
        uploadStarting: 'Yükleme başlıyor...',
        uploadSuccess: (count: number) => `${count} .md dosyası CloudStorage sunucusuna yüklendi.`,
        uploadNoChanges: 'Yüklenecek yeni bir değişiklik bulunamadı.',
        uploadError: 'Hata (Yükleme): ',
        downloadStarting: 'İndirme başlıyor...',
        folderNotFound: (folder: string) => `Bulut sunucusunda '${folder}' adında bir klasör bulunamadı.`,
        downloadSuccess: (count: number) => `${count} .md dosyası indirildi ve güncellendi.`,
        downloadNoChanges: 'İndirilecek yeni bir değişiklik bulunamadı.',
        downloadError: 'Hata (İndirme): ',
        settingsTitle: 'Portable Cloud Sync Ayarları',
        ftpHost: 'FTP Sunucusu (Host)',
        ftpPort: 'Port',
        ftpUser: 'Kullanıcı Adı',
        ftpPassword: 'Şifre',
        targetFolder: 'Hedef Klasör',
        targetFolderDesc: 'Sunucuda .md notlarının barındırılacağı ana klasör (Örn: Obsidian)',
        syncInterval: 'Senkronizasyon Aralığı (dk)',
        language: 'Dil',
        languageDesc: 'Eklenti arayüz dilini seçin. (Not: Komut paletindeki isimlerin güncellenmesi için uygulamanın yeniden başlatılması gerekir).',
        syncToCloudCmd: 'Buluta Yükle',
        syncFromCloudCmd: 'Buluttan İndir'
    }
};

// --- Translation Helper ---
// Explicitly types the language and key to prevent TypeScript indexing errors.
const t = (lang: 'en' | 'tr', key: keyof typeof i18n['en'], arg?: any): string => {
    const langMap = i18n[lang] || i18n['en'];
    const value = langMap[key];
    
    if (typeof value === 'function') {
        // Force TypeScript to accept the dynamic function signature
        return (value as (arg: any) => string)(arg);
    }
    return value as string;
};

interface PluginSettings {
    ftpHost: string;
    ftpPort: number;
    ftpUser: string;
    ftpPassword: string;
    syncFolder: string;
    syncInterval: number;
    language: 'en' | 'tr'; // Language preference stored in settings
}

const DEFAULT_SETTINGS: PluginSettings = {
    ftpHost: '100.x.y.z',
    ftpPort: 2121,
    ftpUser: '',
    ftpPassword: '',
    syncFolder: 'Obsidian',
    syncInterval: 5,
    language: 'en'
};

export default class PortableCloudSync extends Plugin {
    settings: PluginSettings = DEFAULT_SETTINGS;
    private syncTimer: NodeJS.Timeout | null = null;
    
    // Mutex lock to prevent race conditions when sync intervals and manual syncs overlap
    private isSyncing: boolean = false;

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new PortableCloudSyncSettingTab(this.app, this));

        // Commands register with the language set at startup. 
        // Changes to the language will require an app restart for these palette names to update.
        this.addCommand({ 
            id: 'sync-to-cloud', 
            name: t(this.settings.language, 'syncToCloudCmd'), 
            callback: () => this.syncToCloud() 
        });
        
        this.addCommand({ 
            id: 'sync-from-cloud', 
            name: t(this.settings.language, 'syncFromCloudCmd'), 
            callback: () => this.syncFromCloud() 
        });

        this.startAutoSync();
    }

    async loadSettings() { 
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); 
    }
    
    async saveSettings() { 
        await this.saveData(this.settings); 
    }

    /**
     * Initializes and configures the FTP client.
     */
    private async getFTPClient() {
        const client = new ftp.Client();
        await client.access({
            host: this.settings.ftpHost,
            port: this.settings.ftpPort,
            user: this.settings.ftpUser,
            password: this.settings.ftpPassword,
            secure: false // Traffic is routed locally or over a secure VPN (Tailscale)
        });
        return client;
    }

    async syncToCloud() {
        if (this.isSyncing) return;
        this.isSyncing = true;
        
        const client = await this.getFTPClient();
        const lang = this.settings.language;
        
        try {
            new Notice(t(lang, 'uploadStarting'));

            // Sanitize target folder input to construct an absolute remote path
            const targetFolder = this.settings.syncFolder.replace(/^\/|\/$/g, '');

            // Ensure absolute navigation to avoid recursive traps on limited FTP servers
            await client.cd('/');
            await client.ensureDir(targetFolder);
            await client.cd(targetFolder);

            // Fetch the metadata of existing remote files for differential synchronization
            const remoteList = await client.list();
            const remoteFilesMap = new Map<string, number>();

            for (const item of remoteList) {
                if (item.isFile && item.name.endsWith('.md')) {
                    let modTime = 0;
                    if (item.modifiedAt) {
                        modTime = item.modifiedAt.getTime();
                    } else {
                        try {
                            const date = await client.lastMod(item.name);
                            modTime = date.getTime();
                        } catch (e) {
                            modTime = 0;
                        }
                    }
                    remoteFilesMap.set(item.name, modTime);
                }
            }

            const localFiles = this.app.vault.getMarkdownFiles();
            let count = 0;

            for (const file of localFiles) {
                const localModTime = file.stat.mtime;
                const remoteModTime = remoteFilesMap.get(file.name);

                let shouldUpload = false;

                // Compare timestamps. Upload if missing remotely or explicitly modified locally (+2s buffer).
                if (remoteModTime === undefined) {
                    shouldUpload = true;
                } else if (localModTime > remoteModTime + 2000) {
                    shouldUpload = true;
                }

                if (shouldUpload) {
                    const content = await this.app.vault.read(file);
                    
                    // Route through local OS temp directory to handle buffer stream correctly
                    const tempPath = path.join(require('os').tmpdir(), file.name);
                    fs.writeFileSync(tempPath, content);

                    // Upload into the flat structure inside the target directory
                    await client.uploadFrom(tempPath, file.name);
                    fs.unlinkSync(tempPath);

                    count++;
                }
            }

            if (count > 0) {
                new Notice(t(lang, 'uploadSuccess', count));
            } else {
                new Notice(t(lang, 'uploadNoChanges'));
            }
        } catch (err: any) {
            new Notice(t(lang, 'uploadError') + (err.message || err));
            console.error(err);
        } finally {
            // Always close the socket to free resources and prevent server bans
            client.close();
            this.isSyncing = false;
        }
    }

    async syncFromCloud() {
        if (this.isSyncing) return;
        this.isSyncing = true;

        const client = await this.getFTPClient();
        const lang = this.settings.language;

        try {
            new Notice(t(lang, 'downloadStarting'));

            let count = 0;
            const targetFolder = this.settings.syncFolder.replace(/^\/|\/$/g, '');

            await client.cd('/');
            
            // Check if the target folder actually exists before proceeding
            const rootItems = await client.list();
            const hasObsidianFolder = rootItems.some(item => item.name === targetFolder && item.isDirectory);

            if (!hasObsidianFolder) {
                new Notice(t(lang, 'folderNotFound', targetFolder));
                client.close();
                this.isSyncing = false;
                return;
            }

            await client.cd(targetFolder);

            const list = await client.list();
            const localMarkdownFiles = this.app.vault.getMarkdownFiles();

            for (const item of list) {
                if (item.isFile && item.name.endsWith('.md')) {
                    // Match by file name only, allowing local files to reside in any subfolder
                    const localFile = localMarkdownFiles.find(f => f.name === item.name);
                    let shouldDownload = false;

                    if (!localFile) {
                        shouldDownload = true;
                    } else {
                        let remoteModTime = 0;
                        
                        if (item.modifiedAt) {
                            remoteModTime = item.modifiedAt.getTime();
                        } else {
                            try {
                                const modDate = await client.lastMod(item.name);
                                remoteModTime = modDate.getTime();
                            } catch (e) {
                                remoteModTime = Date.now();
                            }
                        }

                        const localModTime = localFile.stat.mtime;
                        if (remoteModTime > localModTime + 2000) {
                            shouldDownload = true;
                        }
                    }

                    if (shouldDownload) {
                        const tempPath = path.join(require('os').tmpdir(), item.name);
                        
                        await client.downloadTo(tempPath, item.name);
                        const content = fs.readFileSync(tempPath, 'utf8');
                        fs.unlinkSync(tempPath);

                        if (!localFile) {
                            // Automatically drops new files into the vault root
                            await this.app.vault.create(item.name, content);
                        } else {
                            await this.app.vault.modify(localFile, content);
                        }
                        count++;
                    }
                }
            }

            if (count > 0) {
                new Notice(t(lang, 'downloadSuccess', count));
            } else {
                new Notice(t(lang, 'downloadNoChanges'));
            }
        } catch (err: any) {
            new Notice(t(lang, 'downloadError') + (err.message || err));
            console.error(err);
        } finally {
            client.close();
            this.isSyncing = false;
        }
    }

    private startAutoSync() {
        if (this.syncTimer) clearInterval(this.syncTimer);
        this.syncTimer = setInterval(async () => {
            if (!this.isSyncing) {
                await this.syncFromCloud();
                await this.syncToCloud();
            }
        }, this.settings.syncInterval * 60 * 1000);
    }
}

class PortableCloudSyncSettingTab extends PluginSettingTab {
    plugin: PortableCloudSync;

    constructor(app: App, plugin: PortableCloudSync) {
        super(app, plugin);
        this.plugin = plugin;
    }

display() {
        const { containerEl } = this;
        const lang = this.plugin.settings.language;

        containerEl.empty();
        containerEl.createEl('h2', { text: t(lang, 'settingsTitle') });

        new Setting(containerEl)
            .setName(t(lang, 'language'))
            .setDesc(t(lang, 'languageDesc'))
            .addDropdown(dropdown => dropdown
                .addOption('en', 'English')
                .addOption('tr', 'Türkçe')
                .setValue(lang)
                .onChange(async (value: string) => {
                    this.plugin.settings.language = value as 'en' | 'tr';
                    await this.plugin.saveSettings();
                    this.display(); // Force a re-render of the settings tab to update texts instantly
                }));

        new Setting(containerEl)
            .setName(t(lang, 'ftpHost'))
            .addText(text => text.setValue(this.plugin.settings.ftpHost)
            .onChange(v => { this.plugin.settings.ftpHost = v; this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName(t(lang, 'ftpPort'))
            .addText(text => text.setValue(this.plugin.settings.ftpPort.toString())
            .onChange(v => { this.plugin.settings.ftpPort = parseInt(v) || 2121; this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName(t(lang, 'ftpUser'))
            .addText(text => text.setValue(this.plugin.settings.ftpUser)
            .onChange(v => { this.plugin.settings.ftpUser = v; this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName(t(lang, 'ftpPassword'))
            .addText(text => text.setValue(this.plugin.settings.ftpPassword)
            .onChange(v => { this.plugin.settings.ftpPassword = v; this.plugin.saveSettings(); }));
        
        new Setting(containerEl)
            .setName(t(lang, 'targetFolder'))
            .setDesc(t(lang, 'targetFolderDesc'))
            .addText(text => text.setValue(this.plugin.settings.syncFolder)
            .onChange(v => { this.plugin.settings.syncFolder = v; this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName(t(lang, 'syncInterval'))
            .addText(text => text.setValue(this.plugin.settings.syncInterval.toString())
            .onChange(v => { this.plugin.settings.syncInterval = parseInt(v) || 5; this.plugin.saveSettings(); }));
    }
}