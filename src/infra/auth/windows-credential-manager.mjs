import process from 'node:process';
import { spawn } from 'node:child_process';

import { derivePersistentProfileKey } from '../browser/profile-store.mjs';

const DEFAULT_WINDOWS_CREDENTIAL_NAMESPACE = 'BrowserWikiSkill';
const WINCRED_INPUT_ENV = 'BWS_WINCRED_INPUT';
const POWERSHELL_WINCRED_SCRIPT = `
$ErrorActionPreference = 'Stop'

$payloadJson = $env:${WINCRED_INPUT_ENV}
if ([string]::IsNullOrWhiteSpace($payloadJson)) {
  throw 'Missing WinCred payload.'
}

$payload = ConvertFrom-Json -InputObject $payloadJson

Add-Type -Language CSharp -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace BrowserWikiSkill.WinCred {
  [StructLayout(LayoutKind.Sequential)]
  public struct FILETIME {
    public UInt32 dwLowDateTime;
    public UInt32 dwHighDateTime;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public UInt32 Flags;
    public UInt32 Type;
    public string TargetName;
    public string Comment;
    public FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }

  public static class NativeMethods {
    [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredRead(string target, UInt32 type, UInt32 reservedFlag, out IntPtr credentialPtr);

    [DllImport("Advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredWrite([In] ref CREDENTIAL userCredential, [In] UInt32 flags);

    [DllImport("Advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredDelete(string target, UInt32 type, UInt32 flags);

    [DllImport("Advapi32.dll", EntryPoint = "CredFree", SetLastError = true)]
    public static extern void CredFree([In] IntPtr cred);
  }
}
"@

$CRED_TYPE_GENERIC = 1
$CRED_PERSIST_LOCAL_MACHINE = 2
$ERROR_NOT_FOUND = 1168

function Resolve-WinCredTargets([string]$target) {
  $normalized = [string]$target
  if ([string]::IsNullOrWhiteSpace($normalized)) {
    return @()
  }
  if ($normalized.StartsWith('LegacyGeneric:target=', [StringComparison]::OrdinalIgnoreCase)) {
    return @($normalized)
  }
  return @($normalized, "LegacyGeneric:target=$normalized")
}

function Get-WinCredRecord([string]$target) {
  foreach ($candidate in Resolve-WinCredTargets($target)) {
    $credentialPtr = [IntPtr]::Zero
    $success = [BrowserWikiSkill.WinCred.NativeMethods]::CredRead($candidate, $CRED_TYPE_GENERIC, 0, [ref]$credentialPtr)
    if (-not $success) {
      $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      if ($errorCode -eq $ERROR_NOT_FOUND) {
        continue
      }
      throw "CredRead failed with Win32 error $errorCode."
    }

    try {
      $credential = [Runtime.InteropServices.Marshal]::PtrToStructure(
        $credentialPtr,
        [type][BrowserWikiSkill.WinCred.CREDENTIAL]
      )
      $password = if ($credential.CredentialBlob -ne [IntPtr]::Zero -and $credential.CredentialBlobSize -gt 0) {
        [Runtime.InteropServices.Marshal]::PtrToStringUni($credential.CredentialBlob, [int]($credential.CredentialBlobSize / 2))
      } else {
        ''
      }

      return [pscustomobject]@{
        target = $credential.TargetName
        username = $credential.UserName
        password = $password
        comment = $credential.Comment
      }
    } finally {
      if ($credentialPtr -ne [IntPtr]::Zero) {
        [BrowserWikiSkill.WinCred.NativeMethods]::CredFree($credentialPtr)
      }
    }
  }
  return $null
}

switch ([string]$payload.action) {
  'get' {
    $credential = Get-WinCredRecord([string]$payload.target)
    if ($null -eq $credential) {
      [Console]::WriteLine(([pscustomobject]@{
        ok = $true
        found = $false
        target = [string]$payload.target
      } | ConvertTo-Json -Compress -Depth 4))
      exit 0
    }

    [Console]::WriteLine(([pscustomobject]@{
      ok = $true
      found = $true
      target = $credential.target
      username = $credential.username
      password = $credential.password
      comment = $credential.comment
    } | ConvertTo-Json -Compress -Depth 4))
    exit 0
  }
  'set' {
    $target = [string]$payload.target
    $username = [string]$payload.username
    $password = [string]$payload.password
    $comment = if ($payload.PSObject.Properties.Name -contains 'comment') { [string]$payload.comment } else { '' }

    $credential = New-Object BrowserWikiSkill.WinCred.CREDENTIAL
    $credential.Type = $CRED_TYPE_GENERIC
    $credential.TargetName = $target
    $credential.Comment = $comment
    $credential.UserName = $username
    $credential.Persist = $CRED_PERSIST_LOCAL_MACHINE

    $blobPointer = [Runtime.InteropServices.Marshal]::StringToCoTaskMemUni($password)
    try {
      $credential.CredentialBlob = $blobPointer
      $credential.CredentialBlobSize = [Text.Encoding]::Unicode.GetByteCount($password)

      $success = [BrowserWikiSkill.WinCred.NativeMethods]::CredWrite([ref]$credential, 0)
      if (-not $success) {
        $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        throw "CredWrite failed with Win32 error $errorCode."
      }

      [Console]::WriteLine(([pscustomobject]@{
        ok = $true
        stored = $true
        target = $target
        username = $username
      } | ConvertTo-Json -Compress -Depth 4))
      exit 0
    } finally {
      if ($blobPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeCoTaskMemUnicode($blobPointer)
      }
    }
  }
  'delete' {
    $target = [string]$payload.target
    $deleted = $false
    $found = $false
    foreach ($candidate in Resolve-WinCredTargets($target)) {
      $success = [BrowserWikiSkill.WinCred.NativeMethods]::CredDelete($candidate, $CRED_TYPE_GENERIC, 0)
      if ($success) {
        $deleted = $true
        $found = $true
        break
      }
      $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      if ($errorCode -eq $ERROR_NOT_FOUND) {
        continue
      }
      throw "CredDelete failed with Win32 error $errorCode."
    }
    [Console]::WriteLine(([pscustomobject]@{
      ok = $true
      deleted = $deleted
      found = $found
      target = $target
    } | ConvertTo-Json -Compress -Depth 4))
    exit 0
  }
  default {
    throw "Unsupported WinCred action: $($payload.action)"
  }
}
`;

function trimOrNull(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function defaultPowerShellExecutor(script, payload) {
  return new Promise((resolve, reject) => {
    const encodedScript = Buffer.from(String(script ?? ''), 'utf16le').toString('base64');
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedScript],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          [WINCRED_INPUT_ENV]: JSON.stringify(payload),
        },
      },
    );

    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`PowerShell WinCred command failed (${code}): ${stderr.trim() || 'unknown error'}`));
        return;
      }
      resolve(stdout);
    });
  });
}

async function invokeWindowsCredentialCommand(action, payload = {}, deps = {}) {
  if (process.platform !== 'win32') {
    return {
      ok: false,
      supported: false,
      reason: 'unsupported-platform',
    };
  }

  const executor = deps.executePowerShell ?? defaultPowerShellExecutor;
  const raw = await executor(POWERSHELL_WINCRED_SCRIPT, {
    action,
    ...payload,
  });
  const normalized = String(raw ?? '').trim();
  if (!normalized) {
    throw new Error('PowerShell WinCred command produced no output.');
  }
  return JSON.parse(normalized);
}

export function isWindowsCredentialManagerSupported() {
  return process.platform === 'win32';
}

export function resolveWindowsCredentialTarget(input, options = {}) {
  const explicit = trimOrNull(options.credentialTarget);
  if (explicit) {
    return explicit;
  }
  const profileKey = derivePersistentProfileKey(input);
  return `${DEFAULT_WINDOWS_CREDENTIAL_NAMESPACE}:${profileKey}`;
}

export async function getWindowsCredential(target, deps = {}) {
  const resolvedTarget = trimOrNull(target);
  if (!resolvedTarget) {
    throw new Error('Missing Windows credential target.');
  }
  const result = await invokeWindowsCredentialCommand('get', { target: resolvedTarget }, deps);
  return {
    found: result.found === true,
    target: result.target ?? resolvedTarget,
    username: trimOrNull(result.username),
    password: result.password === undefined ? null : String(result.password ?? ''),
    comment: trimOrNull(result.comment),
    supported: result.supported !== false,
  };
}

export async function setWindowsCredential(target, { username, password, comment = null } = {}, deps = {}) {
  const resolvedTarget = trimOrNull(target);
  const resolvedUsername = trimOrNull(username);
  const resolvedPassword = String(password ?? '');
  if (!resolvedTarget) {
    throw new Error('Missing Windows credential target.');
  }
  if (!resolvedUsername) {
    throw new Error('Missing Windows credential username.');
  }
  if (!resolvedPassword) {
    throw new Error('Missing Windows credential password.');
  }
  const result = await invokeWindowsCredentialCommand('set', {
    target: resolvedTarget,
    username: resolvedUsername,
    password: resolvedPassword,
    comment: trimOrNull(comment),
  }, deps);
  return {
    stored: result.stored === true,
    target: result.target ?? resolvedTarget,
    username: trimOrNull(result.username) ?? resolvedUsername,
    supported: result.supported !== false,
  };
}

export async function deleteWindowsCredential(target, deps = {}) {
  const resolvedTarget = trimOrNull(target);
  if (!resolvedTarget) {
    throw new Error('Missing Windows credential target.');
  }
  const result = await invokeWindowsCredentialCommand('delete', { target: resolvedTarget }, deps);
  return {
    deleted: result.deleted === true,
    found: result.found !== false,
    target: result.target ?? resolvedTarget,
    supported: result.supported !== false,
  };
}
