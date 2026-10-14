param([Parameter(Mandatory=$true)][string]$Username,[Parameter(Mandatory=$true)][ValidateSet('operator','accountant','owner')][string]$Role,[Parameter(Mandatory=$true)][string[]]$CompanyIds,[string]$DisplayName=$Username)
Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)
$securePassword=Read-Host 'Password (at least 12 characters)' -AsSecureString
$credential=New-Object System.Net.NetworkCredential('', $securePassword)
$env:PROVISION_PASSWORD=$credential.Password
$env:PROVISION_ID=$Username
$env:PROVISION_ROLE=$Role
$env:PROVISION_NAME=$DisplayName
$env:PROVISION_COMPANIES=($CompanyIds | ConvertTo-Json -Compress -AsArray)
try {node scripts/provision-user.mjs} finally {Remove-Item Env:PROVISION_PASSWORD,Env:PROVISION_ID,Env:PROVISION_ROLE,Env:PROVISION_NAME,Env:PROVISION_COMPANIES}
