param([string]$Server, [string]$Token, [switch]$Uninstall)
if ($Uninstall) { [Environment]::SetEnvironmentVariable('NX_SELF_HOSTED_REMOTE_CACHE_SERVER',$null,'User'); [Environment]::SetEnvironmentVariable('NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN',$null,'User'); exit }
if (-not $Server -or -not $Token) { throw 'Pass -Server and -Token.' }
Invoke-WebRequest "$Server/health" -UseBasicParsing | Out-Null
[Environment]::SetEnvironmentVariable('NX_SELF_HOSTED_REMOTE_CACHE_SERVER',$Server,'User')
[Environment]::SetEnvironmentVariable('NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN',$Token,'User')
Write-Host 'Restart terminals and AI agents.'
