Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)
node scripts/package.mjs
if($LASTEXITCODE -ne 0){throw 'Product packaging failed.'}
