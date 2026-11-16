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

- **Installations**: pick any Minecraft release or snapshot, Vanilla or Fabric, and set the memory. Each one has its own folder (worlds, mods, packs, settings).
- **Downloads everything**: the game, libraries, assets and Mojang's own bundled Java. Press **Cancel** while it's getting files ready and everything that start downloaded is removed.
- **Mod compatibility**: before Play it reads each mod's own rules and refuses to start a game Fabric would reject, explaining the problem and offering to fix it (it tries other builds of the mods involved). Installs prefer stable releases, and an install that would break your set is taken back out.
- **Mods, resource packs and shaders**: search Modrinth filtered to your version, one-click install (required mods come along, packs and shaders are turned on, Iris is installed for shaders). Add your own by dropping a file or folder on the window, or with the Add buttons: it works out what each one is.
- **Crooli's mods**: a tab on the Mods page listing the mods and shader pack from xandertaylorx.github.io/minecraft-mods, read live from that page.
- **Servers**: create a Minecraft server (Vanilla or Fabric) with one click, start and stop it, run commands in the console, copy the address to share, and open its folders.
- **Skins**: build a skin from six colours, load a PNG, or copy a player's. Because the account is offline, it's applied as a resource pack when the game starts.
- **Import**: finds installs from the Minecraft Launcher, Prism, MultiMC, CurseForge, Modrinth App and others (or any folder you point it at) and copies worlds, mods, packs and settings into a new installation. The originals are never changed.
- **Updates**: checks GitHub on start and every 6 hours.
- **Accounts**: offline mode only for now (singleplayer, LAN, offline-mode servers).

Data lives in `~/Library/Application Support/CrooliLauncher` (mac) or `%APPDATA%\CrooliLauncher` (Windows).
Set `CROOLI_HOME=/some/dir` to use a different folder.

## Not built yet

- Microsoft login (needs an Azure app registration — client ID)
- Forge / NeoForge / Quilt, modpacks, CurseForge
- Microsoft skins and capes
- Server mods and plugins from the launcher (a Fabric server has a mods folder you can fill yourself)

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
