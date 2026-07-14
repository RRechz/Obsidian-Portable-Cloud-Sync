# Portable Cloud Sync for Obsidian

A bidirectional FTP synchronization plugin for Obsidian. This plugin allows you to sync your Markdown (`.md`) files directly to a personal FTP server (such as an Android device running an FTP server app via Tailscale) without relying on third-party cloud services.

## Features

* **Bidirectional Sync:** Uploads local changes to the FTP server and downloads remote changes to your Obsidian vault.
* **Differential Synchronization:** Compares modification dates and only transfers new or updated files to save bandwidth and prevent data corruption.
* **Auto-Sync:** Automatically syncs your files in the background at a customizable time interval.
* **Flat Structure Design:** Stores all your synced notes in a single target folder on the server.
* **Bilingual Support:** The plugin interface fully supports both English and Turkish.

## Installation

Currently, this plugin must be installed manually. 

1. Go to the **Releases** page of this repository.
2. Download the `main.js`, `manifest.json`, and `styles.css` files from the latest release.
3. Create a folder named `portable-cloud-sync` inside your vault's plugin directory: `YourVault/.obsidian/plugins/`.
4. Place the downloaded files into that folder.
5. Restart Obsidian, go to **Settings > Community Plugins**, disable "Safe Mode", and enable **Portable Cloud Sync**.

## Configuration

Navigate to the plugin settings to configure your FTP connection:

* **FTP Host:** The IP address of your FTP server.
* **Port:** The FTP port (e.g., 2121).
* **Username & Password:** Your FTP credentials.
* **Target Folder:** The root folder on the server where notes will be stored (e.g., `Obsidian`).
* **Sync Interval:** Background sync frequency in minutes.
* **Language:** Choose between English and Turkish for the settings interface.

## Important Note on File Names (Architecture)

This plugin uses a **flat folder structure** on the remote server. It does not replicate your local Obsidian folder hierarchy. Therefore, **all your markdown file names must be unique**. If you have `Work/Note.md` and `Personal/Note.md`, they will overwrite each other on the FTP server.

## License

This project is licensed under the GPL-v3.0 License.