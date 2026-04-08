# ATM10 Questbook

A web-based viewer for All the Mods 10 FTB quests.

## First time setup

1. Run `setup.py` — choose mode 1 for chapters, mode 2 for full textures
   ```
   py setup.py        # Windows
   python3 setup.py   # Mac/Linux
   ```
2. Start the local server:
   - Windows: double-click `start.bat`
   - Mac/Linux: `./start.sh`
3. Open http://localhost:8000

## GitHub Pages

Push the contents of this folder to a public GitHub repo,
then enable Pages under Settings → Pages → Deploy from branch → main.

Your site will be live at:
`https://YOURUSERNAME.github.io/REPONAME`

After running setup.py locally, push your updated files:
```
git add data/textures.js data/chapters.json data/quests/
git commit -m "update quests and textures"
git push
```
