using System;
using System.Diagnostics;
using System.IO;

// Runs inside the AppContainer; the host verifier owns all temporary paths.
public static class SandboxAccessProbe
{
    public static int Main(string[] args)
    {
        try
        {
            File.WriteAllText(Path.Combine(args[0], "allowed.txt"), "allowed");
            if (File.ReadAllText(Path.Combine(args[1], "readable.txt")) != "readable") return 10;
            try { File.WriteAllText(Path.Combine(args[1], "denied.txt"), "denied"); return 11; }
            catch (UnauthorizedAccessException) { }
            try { File.ReadAllText(Path.Combine(args[2], "private.txt")); return 12; }
            catch (UnauthorizedAccessException) { }
            if (args[3] == "deny-child")
            {
                try
                {
                    using (var child = Process.Start(new ProcessStartInfo("cmd.exe", "/c exit 0") { UseShellExecute = false }))
                    { child.WaitForExit(); return 13; }
                }
                catch (System.ComponentModel.Win32Exception) { }
            }
            else
            {
                using (var child = Process.Start(new ProcessStartInfo("cmd.exe", "/c ping -n 60 127.0.0.1 > nul") { UseShellExecute = false }))
                    File.WriteAllText(Path.Combine(args[0], "descendant.pid"), child.Id.ToString());
            }
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 20; }
    }
}
