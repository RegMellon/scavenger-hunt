#requires -Version 7
<#
.SYNOPSIS
    Builds data.js (the file the website loads) from clues.json (the plaintext source).

.DESCRIPTION
    Clue text is XOR'd against a repeating key and base64'd so that a kid who hits
    "View Source" on the live site sees gibberish instead of every answer. This is
    obfuscation, not encryption — it stops casual peeking, which is the whole job.

    clues.json is gitignored and never leaves this machine. data.js is what ships.

.EXAMPLE
    pwsh tools/build.ps1
    Rebuilds data.js after you edit clues.json.

.EXAMPLE
    pwsh tools/build.ps1 -Decode
    Prints the plaintext back out of data.js — use this if clues.json ever goes missing.
#>
[CmdletBinding()]
param(
    [switch]$Decode
)

$ErrorActionPreference = 'Stop'

$root      = Split-Path -Parent $PSScriptRoot
$cluesPath = Join-Path $root 'clues.json'
$dataPath  = Join-Path $root 'data.js'
$prefix    = 'window.HUNT='

$key = [Text.Encoding]::UTF8.GetBytes('a-star-in-the-east-2026')

# Must match RESET_SALT in app.js.
$pwSalt = 'scavenger-hunt-reset::'

function Protect-Text {
    param([AllowEmptyString()][string]$Text)
    $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
    for ($i = 0; $i -lt $bytes.Length; $i++) {
        $bytes[$i] = $bytes[$i] -bxor $key[$i % $key.Length]
    }
    [Convert]::ToBase64String($bytes)
}

function Unprotect-Text {
    param([AllowEmptyString()][string]$Text)
    $bytes = [Convert]::FromBase64String($Text)
    for ($i = 0; $i -lt $bytes.Length; $i++) {
        $bytes[$i] = $bytes[$i] -bxor $key[$i % $key.Length]
    }
    [Text.Encoding]::UTF8.GetString($bytes)
}

if ($Decode) {
    if (-not (Test-Path $dataPath)) { throw "Nothing to decode: $dataPath does not exist." }

    $js = (Get-Content $dataPath -Raw).Trim()

    # data.js opens with a generated // banner, so scan past it rather than
    # assuming the assignment is the first thing in the file.
    $at = $js.IndexOf($prefix)
    if ($at -lt 0) { throw "$dataPath is not in the expected '$prefix{...};' form." }

    $payload = $js.Substring($at + $prefix.Length).TrimEnd(';')
    try   { $hunt = $payload | ConvertFrom-Json }
    catch { throw "$dataPath holds invalid JSON: $($_.Exception.Message)" }

    "TITLE:    $($hunt.title)"
    "SUBTITLE: $($hunt.subtitle)"
    "RESET PW: (hashed, not recoverable — set a new one in clues.json and rebuild)"
    foreach ($f in $hunt.figures) {
        ''
        "=== $($f.emoji) $($f.name)  [$($f.id)] ==="
        "  teaser: $(Unprotect-Text $f.t)"
        for ($i = 0; $i -lt $f.c.Count; $i++) {
            "  clue $($i + 1): $(Unprotect-Text $f.c[$i])"
        }
        "  answer: $(Unprotect-Text $f.a)"
    }
    return
}

if (-not (Test-Path $cluesPath)) {
    throw "Missing $cluesPath. That file is gitignored on purpose — if you just cloned this repo, run 'pwsh tools/build.ps1 -Decode' to recover the text from data.js."
}

try   { $src = Get-Content $cluesPath -Raw | ConvertFrom-Json }
catch { throw "clues.json is not valid JSON: $($_.Exception.Message)" }

if (-not $src.figures) { throw "clues.json has no 'figures' array." }

if ([string]::IsNullOrWhiteSpace($src.resetPassword)) {
    throw "clues.json needs a 'resetPassword' — it guards the Start over button so kids cannot wipe the game."
}

# Only the hash ships. Trimmed and lowercased so a parent typing on a phone
# keyboard is not defeated by autocapitalisation; app.js normalises identically.
$pwNormalised = $src.resetPassword.Trim().ToLowerInvariant()
$pwHash = [Convert]::ToHexString(
    [Security.Cryptography.SHA256]::HashData(
        [Text.Encoding]::UTF8.GetBytes("$pwSalt$pwNormalised")
    )
).ToLowerInvariant()

$figures = foreach ($f in $src.figures) {
    foreach ($field in 'id', 'name', 'emoji', 'teaser', 'answer') {
        if ([string]::IsNullOrWhiteSpace($f.$field)) {
            throw "Figure '$($f.id ?? '<no id>')' is missing required field '$field'."
        }
    }
    if ($f.clues.Count -lt 1) {
        throw "Figure '$($f.id)' has no clues. Every figure needs at least one."
    }

    [ordered]@{
        id    = $f.id
        name  = $f.name
        emoji = $f.emoji
        color = ($f.color ? $f.color : 'teal')
        t     = Protect-Text $f.teaser
        c     = @($f.clues | ForEach-Object { Protect-Text $_ })
        a     = Protect-Text $f.answer
    }
}

$hunt = [ordered]@{
    title    = $src.title
    subtitle = $src.subtitle
    pw       = $pwHash
    figures  = @($figures)
}

$banner = @(
    '// GENERATED FILE — do not edit by hand.'
    '// Built from clues.json (gitignored) by tools/build.ps1.'
    '// The clue text is deliberately scrambled. No peeking. :)'
) -join "`n"

$json = $hunt | ConvertTo-Json -Depth 8 -Compress
Set-Content -Path $dataPath -Value "$banner`n$prefix$json;`n" -Encoding utf8NoBOM

# Stamp each asset's content hash into index.html. GitHub Pages serves these with
# max-age=600, so without a changing URL a browser happily shows clues from an
# earlier build long after a push.
$indexPath = Join-Path $root 'index.html'
if (Test-Path $indexPath) {
    $html = Get-Content $indexPath -Raw
    foreach ($asset in 'styles.css', 'app.js', 'data.js') {
        $assetPath = Join-Path $root $asset
        if (-not (Test-Path $assetPath)) { continue }
        $stamp = [Convert]::ToHexString(
            [Security.Cryptography.SHA256]::HashData([IO.File]::ReadAllBytes($assetPath))
        ).ToLowerInvariant().Substring(0, 8)
        $pattern = '(?<=(?:src|href)="' + [regex]::Escape($asset) + '\?v=)[0-9a-z]+'
        $html = [regex]::Replace($html, $pattern, $stamp)
    }
    Set-Content -Path $indexPath -Value $html -Encoding utf8NoBOM -NoNewline
}

$clueCount = ($src.figures | Measure-Object -Property { $_.clues.Count } -Sum).Sum
"Wrote $dataPath"
"  $($src.figures.Count) figures, $clueCount clues, all scrambled."
"  Reset password hashed ($($pwHash.Substring(0,12))...); the word itself stays in clues.json."
