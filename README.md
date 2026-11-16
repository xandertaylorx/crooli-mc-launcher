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
