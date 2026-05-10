[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch] $Execute,

  [string] $TaskName = 'SiteForgeSocialHealthWatch',

  [switch] $UserScope,

  [switch] $Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function ConvertTo-StableTaskName {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Name,

    [bool] $ScopedToUser
  )

  if ($Name.StartsWith('\')) {
    return $Name
  }

  if ($ScopedToUser) {
    $safeUser = ($env:USERNAME -replace '[\\/:"<>|?*]+', '_')
    return "\SiteForge\$safeUser\$Name"
  }

  return "\SiteForge\$Name"
}

function ConvertTo-CmdArgument {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Value
  )

  if ($Value -match '^[A-Za-z0-9_./:@=\\-]+$') {
    return $Value
  }

  return '"' + ($Value -replace '"', '\"') + '"'
}

function Join-CommandLine {
  param(
    [Parameter(Mandatory = $true)]
    [string[]] $Arguments
  )

  return ($Arguments | ForEach-Object { ConvertTo-CmdArgument $_ }) -join ' '
}

$effectiveTaskName = ConvertTo-StableTaskName -Name $TaskName -ScopedToUser $UserScope.IsPresent
$schtasksArgs = @(
  '/Delete',
  '/F',
  '/TN',
  $effectiveTaskName
)

$plan = [ordered] @{
  mode = if ($Execute.IsPresent) { 'execute' } else { 'dry-run' }
  taskName = $effectiveTaskName
  userScope = $UserScope.IsPresent
  schtasksExe = 'schtasks.exe'
  schtasksArgs = $schtasksArgs
}

if ($Json.IsPresent) {
  $plan | ConvertTo-Json -Depth 4
} else {
  Write-Host 'social-health-watch scheduled task uninstall plan'
  Write-Host "Mode: $($plan.mode)"
  Write-Host "Task: $effectiveTaskName"
  Write-Host "Command: schtasks.exe $((Join-CommandLine -Arguments $schtasksArgs))"
}

if (-not $Execute.IsPresent) {
  if (-not $Json.IsPresent) {
    Write-Host 'Dry-run only. Re-run with -Execute to delete the scheduled task.'
  }
  return
}

if ($PSCmdlet.ShouldProcess($effectiveTaskName, 'Delete Windows scheduled task')) {
  & schtasks.exe @schtasksArgs
  if ($LASTEXITCODE -ne 0) {
    throw "schtasks.exe failed with exit code $LASTEXITCODE"
  }
}
