# Scavenger Hunt

A little static website for a hide-and-seek game around the house. Four figures are
hidden; each one has five clues that get progressively less subtle. The site keeps
score by counting how few clues you needed.

No accounts, no server, no build step for players — just open the page.

## How it plays

1. The hub lists all four figures. Each shows a **teaser** — a taunt, basically, with
   no actual information in it.
2. Tap a figure to open it. You can take clues one at a time: **1 → 5**, vague to obvious.
   Clue 5 always gives the hiding place away, so nobody stays stuck.
3. Tap **I FOUND IT!** when you've got it. Confetti, stars, points.
4. Find all four to unlock a rank based on your total clues used, from *Never Gave Up*
   up to *Legendary Seeker*.

Scoring is 100 points per figure, minus 15 per clue, floored at 25. Stars are `5 − clues used`
(minimum 1). Progress lives in `localStorage` under `scavengerHunt.v1`, so each kid's
phone or tablet keeps its own score, and **Start over** wipes it.

## Editing the clues

`clues.json` holds the plaintext. Edit it, then rebuild:

```powershell
pwsh tools/build.ps1
```

That regenerates `data.js`, which is the file the site actually loads. Commit and push
and GitHub Pages picks it up within a minute or so.

The shape is the same for every figure:

```json
{
  "id": "f1",
  "name": "The Wanderer",
  "emoji": "🕊️",
  "color": "teal",
  "teaser": "Shown before any clue is taken. Give nothing away.",
  "clues": ["vaguest", "...", "...", "...", "basically the answer"],
  "answer": "Shown only after they tap I FOUND IT."
}
```

`color` is one of `teal`, `gold`, `pink`, `purple`, `green` and just tints that figure's
badge and clue stripes. You can add or remove figures freely — the hub, the progress bar
and the rank thresholds all count off the array. Five clues per figure is the intended
rhythm, not a hard limit.

## Why the clues are scrambled

`data.js` ships with every clue XOR'd and base64'd, because the target audience is old
enough to know what View Source is. It is obfuscation, not encryption — anyone who reads
`app.js` can reverse it in a minute. That is the correct amount of effort for stopping a
kid from casually peeking at the answers, and no more.

**`clues.json` is gitignored on purpose.** The plaintext must not end up in a public repo.
If you ever lose your local copy, recover it from the built file:

```powershell
pwsh tools/build.ps1 -Decode
```

## Files

| File | What it is |
|---|---|
| `index.html` | Page shell. Everything visible is rendered by `app.js`. |
| `styles.css` | All styling. Mobile-first, no framework. |
| `app.js` | Game logic: routing, clue reveal, scoring, localStorage. |
| `data.js` | **Generated.** Scrambled clue data. Do not hand-edit. |
| `clues.json` | **Gitignored.** The plaintext source you actually edit. |
| `tools/build.ps1` | `clues.json` → `data.js`, and `-Decode` to go back. |

## Running it locally

Any static file server works. Opening `index.html` straight off disk mostly works too,
though some browsers restrict `localStorage` on `file://`, which means scores won't stick.
