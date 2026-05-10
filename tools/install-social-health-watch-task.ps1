[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [ValidateSet('x', 'instagram', 'all')]
  [string] $Site = 'all',

  [ValidateRange(1, 525600)]
  [int] $IntervalMinutes = 60,

  [switch] $Execute,

  [string] $NodePath = 'node',

  [string] $RepoRoot,

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

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = Join-Path $PSScriptRoot '..'
}

$resolvedRepoRoot = (Resolve-Path $RepoRoot).Path
$cliScript = Join-Path $resolvedRepoRoot 'src\entrypoints\cli.mjs'
if (-not (Test-Path -LiteralPath $cliScript -PathType Leaf)) {
  throw "Missing unified CLI script: $cliScript"
}

$effectiveTaskName = ConvertTo-StableTaskName -Name $TaskName -ScopedToUser $UserScope.IsPresent
$runRoot = Join-Path $resolvedRepoRoot 'runs\social-health-watch'
$taskActionArgs = @(
  $NodePath,
  $cliScript,
  'social',
  'health-watch',
  '--execute',
  '--site',
  $Site,
  '--interval-minutes',
  [string] $IntervalMinutes,
  '--run-root',
  $runRoot
)
$taskRunCommand = Join-CommandLine -Arguments $taskActionArgs
$schtasksArgs = @(
  '/Create',
  '/F',
  '/SC',
  'MINUTE',
  '/MO',
  [string] $IntervalMinutes,
  '/TN',
  $effectiveTaskName,
  '/TR',
  $taskRunCommand,
  '/RL',
  'LIMITED'
)

$plan = [ordered] @{
  mode = if ($Execute.IsPresent) { 'execute' } else { 'dry-run' }
  taskName = $effectiveTaskName
  site = $Site
  intervalMinutes = $IntervalMinutes
  repoRoot = $resolvedRepoRoot
  nodePath = $NodePath
  userScope = $UserScope.IsPresent
  taskRunCommand = $taskRunCommand
  schtasksExe = 'schtasks.exe'
  schtasksArgs = $schtasksArgs
}

if ($Json.IsPresent) {
  $plan | ConvertTo-Json -Depth 6
} else {
  Write-Host 'social-health-watch scheduled task install plan'
  Write-Host "Mode: $($plan.mode)"
  Write-Host "Task: $effectiveTaskName"
  Write-Host "Action: $taskRunCommand"
  Write-Host "Command: schtasks.exe $((Join-CommandLine -Arguments $schtasksArgs))"
}

if (-not $Execute.IsPresent) {
  if (-not $Json.IsPresent) {
    Write-Host 'Dry-run only. Re-run with -Execute to create or update the scheduled task.'
  }
  return
}

if ($PSCmdlet.ShouldProcess($effectiveTaskName, 'Create or update Windows scheduled task')) {
  & schtasks.exe @schtasksArgs
  if ($LASTEXITCODE -ne 0) {
    throw "schtasks.exe failed with exit code $LASTEXITCODE"
  }
}
