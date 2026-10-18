# Windows smoke test: built exe, real local model, engine health and normal idle exit.
param([int]$RecoverTestProcessId = 0, [string]$ReportName = 'native-smoke-results.json')
$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$exePath = Join-Path $projectRoot 'app/build/bin/Index-VT.exe'
if ([System.IO.Path]::GetFileName($ReportName) -ne $ReportName) { throw 'ReportName must be a filename.' }
$reportPath = Join-Path (Join-Path $projectRoot 'docs/review-2026-10-17') $ReportName
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class NativeSmokeWindow {
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
  private delegate bool EnumProc(IntPtr hwnd, IntPtr param);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc cb, IntPtr param);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int length);
  public static IntPtr Find(int processId) {
    IntPtr result = IntPtr.Zero;
    EnumWindows((hwnd, p) => {
      uint pid; GetWindowThreadProcessId(hwnd, out pid);
      var title = new StringBuilder(256); GetWindowText(hwnd, title, 256);
      if (pid == processId && title.ToString() == "Index-VT") { result = hwnd; return false; }
      return true;
    }, IntPtr.Zero);
    return result;
  }
}
'@
if ($RecoverTestProcessId -gt 0) {
    $previous = Get-Process -Id $RecoverTestProcessId -ErrorAction Stop
    $failedReport = Get-Content -LiteralPath (Join-Path $projectRoot 'docs/review-2026-10-17/native-results.json') -Raw | ConvertFrom-Json
    if ($previous.Path -ne $exePath -or [Math]::Abs(($previous.StartTime.ToUniversalTime() - [DateTime]::Parse($failedReport.started).ToUniversalTime()).TotalSeconds) -gt 5) { throw 'Refusing to close a process that does not match the failed test launch.' }
    $previousWindow = [NativeSmokeWindow]::Find($previous.Id)
    if ($previousWindow -eq [IntPtr]::Zero) { throw 'Failed test window not found.' }
    [void][NativeSmokeWindow]::PostMessage($previousWindow, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    if (-not $previous.WaitForExit(30000)) { throw 'Failed test instance did not close normally.' }
}
$existing = Get-Process Index-VT -ErrorAction SilentlyContinue
if ($existing) { throw 'Close the existing Index-VT instance before running this test.' }
$result = [ordered]@{ started = [DateTime]::UtcNow.ToString('o'); checks = @(); ok = $false }
$application = $null
try {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $exePath
    $startInfo.WorkingDirectory = $projectRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $application = [System.Diagnostics.Process]::Start($startInfo)
    $deadline = [DateTime]::UtcNow.AddSeconds(120)
    $engine = $null
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($application.HasExited) { throw 'Application exited before model loading.' }
        $engine = Get-CimInstance Win32_Process -Filter "Name = 'llama-server.exe'" | Where-Object { $_.ParentProcessId -eq $application.Id } | Select-Object -First 1
        if ($engine -and $engine.CommandLine -match '--port\s+(\d+)') {
            $port = [int]$Matches[1]
            try {
                $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2
                if ($health.status -eq 'ok') { break }
            } catch { }
        }
        Start-Sleep -Milliseconds 250
    }
    if (-not $engine -or -not $health -or $health.status -ne 'ok') { throw 'Default model was not ready within 120 seconds.' }
    $result.readyMs = $watch.ElapsedMilliseconds
    $result.applicationPid = $application.Id
    $result.enginePid = $engine.ProcessId
    $result.engineCommandLine = $engine.CommandLine
    $result.health = $health
    $result.port = $port
    $result.checks += 'Startup creates llama-server and loads the default model without a translation request'
    $result.checks += 'Real engine /health returns ok'
    if ($engine.CommandLine -match '-c\s+(\d+)') { $result.contextTokens = [int]$Matches[1] }
    if ($engine.CommandLine -match 'Index-([^\\]+)\.gguf') { $result.modelFile = 'Index-' + $Matches[1] + '.gguf' }
    $mainWindow = [NativeSmokeWindow]::Find($application.Id)
    if ($mainWindow -eq [IntPtr]::Zero) { throw 'Application main window not found.' }
    [void][NativeSmokeWindow]::PostMessage($mainWindow, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    if (-not $application.WaitForExit(30000)) { throw 'Application did not exit within 30 seconds after normal close.' }
    Start-Sleep -Milliseconds 600
    $remaining = Get-Process -Id $engine.ProcessId -ErrorAction SilentlyContinue
    if ($remaining) { throw 'Engine process remains after application exit.' }
    $stillHealthy = $false
    try { $stillHealthy = (Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 1).status -eq 'ok' } catch { }
    if ($stillHealthy) { throw 'Engine health endpoint remains after application exit.' }
    $result.checks += 'Normal close while idle releases engine process and health endpoint'
    $result.ok = $true
} catch {
    $result.error = $_.Exception.Message
    Write-Error $_ -ErrorAction Continue
} finally {
    if ($application -and -not $application.HasExited) {
        $cleanupWindow = [NativeSmokeWindow]::Find($application.Id)
        if ($cleanupWindow -ne [IntPtr]::Zero) {
            [void][NativeSmokeWindow]::PostMessage($cleanupWindow, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
            [void]$application.WaitForExit(30000)
        }
    }
    $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding UTF8
    $result | ConvertTo-Json -Depth 6
}
if (-not $result.ok) { exit 1 }
