$ErrorActionPreference = 'Stop'
$testProfilePath = Join-Path (Split-Path -Parent $PSScriptRoot) 'test-profile'
$isolatedProcesses = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'Obsidian.exe' -and $_.CommandLine -like "*$testProfilePath*" -and $_.CommandLine -notlike '*--type=*' })
if ($isolatedProcesses.Count -ne 1) { throw 'Expected one isolated test-profile process.' }
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class MarginLinkTestWindow {
  public delegate bool EnumProc(IntPtr h,IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p,IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint id);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public static void Show(uint id) {
    EnumWindows((h,p)=>{
      uint own; GetWindowThreadProcessId(h,out own);
      if(own==id) {
        var text=new StringBuilder(512); GetWindowText(h,text,512);
        if(text.ToString().Contains("test-vault")) { ShowWindow(h,3); SetForegroundWindow(h); }
      }
      return true;
    },IntPtr.Zero);
  }
}
'@
[MarginLinkTestWindow]::Show($isolatedProcesses[0].ProcessId)
