using System.Diagnostics;

namespace TimeToDeny.Launcher;

internal static class Program
{
    private static int Main(string[] args)
    {
        try
        {
            var root = FindProjectRoot();
            if (root is null)
            {
                Console.Error.WriteLine("Time To Deny project root was not found. Put TimeToDeny.exe inside the repository or its dist folder.");
                return 2;
            }

            var script = Path.Combine(root.FullName, "windows.ps1");
            if (!File.Exists(script))
            {
                Console.Error.WriteLine($"windows.ps1 was not found: {script}");
                return 2;
            }

            var actionArgs = args.Length == 0 ? new[] { "start" } : args;
            using var process = StartPowerShell(root.FullName, script, actionArgs);
            process.OutputDataReceived += (_, eventArgs) =>
            {
                if (eventArgs.Data is not null) Console.Out.WriteLine(eventArgs.Data);
            };
            process.ErrorDataReceived += (_, eventArgs) =>
            {
                if (eventArgs.Data is not null) Console.Error.WriteLine(eventArgs.Data);
            };

            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            process.WaitForExit();
            return process.ExitCode;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }

    private static Process StartPowerShell(string root, string script, IEnumerable<string> actionArgs)
    {
        var executable = FindExecutable("pwsh.exe") ?? FindExecutable("powershell.exe") ?? "powershell.exe";
        var info = new ProcessStartInfo
        {
            FileName = executable,
            WorkingDirectory = root,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = false,
        };

        info.ArgumentList.Add("-NoProfile");
        info.ArgumentList.Add("-ExecutionPolicy");
        info.ArgumentList.Add("Bypass");
        info.ArgumentList.Add("-File");
        info.ArgumentList.Add(script);
        foreach (var arg in actionArgs)
        {
            info.ArgumentList.Add(arg);
        }

        return Process.Start(info) ?? throw new InvalidOperationException("Failed to start PowerShell.");
    }

    private static DirectoryInfo? FindProjectRoot()
    {
        var probes = new[]
        {
            AppContext.BaseDirectory,
            Environment.CurrentDirectory,
        };

        foreach (var probe in probes)
        {
            var current = new DirectoryInfo(probe);
            while (current is not null)
            {
                if (File.Exists(Path.Combine(current.FullName, "windows.ps1"))
                    && File.Exists(Path.Combine(current.FullName, "manage.py"))
                    && Directory.Exists(Path.Combine(current.FullName, "backend")))
                {
                    return current;
                }
                current = current.Parent;
            }
        }

        return null;
    }

    private static string? FindExecutable(string name)
    {
        var path = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        foreach (var directory in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            var candidate = Path.Combine(directory.Trim(), name);
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }
}
