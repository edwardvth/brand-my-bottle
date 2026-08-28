# Brand My Bottle — deploy to Cloudflare Pages.
#
# ⛔ NEVER run `wrangler pages deploy .` in this repo. `.assetsignore` is
#    silently ignored by wrangler pages-deploy (verified 2026-08-28), which
#    means everything at the repo root ships publicly — including .secrets/
#    and supabase/functions/. That leaked a Stripe webhook signing secret
#    once already.
#
# This script rebuilds a clean dist/ containing ONLY the public files, then
# deploys from that folder. Add any new public asset to $PublicFiles below.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$PublicFiles = @(
    "index.html",
    "app.js",
    "styles.css",
    "bottle-slim.glb"
)

Write-Output "Rebuilding dist/..."
if (Test-Path dist) { Remove-Item dist -Recurse -Force }
New-Item -ItemType Directory -Path dist | Out-Null
foreach ($f in $PublicFiles) {
    if (-not (Test-Path $f)) { throw "Missing required public file: $f" }
    Copy-Item $f dist/
}

Write-Output "Deploying dist/ to Cloudflare Pages..."
npx --yes wrangler pages deploy dist --project-name=brand-my-bottle --commit-dirty=true --branch=main
