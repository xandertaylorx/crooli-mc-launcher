# Crooli MC Launcher

A small, retro-styled Minecraft launcher for macOS and Windows (Electron).

## Run it

```bash
npm install
npm start
```

## Build installers

```bash
npm run dist:mac   # .dmg (build on a Mac)
npm run dist:win   # .exe installer (best built on Windows)
```

## What it does

- **Instances**: pick any Minecraft release/snapshot, Vanilla or Fabric, set RAM. Each instance has its own folder (worlds, mods, config).
- **Downloads everything**: game, libraries, assets, and Mojang's own bundled Java — no Java install needed.
- **Mods**: search Modrinth (filtered to your version + Fabric), one-click install with required dependencies (e.g. Fabric API), toggle/remove installed mods.
- **Accounts**: offline mode only for now (singleplayer, LAN, offline-mode servers).

Data lives in `~/Library/Application Support/CrooliLauncher` (mac) or `%APPDATA%\CrooliLauncher` (Windows).
Set `CROOLI_HOME=/some/dir` to use a different folder.

## Not built yet

- Microsoft login (needs an Azure app registration — client ID)
- Forge / NeoForge / Quilt, modpacks, CurseForge
- Skins, news feed, auto-update

## Website

Live at https://mclauncher.crooli.com. The page lives in `web/` (plain static HTML, no build step) and deploys to Vercel.

## License

MIT. Not affiliated with Mojang or Microsoft.

## Updates and releases

The launcher checks GitHub for a newer release on start and every 6 hours (Settings has a "Check for updates" button too).
On Windows it downloads the update in the background and offers **Restart to update**. On macOS the app isn't signed,
so it can't replace itself: it shows a banner that downloads the right `.dmg` instead.

To ship a new version:

1. Bump `version` in `package.json` and push to main.
2. Build the Mac installers: `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg --arm64 --x64 --publish never`
3. `gh release create vX.Y.Z dist/*.dmg --title "Crooli MC Launcher X.Y.Z" --notes "..."`

Publishing the release starts the **Windows build** workflow, which attaches the `.exe` and the files the updater needs.
The website reads the latest release by itself, so its version badge and download buttons update on their own.
