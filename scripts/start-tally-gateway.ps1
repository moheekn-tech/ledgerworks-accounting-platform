param([string]$CompanyName,[string]$TokenFile,[switch]$AllowWrites)
$projectPath=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if(-not $CompanyName -or -not (Test-Path -LiteralPath $TokenFile)){throw 'Provide CompanyName and a file containing the gateway token.'}
$gatewayDirectory=Join-Path $projectPath 'data/gateway'
New-Item -ItemType Directory -Path $gatewayDirectory -Force | Out-Null
$companyFile=Join-Path $gatewayDirectory 'companies.json'
ConvertTo-Json -InputObject @($CompanyName) | Set-Content -LiteralPath $companyFile
$env:TALLY_GATEWAY_COMPANIES_FILE=$companyFile
$env:TALLY_GATEWAY_TOKEN_FILE=(Resolve-Path -LiteralPath $TokenFile).Path
$env:TALLY_GATEWAY_ALLOW_WRITES=if($AllowWrites){'true'}else{'false'}
Start-Process -FilePath 'node' -ArgumentList @('build/server/tally-gateway.js') -WorkingDirectory $projectPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $gatewayDirectory 'stdout.log') -RedirectStandardError (Join-Path $gatewayDirectory 'stderr.log')
Write-Output 'Gateway started on loopback port 4311. Publish through a customer-approved HTTPS proxy or private tunnel; Tally remains on local port 9000.'
