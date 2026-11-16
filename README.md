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

- **Installations**: pick any Minecraft release or snapshot, with Vanilla, Fabric, Quilt, NeoForge or Forge, and set the memory. Each one has its own folder (worlds, mods, packs, settings), and you can rename it on the Installations page. **Change version** moves an installation to another Minecraft version (newer or older): each mod is swapped for the build that matches, mods with no build are turned off rather than deleted, and the worlds are zipped into a `backups` folder first.
- **Downloads everything**: the game, libraries, assets and Mojang's own bundled Java. Press **Cancel** while it's getting files ready and everything that start downloaded is removed.
- **Mod compatibility**: before Play it reads each mod's own rules and refuses to start a game Fabric would reject, explaining the problem and offering to fix it (it tries other builds of the mods involved). Installs prefer stable releases, and an install that would break your set is taken back out.
- **Mods, resource packs and shaders**: search Modrinth filtered to your version and loader, one-click install (required mods come along, packs and shaders are turned on, Iris is installed for shaders), with an **Update all** button that only keeps an update if your mods still work together. Add your own by dropping a file or folder on the window, or with the Add buttons: it works out what each one is.
- **Crooli's mods**: a tab on the Mods page listing the mods and shader pack from xandertaylorx.github.io/minecraft-mods, read live from that page.
- **Servers**: create a Minecraft server (Vanilla, Fabric, Quilt, NeoForge or Forge) with one click, start and stop it, run commands in a console that completes them as you type, keep a whitelist (a switch plus add-by-name), flip settings like PvP and command blocks any time, edit every setting in `server.properties`, add server mods from Modrinth, copy the address to share, **share over the internet** with one click (a tunnel through `bore.pub`, no account or router settings; the address changes each time), and open its folders. **Export as zip** saves the whole server (world, mods, settings, start scripts) wherever you choose, ready for a real server host.
- **Skins**: load a PNG or copy a player's, with a 3D preview you can turn. Because the account is offline, it's applied as a resource pack when the game starts.
- **Import**: finds installs from the Minecraft Launcher, Prism, MultiMC, CurseForge, Modrinth App and others (or any folder you point it at) and copies worlds, mods, packs and settings into a new installation. The originals are never changed.
- **Updates**: checks GitHub on start and every 6 hours, downloads a new version in the background (checked against GitHub's checksum) and installs it when you close the launcher, or right away with Restart and update. On Mac the launcher replaces its own app, since Apple only allows the standard updater for apps signed with a paid certificate.
- **Players**: switch between several offline players from the top right, each with their own skin (singleplayer, LAN, offline-mode servers). Microsoft accounts are not in yet.
- **Crash helper**: when the game stops unexpectedly it explains why in plain words (out of memory, wrong Java, a mod that breaks the game, graphics driver) and offers the likely fix.

Data lives in `~/Library/Application Support/CrooliLauncher` (mac) or `%APPDATA%\CrooliLauncher` (Windows).
Set `CROOLI_HOME=/some/dir` to use a different folder.

## Not built yet

- Microsoft login (needs an Azure app registration — client ID)
- Modpacks, CurseForge
- Microsoft skins and capes
- Server plugins (Paper and similar)

## Website

Live at https://mclauncher.crooli.com. The page lives in `web/` (plain static HTML, no build step) and deploys to Vercel.

## License

MIT. Not affiliated with Mojang or Microsoft.

## Install with one line

```bash
curl -fsSL https://mclauncher.crooli.com/install.sh | bash   # macOS: downloads, checks, installs in Applications, clears the unsigned flag, opens it
```

```powershell
irm https://mclauncher.crooli.com/install.ps1 | iex   # Windows
```

The scripts live in `web/` and read the latest release from GitHub.

## Updates and releases

The launcher checks GitHub for a newer release on start and every 6 hours (Settings has a "Check for updates" button too).
It downloads a new version in the background and installs it when the launcher is closed, or right away with **Restart and update**.

- **Windows:** electron-updater does the download and install, using `latest.yml` from the release.
- **macOS:** Apple only allows the standard updater for apps signed with a paid certificate, so `src/core/updater.js` does it
  directly: it downloads the `.dmg`, checks it against the SHA-256 GitHub publishes for it, and a helper script swaps the app in
  place once the launcher has quit (putting the old one back if anything fails). The app has to be in a folder you can write to,
  such as `/Applications`; otherwise the banner falls back to a download button.

To ship a new version:

1. Bump `version` in `package.json` and push to main.
2. Build the Mac installers: `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg --arm64 --x64 --publish never`
3. `gh release create vX.Y.Z dist/*.dmg --title "Crooli MC Launcher X.Y.Z" --notes "..."`

Publishing the release starts the **Windows build** workflow, which attaches the `.exe` and the files the updater needs.
The website reads the latest release by itself, so its version badge and download buttons update on their own.
