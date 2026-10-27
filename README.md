# Familiar DB

Team wiki for Familiar. The home page links to the Roster (every character, their types, evolutions, villains and gags, with Types, Anime and Stats tabs) and to text pages: Story, Gameplay, Lore, World, Glossary, Art & style and Roadmap.

Live site: https://zpivill.github.io/familiar-db/

## Editing online

1. Ask the repo owner to add you as a collaborator on this repo, then accept the invite from your email or GitHub notifications.
2. Make a token: open https://github.com/settings/tokens/new?scopes=public_repo&description=Familiar%20DB, set Expiration to what you like, and click **Generate token**. Copy it.
3. On the live site, click **Sign in to edit** and paste the token. Your browser remembers it, so you only do this once per browser.

Then:

- Click a picture slot and press Ctrl+V to paste a picture, or drag a picture file onto it.
- Click a character to edit its name, anime, villain or gag tag, its forms and their types.
- Every change saves to this repo as a commit under your name. Pictures show up straight away; other changes reach the live site for everyone within about a minute.

Keep your token private. If it leaks, delete it at https://github.com/settings/tokens.

## Editing on your own computer

Double-click `start.bat` (or run `py serve.py` and open http://localhost:8000). Changes save to `data/characters.json` and pictures to `images/`; commit and push them to publish.

## Editing the text pages

Story, Gameplay, Lore and the other text pages come from `data/wiki.json`. Each page has a title, a one-line blurb and sections of entries (`t` is the entry's name, `n` its text, `plan: true` marks it as a plan that may change). Only settled things go here; ideas still being discussed stay in the game map. Edit the file on GitHub (the pencil icon) and the site updates within about a minute.
