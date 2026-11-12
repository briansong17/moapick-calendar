$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
node --env-file=.env.local server.mjs
